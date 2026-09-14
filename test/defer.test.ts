import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "parse5";
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

/** Marker names carry per-render entropy; normalize it so assertions stay readable. */
const norm = (html: string) => html.replaceAll(/d[a-z\d]{6}_/g, "d");

/** A promise that the test resolves itself. */
function gate<T = void>() {
  let open!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (open = resolve));
  return { promise, open };
}

/**
 * Render a streaming template and run each trigger's action once its text is on the wire
 * (normalized), for the ordering guarantees that are about timing: a value is held back by a
 * `gate()` until the output that must not wait for it has arrived, instead of racing timers
 * against wall-clock thresholds. Nothing else in these renders waits on a timer, so a correct
 * render emits the text right away; one that holds it back behind the gated value stalls, so
 * after `patience` ms the remaining actions run anyway and their texts are reported in `late`.
 */
async function collectWhen(
  template: string,
  context: Record<string, any>,
  triggers: [text: string, action: () => void][],
  patience = 1000,
) {
  const fn = compileTemplate(template, { stream: true, polyfill: false });
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const waiting = new Map(triggers);
  const late: string[] = [];
  const fire = (stalled: boolean) => {
    const html = norm(chunks.join(""));
    for (const [text, action] of waiting) {
      if (stalled || html.includes(text)) {
        waiting.delete(text);
        if (stalled) late.push(text);
        action();
      }
    }
  };
  const timer = setTimeout(() => fire(true), patience);
  try {
    for await (const chunk of (await fn(context)) as ReadableStream<Uint8Array>) {
      chunks.push(decoder.decode(chunk, { stream: true }));
      fire(false);
    }
  } finally {
    clearTimeout(timer);
  }
  return { chunks: chunks.map((chunk) => norm(chunk)), html: norm(chunks.join("")), late };
}

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
    // The value only resolves once the whole shell is on the wire: a shell buffered behind the
    // value would never get there (chunk order alone cannot show that, it is the same either way).
    const value = gate<string>();
    const { chunks, html, late } = await collectWhen(
      `<h1>shell</h1><?= defer(value) ?><p>rest</p>`,
      { value: value.promise },
      [["<p>rest</p>", () => value.open("late")]],
    );
    expect(late).toEqual([]);
    expect(chunks.slice(0, 3)).toEqual(["<h1>shell</h1>", `<?marker name="d0">`, "<p>rest</p>"]);
    expect(html).toBe(
      `<h1>shell</h1><?marker name="d0"><p>rest</p><template for="d0">late</template>`,
    );
  });

  it("patches in completion order, not source order", async () => {
    const slow = gate<string>();
    const { html, late } = await collectWhen(
      `<?= defer(slow) ?><?= defer(fast) ?>`,
      { slow: slow.promise, fast: Promise.resolve("FAST") },
      [["FAST", () => slow.open("SLOW")]],
    );
    expect(late).toEqual([]);
    expect(html.match(/<template for="(d\d)">([^<]*)</g)).toEqual([
      '<template for="d1">FAST<',
      '<template for="d0">SLOW<',
    ]);
  });

  it("races functions on the work they do, not on being a function", async () => {
    // A thunk is not a thenable, so racing the raw value would resolve it instantly and
    // flush the slow panel first, then block the ready one behind it.
    const slow = gate<string>();
    const { html, late } = await collectWhen(
      `<?= defer(slow) ?><?= defer(fast) ?>`,
      { slow: () => slow.promise, fast: async () => "FAST" },
      [["FAST", () => slow.open("SLOW")]],
    );
    expect(late).toEqual([]);
    expect(html.indexOf("FAST")).toBeLessThan(html.indexOf("SLOW"));
  });

  it("does not hold a ready patch behind a trickling deferred stream", async () => {
    // The stream has settled (it is a stream) but produces its chunks only once FAST is out.
    const first = gate();
    const second = gate();
    const encoder = new TextEncoder();
    const trickle = new ReadableStream({
      async start(controller) {
        await first.promise;
        controller.enqueue(encoder.encode("A"));
        await second.promise;
        controller.enqueue(encoder.encode("B"));
        controller.close();
      },
    });
    const { html, late } = await collectWhen(
      `<?= defer(stream) ?><?= defer(fast) ?>`,
      { stream: trickle, fast: Promise.resolve("FAST") },
      [
        ["FAST", first.open],
        [">A", second.open],
      ],
    );
    expect(late).toEqual([]);
    expect(html).toBe(
      `<?marker name="d0"><?marker name="d1">` +
        `<template for="d1">FAST</template><template for="d0">AB</template>`,
    );
  });

  it("does not hold a ready deferred stream behind a slower plain sibling", async () => {
    // A stream-valued patch yields the loop only to a sibling that is *already* settled.
    // Yielding to one that is merely pending would pin this stream to the slowest value in
    // the render, which is the opposite of what deferring it is for.
    const slow = gate<string>();
    const { html, late } = await collectWhen(
      `<?= defer(slow) ?><?= defer(fast) ?>`,
      { slow: slow.promise, fast: async () => new Response("FAST") },
      [["FAST", () => slow.open("SLOW")]],
    );
    expect(late).toEqual([]);
    expect(html.indexOf("FAST")).toBeLessThan(html.indexOf("SLOW"));
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

  it("fails only its own patch when a racing deferred body is already locked", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const used = new Response("used");
    await used.text();
    const chunks = await collect(`<a><?= defer(used) ?></a><b><?= defer(slow) ?></b>`, {
      used,
      slow: after(20, "B"),
    });
    expect(norm(chunks.join(""))).toBe(
      `<a><?marker name="d0"></a><b><?marker name="d1"></b><template for="d1">B</template>`,
    );
    expect(error).toHaveBeenCalledOnce();
  });

  it("releases a racing deferred body whose first read fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = new ReadableStream({
      pull: (controller) => after(5, undefined).then(() => controller.error(new Error("down"))),
    });
    await collect(`<?= defer(bad) ?><?= defer(slow) ?>`, { bad, slow: after(20, "B") });
    expect(bad.locked).toBe(false);
    expect(error).toHaveBeenCalledOnce();
  });

  it("cancels the deferred values left unread when text mode fails", async () => {
    let cancelled: unknown;
    const body = new ReadableStream({ cancel: (reason) => void (cancelled = reason) });
    const render = compileTemplate(`<?= defer(body) ?><?= bad ?>`, { stream: false });
    await expect(render({ body, bad: Promise.reject(new Error("boom")) })).rejects.toThrow("boom");
    await after(0, undefined);
    expect(cancelled).toEqual(new Error("boom"));
  });

  describe("a deferred value that fails before any content", () => {
    // Even an empty <template for> replaces the placeholder, so no patch may go out at all:
    // whether the stream is written directly (the last pending entry) or races on its first chunk.
    const failing = () => parts([]);
    const erroredResponse = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("body down"));
          },
        }),
      );

    it.each([
      ["a stream", failing],
      ["a Response whose body errors immediately", erroredResponse],
      ["a function resolving to a failing stream", () => Promise.resolve(() => failing())],
    ])("emits no patch for %s as the last pending entry", async (_, make) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      for (const polyfill of [false, true]) {
        const marker = await collect(`<a><?= defer(bad) ?></a>`, { bad: make() }, polyfill);
        expect(norm(marker.join(""))).toBe(`<a><?marker name="d0"></a>`);
        const placeholder = await collect(
          `<a><?= defer(bad, "<i>loading</i>") ?></a>`,
          { bad: make() },
          polyfill,
        );
        expect(norm(placeholder.join(""))).toBe(`<a><?start name="d0"><i>loading</i><?end></a>`);
      }
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/_0 failed/) as unknown as string,
        expect.objectContaining({ message: expect.stringMatching(/down/) }),
      );
    });

    it.each([
      ["a stream", failing],
      ["a Response whose body errors immediately", erroredResponse],
    ])("emits no patch for %s next to siblings", async (_, make) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      // `bad` races on its first chunk while `slow` is pending; `last` settles after `slow` has
      // been flushed, so it is written directly as the last pending entry.
      const slow = gate<string>();
      const last = gate();
      const { html, late } = await collectWhen(
        `<a><?= defer(bad, "<i>1</i>") ?></a><b><?= defer(slow) ?></b>` +
          `<c><?= defer(fast) ?></c><d><?= defer(last, "<i>4</i>") ?></d>`,
        {
          bad: make(),
          slow: slow.promise,
          fast: "FAST",
          last: last.promise.then(() => make()),
        },
        [
          ["FAST", () => slow.open("SLOW")],
          ["SLOW", last.open],
        ],
      );
      expect(late).toEqual([]);
      expect(html).toBe(
        `<a><?start name="d0"><i>1</i><?end></a><b><?marker name="d1"></b>` +
          `<c><?marker name="d2"></c><d><?start name="d3"><i>4</i><?end></d>` +
          `<template for="d2">FAST</template><template for="d1">SLOW</template>`,
      );
    });

    it("still patches a value that succeeds empty", async () => {
      // An empty value is content too: it replaces the placeholder with nothing.
      const html = await collect(
        `<a><?= defer(empty, "<i>1</i>") ?></a><b><?= defer(nothing, "<i>2</i>") ?></b>`,
        { empty: parts([], false), nothing: Promise.resolve(null) },
      );
      const patches = norm(html.join("")).match(/<template for="d\d"><\/template>/g);
      expect(patches?.toSorted()).toEqual([
        `<template for="d0"></template>`,
        `<template for="d1"></template>`,
      ]);
    });

    it("keeps the content a stream wrote before it failed", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const html = await collect(`<a><?= defer(bad, "<i>1</i>") ?></a>`, {
        bad: parts(["<p>partial"]),
      });
      expect(norm(html.join(""))).toBe(
        `<a><?start name="d0"><i>1</i><?end></a><template for="d0"><p>partial</template>`,
      );
    });
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

  describe("echo() after an await", () => {
    const lateEcho = /echo\(\) must be called synchronously/;
    const failedWith = (error: ReturnType<typeof vi.spyOn>) =>
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("failed") as unknown as string,
        expect.objectContaining({ message: expect.stringMatching(lateEcho) }),
      );

    it("fails the deferred value instead of writing into another patch", async () => {
      // `f` echoes while `g` is about to be flushed: there is no way to tell whose output that
      // is, so it must not end up in g's patch.
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const chunks = await collect(
        `<?js const f = async () => { await after(10); echo("[f-echo]"); await after(40); return "F" };` +
          ` const g = async () => { await after(20); return "G" }; ?>` +
          `<a><?= defer(f) ?></a><b><?= defer(g) ?></b>`,
        { after },
      );
      expect(norm(chunks.join(""))).toBe(
        `<a><?marker name="d0"></a><b><?marker name="d1"></b><template for="d1">G</template>`,
      );
      failedWith(error);
    });

    it("fails the deferred value instead of writing after the document", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const chunks = await collect(
        `<?js const f = async () => { await after(5); echo("[f-echo]"); await after(30); return "F" }; ?>` +
          `<a><?= defer(f) ?></a><?= slow ?><end>`,
        { after, slow: after(20, "SLOW") },
      );
      expect(norm(chunks.join(""))).toBe(`<a><?marker name="d0"></a>SLOW<end>`);
      failedWith(error);
    });

    it("throws in text mode", async () => {
      const fn = compileTemplate(
        `<?js const f = async () => { await after(5); echo("[f-echo]"); return "F" }; ?>` +
          `<a><?= defer(f) ?></a><end>`,
        { stream: false },
      );
      await expect(fn({ after })).rejects.toThrow(lateEcho);
    });
  });

  it("writes a deferred function's synchronous echoes in place in both modes", async () => {
    // Called by defer() (echoes go before the marker), and at flush time when a deferred value
    // resolves to a function (echoes go into its patch): the same output either way, modulo
    // patches.
    const template =
      `<?js const h = () => { echo("x"); echo(() => { echo("n"); return "m" }); return "y" } ?>` +
      `<p><?= defer(h) ?></p><q><?= defer(Promise.resolve(h)) ?></q>`;
    const html = norm((await collect(template, {})).join(""));
    expect(html).toBe(
      `<p>xnm<?marker name="d0"></p><q><?marker name="d1"></q>` +
        `<template for="d0">y</template><template for="d1">xnmy</template>`,
    );
    const text = await compileTemplate(template, { stream: false })({});
    expect(text).toBe(`<p>xnmy</p><q>xnmy</q>`);
  });

  it("renders deferred content in place in text mode", async () => {
    const fn = compileTemplate(`<a><?= defer(value, "<i>loading</i>") ?></a>`, { stream: false });
    expect(await fn({ value: Promise.resolve("<b>late</b>") })).toBe("<a><b>late</b></a>");
  });

  it("renders a marker concatenated into another deferred value in text mode", async () => {
    // defer() returns a marker string in both modes, so the documented nesting pattern works.
    const template =
      `<?js const outer = async () => { const m = defer(after(10, "INNER")); return "<i>" + m + "</i>" };` +
      ` const early = defer("EARLY"); ?><a><?= defer(outer) ?></a><b><?= defer(after(5, "<s>" + early + "</s>")) ?></b>`;
    const fn = compileTemplate(template, { stream: false });
    expect(await fn({ after })).toBe("<a><i>INNER</i></a><b><s>EARLY</s></b>");
  });

  it("calls a deferred function right away and rejects on failure in text mode", async () => {
    const calls: string[] = [];
    const fn = compileTemplate(
      `<?js defer(() => { calls.push("called"); return "x" }) ?>ok<?js calls.push("body") ?>`,
      { stream: false },
    );
    expect(await fn({ calls })).toBe("ok");
    expect(calls).toEqual(["called", "body"]);
    const failing = compileTemplate(`<?js defer(Promise.reject(new Error("nope"))) ?>ok`, {
      stream: false,
    });
    await expect(failing({})).rejects.toThrow("nope");
  });

  it("emits no patch machinery when nothing is deferred", async () => {
    const chunks = await collect(`<a>plain</a>`, {}, true);
    expect(chunks.join("")).toBe("<a>plain</a>");
  });

  it("does not inline the patch runtime into a template without defer()", () => {
    // None of it could run: without defer() nothing is ever queued. Local names are mangled in
    // the generated runtime, so look for the strings and bindings that survive minification.
    const identifiers = [
      "<template for=",
      "</template>",
      "plaintext",
      "noscript",
      'name="',
      "[rendu] deferred value",
      "__deferred__",
      "__deferId__",
      "__renduPatch",
    ];
    const has = (source: string, name: string) => source.includes(name);
    for (const opts of [{}, { polyfill: false }, { contextKeys: ["v"] }]) {
      const plain = compileTemplateToString(`<a><?= v ?></a>`, { stream: true, ...opts });
      expect(identifiers.filter((name) => has(plain, name))).toEqual([]);
      expect(plain).not.toContain("<template");
      const deferred = compileTemplateToString(`<a><?= defer(v) ?></a>`, { stream: true, ...opts });
      expect(identifiers.filter((name) => !has(deferred, name))).toEqual(
        "polyfill" in opts ? ["__renduPatch"] : [],
      );
    }
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

/** A byte stream that yields `parts` one read at a time, then errors (or closes). */
function parts(chunks: (string | Uint8Array)[], fail = true) {
  const encoder = new TextEncoder();
  const queue = [...chunks];
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const next = queue.shift();
        if (next !== undefined) {
          controller.enqueue(typeof next === "string" ? encoder.encode(next) : next);
        } else if (fail) {
          controller.error(new Error("stream down"));
        } else {
          controller.close();
        }
      },
    },
    // Pull on demand: a read-ahead would error the stream (and drop its queue) up front.
    { highWaterMark: 0 },
  );
}

