// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { compileTemplate } from "../src/compiler.ts";

/**
 * The client fallback that `defer()` emits for browsers without native
 * `<template for>`, extracted from a real render so the test exercises the
 * shipped source rather than a copy of it.
 */
let patch: () => void;

beforeAll(async () => {
  const fn = compileTemplate(`<?= defer(v) ?>`, { stream: true });
  const html = await new Response((await fn({ v: "x" })) as ReadableStream).text();
  const source = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  // The document under test predates <template for>, which is what the fallback is for.
  expect("htmlFor" in HTMLTemplateElement.prototype).toBe(false);
  new Function(source)();
  patch = (globalThis as any).__renduPatch;
});

/** Run the sentinel against `template`, standing in for `document.currentScript`. */
function runSentinel(template: HTMLTemplateElement) {
  const script = document.createElement("script");
  template.after(script);
  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
  try {
    patch();
  } finally {
    script.remove();
  }
}

/** Append a `<template for=name>` holding `html` and apply it. */
function applyPatch(name: string, html: string) {
  const template = document.createElement("template");
  template.setAttribute("for", name);
  template.innerHTML = html;
  document.body.append(template);
  runSentinel(template);
  return template;
}

describe("defer client fallback", () => {
  it("replaces a marker with the patch content", () => {
    document.body.innerHTML = `<div id="host">before</div>`;
    // A legacy parser turns `<?marker name="d0">` into a bogus comment.
    document.querySelector("#host")!.append(document.createComment(`?marker name="d0"`));
    applyPatch("d0", "<b>late</b>");
    expect(document.querySelector("#host")!.innerHTML).toBe("before<b>late</b>");
  });

  it("replaces everything between start and end, placeholder included", () => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    host.append(
      document.createComment(`?start name="d0"`),
      Object.assign(document.createElement("p"), { textContent: "placeholder" }),
      document.createComment("?end"),
    );
    applyPatch("d0", "<b>real</b>");
    expect(host.innerHTML).toBe("<b>real</b>");
  });

  it("matches the end marker of the outermost range when ranges nest", () => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    host.append(
      document.createComment(`?start name="outer"`),
      document.createComment(`?start name="inner"`),
      document.createComment("?end"),
      Object.assign(document.createElement("i"), { textContent: "gone" }),
      document.createComment("?end"),
      Object.assign(document.createElement("u"), { textContent: "kept" }),
    );
    applyPatch("outer", "<b>x</b>");
    expect(host.innerHTML).toBe("<b>x</b><u>kept</u>");
  });

  it("accepts the self-closing marker form", () => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    host.append(document.createComment(`?marker name="d0"?`));
    applyPatch("d0", "ok");
    expect(host.innerHTML).toBe("ok");
  });

  it("finds markers parsed as processing instructions", () => {
    // A browser could ship processing instructions before <template for> itself.
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    host.append(
      document.createProcessingInstruction("start", `name="d0"`),
      Object.assign(document.createElement("p"), { textContent: "placeholder" }),
      document.createProcessingInstruction("end", ""),
    );
    applyPatch("d0", "<b>real</b>");
    expect(host.innerHTML).toBe("<b>real</b>");
  });

  it("only patches the marker with a matching name", () => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    host.append(
      document.createComment(`?marker name="other"`),
      document.createComment(`?marker name="d1"`),
    );
    applyPatch("d1", "<b>hit</b>");
    expect(host.innerHTML).toBe(`<!--?marker name="other"--><b>hit</b>`);
  });

  it("removes the template even when no marker matches", () => {
    document.body.innerHTML = "";
    const template = applyPatch("missing", "<b>orphan</b>");
    expect(template.isConnected).toBe(false);
    expect(document.body.innerHTML).toBe("");
  });

  it("does nothing when the preceding element is not a patch template", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const host = document.querySelector("#host")!;
    host.append(document.createComment(`?marker name="d0"`));
    const notATemplate = document.createElement("div");
    document.body.append(notATemplate);
    runSentinel(notATemplate as unknown as HTMLTemplateElement);
    expect(host.innerHTML).toBe(`<!--?marker name="d0"-->`);
  });
});
