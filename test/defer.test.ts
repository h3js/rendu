import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileTemplate, compileTemplateToString } from "../src/compiler.ts";

/** Render a streaming template and collect the decoded chunks in arrival order. */
async function collect(template: string, context: Record<string, any>, polyfill = false) {
  const fn = compileTemplate(template, { stream: true, polyfill });
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for await (const chunk of (await fn(context)) as ReadableStream<Uint8Array>) {
    chunks.push(decoder.decode(chunk, { stream: true }));
  }
  const tail = decoder.decode();
  if (tail) chunks.push(tail);
  return chunks;
}

/** Collect with arrival timestamps, for the ordering guarantees that are about timing. */
async function collectTimed(template: string, context: Record<string, any>) {
  const fn = compileTemplate(template, { stream: true, polyfill: false });
  const decoder = new TextDecoder();
  const start = Date.now();
  const chunks: { text: string; at: number }[] = [];
  for await (const chunk of (await fn(context)) as ReadableStream<Uint8Array>) {
    chunks.push({ text: decoder.decode(chunk, { stream: true }), at: Date.now() - start });
  }
  return chunks;
}

/** Marker names carry per-render entropy; normalize it so assertions stay readable. */
const norm = (html: string) => html.replaceAll(/d[a-z\d]{6}_/g, "d");