/**
 * Parse a render with a spec-compliant parser (happy-dom's is not) and report how its
 * patches are framed: the `for` of every `<template>` at body level, and whether the markup
 * after the last patch is back at body level too. An unclosed patch swallows everything after
 * it, so its later siblings go missing from the list.
 */
function framing(html: string, scriptingEnabled = true) {
  const doc = parse(`<!doctype html><body>${html}<p id="after"></p>`, { scriptingEnabled });
  const body = (doc.childNodes[1] as any).childNodes[1];
  const children: any[] = body.childNodes;
  return {
    patches: children
      .filter((node) => node.nodeName === "template")
      .map((node) => norm(node.attrs.find((a: any) => a.name === "for")?.value ?? "")),
    after: children.some((node) => node.nodeName === "p"),
  };
}

/** Render `v` as the first of two patches and return the whole document, normalized. */
async function renderPair(v: unknown) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const chunks = await collect(`<?= defer(v) ?><?= defer(next) ?>`, {
    v,
    next: after(30, "<b>next</b>"),
  });
  return norm(chunks.join(""));
}

/** The first patch's content as it went out on the wire. */
const firstPatch = (html: string) =>
  /<template for="d0">([\s\S]*?)<\/template><template for="d1">/.exec(html)?.[1];

/** Position of `needle` in `html`, asserting that it is there. */
function at(html: string, needle: string) {
  const i = html.indexOf(needle);
  expect(i, `${needle} in ${html}`).toBeGreaterThanOrEqual(0);
  return i;
}

