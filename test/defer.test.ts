import { describe, expect, it } from "vitest";
import { compileTemplate } from "../src/compiler.ts";

/** Render a streaming template and collect the decoded chunks in arrival order. */
async function collect(template: string, context: Record<string, any>, polyfill = false) {
  const fn = compileTemplate(template, { stream: true, polyfill });
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for await (const chunk of (await fn(context)) as ReadableStream<Uint8Array>) {
    chunks.push(decoder.decode(chunk, { stream: true }));
  }
  return chunks;
}

const after = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

describe("defer", () => {
  it("emits a marker in place and patches it at the end of the stream", async () => {
    const chunks = await collect(`<a><?= defer(value) ?></a>`, {
      value: Promise.resolve("<b>late</b>"),
    });
    expect(chunks.join("")).toBe(
      `<a><?marker name="d0"></a><template for="d0"><b>late</b></template>`,
    );
  });

  it("wraps a placeholder in a start/end range", async () => {
    const chunks = await collect(`<a><?= defer(value, "<i>loading</i>") ?></a>`, {
      value: Promise.resolve("done"),
    });
    expect(chunks.join("")).toBe(
      `<a><?start name="d0"><i>loading</i><?end></a><template for="d0">done</template>`,
    );
  });

  it("flushes the shell before any deferred content resolves", async () => {
    const chunks = await collect(`<h1>shell</h1><?= defer(value) ?><p>rest</p>`, {
      value: after(50, "late"),
    });
    // The shell is fully streamed before the patch, not buffered behind it.
    expect(chunks.slice(0, 4)).toEqual([
      "<h1>shell</h1>",
      '<?marker name="d0">',
      "<p>rest</p>",
      '<template for="d0">',
    ]);
  });

  it("patches in completion order, not source order", async () => {
    const chunks = await collect(`<?= defer(slow) ?><?= defer(fast) ?>`, {
      slow: after(60, "SLOW"),
      fast: after(5, "FAST"),
    });
    const patched = chunks.join("").match(/<template for="(d\d)">([^<]*)</g);
    expect(patched).toEqual(['<template for="d1">FAST<', '<template for="d0">SLOW<']);
  });

  it("accepts functions, streams and Responses as deferred values", async () => {
    const chunks = await collect(`<?= defer(fn) ?><?= defer(stream) ?><?= defer(response) ?>`, {
      fn: () => "from-fn",
      stream: new Response("from-stream").body,
      response: new Response("from-response"),
    });
    const html = chunks.join("");
    expect(html).toContain(`<template for="d0">from-fn</template>`);
    expect(html).toContain(`<template for="d1">from-stream</template>`);
    expect(html).toContain(`<template for="d2">from-response</template>`);
  });

  it("propagates a rejected deferred value", async () => {
    await expect(
      collect(`<a><?= defer(value) ?></a>`, {
        value: Promise.reject(new Error("boom")),
      }),
    ).rejects.toThrow("boom");
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
});