const after = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("defer", () => {
  it("emits a marker in place and patches it at the end of the stream", async () => {
    const chunks = await collect(`<a><?= defer(value) ?></a>`, {
      value: Promise.resolve("<b>late</b>"),
    });
    expect(norm(chunks.join(""))).toBe(
      `<a><?marker name="d0"></a><template for="d0"><b>late</b></template>`,
    );
  });

  it("wraps a placeholder in a start/end range", async () => {
    const chunks = await collect(`<a><?= defer(value, "<i>loading</i>") ?></a>`, {
      value: Promise.resolve("done"),
    });
    expect(norm(chunks.join(""))).toBe(
      `<a><?start name="d0"><i>loading</i><?end></a><template for="d0">done</template>`,
    );
  });

  it("treats any falsy placeholder as no placeholder", async () => {
    // `defer(v, cond && skeleton())` must not render the literal text "false".
    const chunks = await collect(`<?= defer(v, cond && "<i>s</i>") ?>|<?= defer(w, 0) ?>`, {
      v: "V",
      w: "W",
      cond: false,
    });
    expect(norm(chunks.join(""))).toBe(
      `<?marker name="d0">|<?marker name="d1"><template for="d0">V</template>` +
        `<template for="d1">W</template>`,
    );
  });

  it("gives every render its own marker namespace", async () => {
    // Two renders composed into one document must not both emit "d0": <template for>
    // matches the first marker of a name in tree order, so they would patch each other.
    const names = await Promise.all(
      [1, 2].map(async () => {
        const html = (await collect(`<?= defer(v) ?>`, { v: "x" })).join("");
        return /name="([^"]+)"/.exec(html)![1];
      }),
    );
    expect(names[0]).not.toBe(names[1]);
    expect(names[0]).toMatch(/^d[a-z\d]{6}_0$/);
  });

  it("flushes the shell before any deferred content resolves", async () => {
    const chunks = await collectTimed(`<h1>shell</h1><?= defer(value) ?><p>rest</p>`, {
      value: after(150, "late"),
    });
    // The shell is fully streamed before the patch, not buffered behind it.
    expect(chunks.slice(0, 3).map((c) => c.text)).toEqual([
      "<h1>shell</h1>",
      expect.stringMatching(/^<\?marker name="d[a-z\d]{6}_0">$/) as unknown as string,
      "<p>rest</p>",
    ]);
    // ...and it is on the wire long before the deferred value settles, which chunk order
    // alone cannot show: buffering the shell behind the value keeps the order identical.
    expect(chunks[2]!.at).toBeLessThan(100);
    expect(chunks.at(-1)!.at).toBeGreaterThanOrEqual(150);
  });

  it("patches in completion order, not source order", async () => {
    const chunks = await collect(`<?= defer(slow) ?><?= defer(fast) ?>`, {
      slow: after(120, "SLOW"),
      fast: after(5, "FAST"),
    });
    const patched = norm(chunks.join("")).match(/<template for="(d\d)">([^<]*)</g);
    expect(patched).toEqual(['<template for="d1">FAST<', '<template for="d0">SLOW<']);
  });

  it("races functions on the work they do, not on being a function", async () => {
    // A thunk is not a thenable, so racing the raw value would resolve it instantly and
    // flush the slow panel first, then block the ready one behind it.
    const chunks = await collectTimed(`<?= defer(slow) ?><?= defer(fast) ?>`, {
      slow: () => after(150, "SLOW"),
      fast: () => after(10, "FAST"),
    });
    const fast = chunks.find((c) => c.text === "FAST")!;
    const slow = chunks.find((c) => c.text === "SLOW")!;
    expect(fast.at).toBeLessThan(slow.at);
    expect(fast.at).toBeLessThan(100);
  });

  it("does not hold a ready patch behind a trickling deferred stream", async () => {
    const trickle = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for (const part of ["A", "B"]) {
          await after(80, undefined);
          controller.enqueue(encoder.encode(part));
        }
        controller.close();
      },
    });
    const chunks = await collectTimed(`<?= defer(stream) ?><?= defer(fast) ?>`, {
      stream: trickle,
      fast: after(5, "FAST"),
    });
    const fast = chunks.find((c) => c.text === "FAST")!;
    expect(fast.at).toBeLessThan(80);
  });

  it("does not hold a ready deferred stream behind a slower plain sibling", async () => {
    // A stream-valued patch yields the loop only to a sibling that is *already* settled.
    // Yielding to one that is merely pending would pin this stream to the slowest value in
    // the render, which is the opposite of what deferring it is for.
    const chunks = await collectTimed(`<?= defer(slow) ?><?= defer(fast) ?>`, {
      slow: after(150, "SLOW"),
      fast: () => after(10, undefined).then(() => new Response("FAST")),
    });
    const fast = chunks.find((c) => c.text.includes("FAST"))!;
    const slow = chunks.find((c) => c.text.includes("SLOW"))!;
    expect(fast.at).toBeLessThan(slow.at);
    expect(fast.at).toBeLessThan(100);
  });

  it("accepts functions, streams and Responses as deferred values", async () => {
    const chunks = await collect(`<?= defer(fn) ?><?= defer(stream) ?><?= defer(response) ?>`, {
      fn: () => "from-fn",
      stream: new Response("from-stream").body,
      response: new Response("from-response"),
    });
    const html = norm(chunks.join(""));
    expect(html).toContain(`<template for="d0">from-fn</template>`);
    expect(html).toContain(`<template for="d1">from-stream</template>`);
    expect(html).toContain(`<template for="d2">from-response</template>`);
  });

  it("keeps the response alive when a deferred value rejects", async () => {
    // The head and the shell are already committed by the time a patch fails, so there is
    // no status left to fail with. A failed patch is silent by design in <template for>:
    // the placeholder stays and the rest of the document keeps streaming.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const chunks = await collect(`<a><?= defer(bad) ?></a><?= defer(good) ?>`, {
      bad: Promise.reject(new Error("panel down")),
      good: after(20, "GOOD"),
    });
    const html = norm(chunks.join(""));
    expect(html).toBe(
      `<a><?marker name="d0"></a><?marker name="d1"><template for="d1">GOOD</template>`,
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("failed") as unknown as string,
      expect.objectContaining({ message: "panel down" }),
    );
  });

  it("does not leave a rejected deferred value unhandled while the shell streams", async () => {
    // The rejection handler has to be attached when defer() queues the value; attaching it
    // in the flush loop leaves a macrotask-wide window in which Node's default
    // --unhandled-rejections=throw terminates the process.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await collect(`<a><?= slow ?></a><b><?= defer(bad) ?></b>`, {
        slow: after(40, "SLOW"),
        bad: Promise.reject(new Error("boom")),
      });
      await after(20, undefined);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("cannot be closed early by a </template> in a deferred value", async () => {
    // Patches are emitted after </body></html>, so an unbalanced closer would relocate the
    // rest of the value to document level, outside whatever container the author wrapped
    // the defer() in.
    const chunks = await collect(`<div><?= defer(v) ?></div>`, {
      v: 'ok</template><img src=x onerror="alert(1)">',
    });
    const html = norm(chunks.join(""));
    expect(html).toBe(
      `<div><?marker name="d0"></div>` +
        `<template for="d0">ok&lt;/template><img src=x onerror="alert(1)"></template>`,
    );
  });

  it("guards a </template> split across stream chunks", async () => {
    const encoder = new TextEncoder();
    const split = new ReadableStream({
      start(controller) {
        for (const part of ["ok</temp", "late>", "<i>after</i>"]) {
          controller.enqueue(encoder.encode(part));
        }
        controller.close();
      },
    });
    const html = norm((await collect(`<?= defer(v) ?>`, { v: split })).join(""));
    expect(html).toContain(`<template for="d0">ok&lt;/template><i>after</i></template>`);
    expect(html.match(/<\/template>/g)).toHaveLength(1);
  });

  it("passes multi-byte patch content through intact", async () => {
    const bytes = new TextEncoder().encode("héllo — ünicode");
    const split = new ReadableStream({
      start(controller) {
        // Split mid-codepoint so the patch guard has to decode incrementally.
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    const html = norm((await collect(`<?= defer(v) ?>`, { v: split })).join(""));
    expect(html).toBe(`<?marker name="d0"><template for="d0">héllo — ünicode</template>`);
  });

  it("keeps echo() output from inside a deferred value", async () => {
    const chunks = await collect(
      `<?js const f = () => { echo("[echoed]"); return "RET" } ?><x><?= defer(f) ?></x>`,
      {},
    );
    const html = norm(chunks.join(""));
    // The thunk runs where defer() is called, so its echo lands in place, not nowhere.
    expect(html).toBe(`<x>[echoed]<?marker name="d0"></x><template for="d0">RET</template>`);
  });

  it("renders deferred content in place in text mode", async () => {
    const fn = compileTemplate(`<a><?= defer(value, "<i>loading</i>") ?></a>`, { stream: false });
    expect(await fn({ value: Promise.resolve("<b>late</b>") })).toBe("<a><b>late</b></a>");
  });

  it("emits no patch machinery when nothing is deferred", async () => {
    const chunks = await collect(`<a>plain</a>`, {}, true);
    expect(chunks.join("")).toBe("<a>plain</a>");
  });

  it("emits the client fallback once, before the first patch", async () => {
    const html = (await collect(`<?= defer(a) ?><?= defer(b) ?>`, { a: "A", b: "B" }, true)).join(
      "",
    );
    expect(html.match(/window\.__renduPatch=/g)).toHaveLength(1);
    expect(html.match(/<script>__renduPatch\(\)<\/script>/g)).toHaveLength(2);
    expect(html.indexOf("window.__renduPatch=")).toBeLessThan(html.indexOf("<template"));
  });

  it("compiles the documented example", async () => {
    // The README snippet is formatted by oxfmt, which reflows HTML inside ```html blocks —
    // an inline multi-line placeholder string becomes an unterminated string literal.
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const example = /### Deferred \(Out-of-Order\) Streaming[\s\S]*?```html\n([\s\S]*?)```/.exec(
      readme,
    )![1]!;
    expect(example).toContain("defer(");
    const fn = compileTemplate(example, { stream: true, polyfill: false });
    const html = await new Response((await fn({ getRecommendations: () => "REAL" })) as any).text();
    expect(norm(html)).toContain(`<template for="d0">REAL</template>`);
  });

  it("keeps </script> out of the generated source", async () => {
    // compileTemplateToString() output is documented as embeddable; a literal </script>
    // would terminate a host script element early.
    const source = compileTemplateToString(`<?= defer(v) ?>`, { stream: true });
    expect(source).not.toContain("</script>");
    const html = (await collect(`<?= defer(v) ?>`, { v: "x" }, true)).join("");
    expect(html).toContain("</script>");
  });
});