/** Assert that the marker for `inner` is inside the patch for `outer`, and that its patch comes after. */
function expectNestedAfter(html: string, outer: string, inner: string) {
  const outerStart = at(html, `<template for="${outer}">`);
  const outerEnd = html.indexOf("</template>", outerStart);
  const marker = html.indexOf(`name="${inner}"`, outerStart);
  expect(marker, html).toBeGreaterThan(outerStart);
  expect(marker, html).toBeLessThan(outerEnd);
  expect(at(html, `<template for="${inner}">`), html).toBeGreaterThan(outerEnd);
}

describe("nested defer", () => {
  it("flushes an inner patch after the outer patch that holds its marker", async () => {
    const html = norm(
      (
        await collect(
          `<?js const outer = async () => { const m = defer(after(5, "INNER")); await after(30); return "<i>" + m + "</i>" }; ?>` +
            `<a><?= defer(outer) ?></a>`,
          { after },
        )
      ).join(""),
    );
    expect(html).toBe(
      `<a><?marker name="d0"></a><template for="d0"><i><?marker name="d1"></i></template>` +
        `<template for="d1">INNER</template>`,
    );
    expect(framing(html).patches).toEqual(["d0", "d1"]);
  });

  it("holds an inner defer() queued after an await while a sibling flushes", async () => {
    const html = norm(
      (
        await collect(
          `<?js const outer = async () => { await after(5); const m = defer("INNER"); await after(30); return "<i>" + m + "</i>" }; ?>` +
            `<a><?= defer(outer) ?></a><b><?= defer(after(15, "B")) ?></b>`,
          { after },
        )
      ).join(""),
    );
    expect(html).toBe(
      `<a><?marker name="d0"></a><b><?marker name="d1"></b>` +
        `<template for="d1">B</template>` +
        `<template for="d0"><i><?marker name="d2"></i></template>` +
        `<template for="d2">INNER</template>`,
    );
  });

  it.each([
    ["a stream", (m: string) => new Response(`<i>${m}</i>`).body],
    ["a Response", (m: string) => new Response(`<i>${m}</i>`)],
    ["a function result", (m: string) => () => after(20, `<i>${m}</i>`)],
  ])("finds a nested marker in %s", async (_, wrap) => {
    const html = norm(
      (
        await collect(`<?js const m = defer("INNER"); ?><a><?= defer(wrap(m)) ?></a>`, {
          wrap,
        })
      ).join(""),
    );
    expectNestedAfter(html, "d1", "d0");
    expect(html).toContain(`<template for="d0">INNER</template>`);
  });

  it("nests two levels deep", async () => {
    const html = norm(
      (
        await collect(
          `<?js
            const level2 = () => after(30, "<u>" + defer(after(1, "DEEP")) + "</u>");
            const level1 = () => after(20, "<i>" + defer(level2) + "</i>");
          ?><a><?= defer(level1) ?></a><b><?= defer(after(25, "B")) ?></b>`,
          { after },
        )
      ).join(""),
    );
    // level1 = d0, level2 = d1, DEEP = d2 (each queued while the previous one's value starts).
    expectNestedAfter(html, "d0", "d1");
    expectNestedAfter(html, "d1", "d2");
    expect(html).toContain(`<template for="d2">DEEP</template>`);
    expect(html).toContain(`<template for="d3">B</template>`);
    expect(framing(html)).toEqual({ patches: ["d0", "d3", "d1", "d2"], after: true });
  });

  it("does not hold a sibling behind a parked inner patch", async () => {
    // INNER settles right away but waits for the outer patch; FAST must not wait with it.
    const outer = gate();
    const { html, late } = await collectWhen(
      `<?js const f = () => { const m = defer("INNER"); return outer.then(() => "<i>" + m + "</i>") }; ?>` +
        `<?= defer(f) ?><?= defer(Promise.resolve("FAST")) ?>`,
      { outer: outer.promise },
      [["FAST", outer.open]],
    );
    expect(late).toEqual([]);
    expectNestedAfter(html, "d0", "d1");
    expect(html.indexOf("FAST")).toBeLessThan(html.indexOf(`<template for="d0">`));
  });

  it("finds a marker split across stream chunks", async () => {
    const html = norm(
      (
        await collect(`<?js const m = defer("INNER"); ?><a><?= defer(split(m)) ?></a>`, {
          split: (m: string) => {
            const text = `<i>${m}</i>`;
            const cut = [2, text.indexOf("name=") + 3, text.indexOf("_") + 1, text.length - 6];
            return parts(
              cut
                .map((end, i) => text.slice(i ? cut[i - 1] : 0, end))
                .concat(text.slice(cut.at(-1))),
              false,
            );
          },
        })
      ).join(""),
    );
    expect(html).toBe(
      `<a><?marker name="d1"></a><template for="d1"><i><?marker name="d0"></i></template>` +
        `<template for="d0">INNER</template>`,
    );
  });

  it("still flushes patches whose marker never reached the document", async () => {
    // An unechoed or escaped marker cannot be patched, but it must not hold the stream open.
    const chunks = await collect(
      `<?js const lost = defer(after(10, "LOST")); ?>{{ defer(after(5, "ESCAPED")) }}` +
        `<a><?= defer(after(20, "<i>" + defer("NESTED") + "</i>")) ?></a>`,
      { after },
    );
    const html = norm(chunks.join(""));
    expect(html).toContain(`<template for="d0">LOST</template>`);
    expect(html).toContain(`<template for="d1">ESCAPED</template>`);
    expectNestedAfter(html, "d3", "d2");
    expect(html.match(/<template for=/g)).toHaveLength(4);
  });

  it("scans the content of a patch flushed without its marker", async () => {
    // The unechoed outer patch cannot apply, but an entry queued while it is written has its
    // marker in it, so it races normally instead of waiting for the fallback.
    const html = norm(
      (
        await collect(`<?js defer(() => after(10, "<i>" + defer("INNER") + "</i>")); ?><a>x</a>`, {
          after,
        })
      ).join(""),
    );
    expectNestedAfter(html, "d0", "d1");
  });

  it("flushes thousands of racing, nested and unseen entries in linear time", async () => {
    const fn = compileTemplate(
      `<? for (let i = 0; i < 4000; i++) { echo(defer(() => "<i>" + defer(Promise.resolve(i)) + "</i>")); defer(i) } ?>`,
      { stream: true, polyfill: false },
    );
    const start = performance.now();
    const html = norm(await new Response((await fn({})) as ReadableStream).text());
    // This took around 8 seconds when every patch re-raced and re-checked all waiting entries.
    expect(performance.now() - start).toBeLessThan(4000);
    const order = new Map(
      [...html.matchAll(/<template for="d(\d+)">/g)].map((match, at) => [Number(match[1]), at]),
    );
    expect(order.size).toBe(12_000);
    for (let i = 0; i < 4000; i++) {
      expect(order.get(3 * i)!).toBeLessThan(order.get(3 * i + 1)!);
      expect(order.get(3 * i + 2)!).toBeGreaterThanOrEqual(8000);
    }
  }, 30_000);
});

describe("defer patch framing", () => {
  it.each([
    ["an attribute value", `<div class="x`, `<div class="x">`],
    ["a single-quoted attribute value", `<a title='y`, `<a title='y'>`],
    ["an unquoted attribute value", `<a href=/x`, `<a href=/x>`],
    ["a tag", `<div id="a" `, `<div id="a" >`],
    ["a comment", `ok<!-- note`, `ok<!-- note-->`],
    ["a bogus comment", `ok<!DOCTYPE`, `ok<!DOCTYPE>`],
    ["a <script>", `<script>if (a < b`, `<script>if (a < b</script>`],
    ["an escaped <script>", `<script><!--<script>`, `<script><!--<script>--></script>`],
    ["a <style>", `<style>a{`, `<style>a{</style>`],
    ["a <textarea>", `<textarea><b`, `<textarea><b</textarea>`],
    ["a <title>", `<title>t`, `<title>t</title>`],
    ["an <iframe>", `<iframe>`, `<iframe></iframe>`],
    ["a start tag that opens raw text", `<script`, `<script></script>`],
    ["a nested <template>", `<template><p class="z`, `<template><p class="z"></template>`],
    ["a <noscript>", `<noscript><b>n`, `<noscript><b>n</noscript>`],
  ])("closes a patch whose stream fails inside %s", async (_, streamed, closed) => {
    const html = await renderPair(parts([streamed]));
    expect(firstPatch(html)).toBe(closed);
    expect(html.endsWith(`<template for="d1"><b>next</b></template>`)).toBe(true);
    for (const scriptingEnabled of [true, false]) {
      expect(framing(html, scriptingEnabled)).toEqual({ patches: ["d0", "d1"], after: true });
    }
  });

  it.each([
    ["<", "&lt;"],
    ["</", "&lt;/"],
    ["</t", "&lt;/t"],
    ["</templat", "&lt;/templat"],
    ["<plain", "&lt;plain"],
  ])("escapes a dangling %j at the end of a patch", async (tail, escaped) => {
    const html = await renderPair(parts(["x", tail], false));
    expect(firstPatch(html)).toBe(`x${escaped}`);
    expect(framing(html)).toEqual({ patches: ["d0", "d1"], after: true });
  });

  it("flushes pending bytes after the text held back before them", async () => {
    // "a<" then the first byte of a two-byte codepoint: the `<` is held back as a possible
    // `</template`, and the incomplete byte decodes to U+FFFD after it, not in front of it.
    const html = await renderPair(parts([new Uint8Array([0x61, 0x3c, 0xc3])], false));
    expect(firstPatch(html)).toBe("a<�");
    expect(framing(html)).toEqual({ patches: ["d0", "d1"], after: true });
  });

  it("leaves </template alone where it cannot close the patch", async () => {
    const value =
      `<script>el.innerHTML = "<template></template>"</script>` +
      `<style>a::after{content:"</template>"}</style>` +
      `<textarea></template></textarea>` +
      `<img alt="</template>" title='</template>'>` +
      `<!-- </template> -->`;
    const html = await renderPair(parts([value], false));
    expect(firstPatch(html)).toBe(value);
    expect(framing(html)).toEqual({ patches: ["d0", "d1"], after: true });
  });

  it("passes a balanced nested <template> through", async () => {
    const value = `<template><p>inner</p><template>deep</template></template><i>after</i>`;
    const html = await renderPair(value);
    expect(firstPatch(html)).toBe(value);
    expect(framing(html)).toEqual({ patches: ["d0", "d1"], after: true });
  });

  it("still escapes an unbalanced </template> after a nested one", async () => {
    const html = await renderPair(`<template>a</template></template><i>b</i>`);
    expect(firstPatch(html)).toBe(`<template>a</template>&lt;/template><i>b</i>`);
    expect(framing(html)).toEqual({ patches: ["d0", "d1"], after: true });
  });

  it.each([
    `<noscript><!--</noscript></template><b>x</b>`,
    `<noscript><script></noscript></template><b>x</b>`,
    `<noscript><a title="</noscript></template><b>x</b>">`,
    `<noscript><template></noscript></template><b>x</b>`,
    `<template><noscript></template></noscript></template><b>x</b>`,
    `<select><title></template><b>x</b>`,
    `<select><style></template><b>x</b>`,
    `<select><template></select></template><iframe></template><b>x</b>`,
  ])("keeps %j in its patch whether or not its element is raw text", async (value) => {
    for (const chunks of [[value], [...value]]) {
      const html = await renderPair(parts(chunks, false));
      for (const scriptingEnabled of [true, false]) {
        expect(framing(html, scriptingEnabled), html).toEqual({
          patches: ["d0", "d1"],
          after: true,
        });
        // Template content is not in `childNodes`: a <b> found there escaped its patch.
        const found: string[] = [];
        const walk = (node: any): void => {
          if (node.nodeName === "b") found.push(node.nodeName);
          node.childNodes?.forEach(walk);
        };
        walk(parse(`<!doctype html><body>${html}`, { scriptingEnabled }));
        expect(found, html).toEqual([]);
      }
    }
  });

  it("leaves <noscript> and <select> content alone when it cannot break out", async () => {
    const value =
      `<noscript><img src="a.png" alt="a > b"><style>p>a{content:"</template>"}</style><!-- c --></noscript>` +
      `<select><option>a</option></select><style>a::after{content:"<i"}</style>`;
    const html = await renderPair(parts([...value], false));
    expect(firstPatch(html)).toBe(value);
    expect(framing(html)).toEqual({ patches: ["d0", "d1"], after: true });
  });

  it("tracks tokenizer state across chunk boundaries", async () => {
    const html = await renderPair(
      parts(
        [
          `<scr`,
          `ipt>"</tem`,
          `plate>"</scr`,
          `ipt><p title="</te`,
          `mplate>">x</p></templ`,
          `ate><plain`,
          `text>`,
        ],
        false,
      ),
    );
    expect(firstPatch(html)).toBe(
      `<script>"</template>"</script><p title="</template>">x</p>&lt;/template>&lt;plaintext>`,
    );
    expect(framing(html)).toEqual({ patches: ["d0", "d1"], after: true });
  });

  it("frames every truncation of a document", async () => {
    // Cut a representative value at every offset, streamed in small chunks, and fail there.
    const value =
      `<div class="a" data-x='1' hidden><!-- c --><script>if (a<b) x("</div>")</script>` +
      `<template><td>t</td></template><textarea></textare</textarea><style>p{}</style>ü</div>`;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fn = compileTemplate(`<?= defer(v) ?><?= defer(next) ?>`, {
      stream: true,
      polyfill: false,
    });
    const bytes = new TextEncoder().encode(value);
    for (let end = 1; end <= bytes.length; end++) {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < end; i += 3) chunks.push(bytes.slice(i, Math.min(i + 3, end)));
      const stream = (await fn({
        v: parts(chunks, end < bytes.length),
        next: after(1, "N"),
      })) as ReadableStream;
      const html = norm(await new Response(stream).text());
      expect(framing(html), html).toEqual({ patches: ["d0", "d1"], after: true });
      if (end === bytes.length) expect(firstPatch(html)).toBe(value);
    }
  });
});
