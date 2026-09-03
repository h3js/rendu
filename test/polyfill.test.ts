// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import { compileTemplate } from "../src/compiler.ts";

/**
 * The client fallback that `defer()` emits for browsers without native
 * `<template for>`, extracted from a real render so the test exercises the
 * shipped source rather than a copy of it.
 */
let patch: () => void;
let source: string;

beforeAll(async () => {
  const fn = compileTemplate(`<?= defer(v) ?>`, { stream: true });
  const html = await new Response((await fn({ v: "x" })) as ReadableStream).text();
  source = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  // Shadow the global so the fallback branch is always the code under test, whatever the
  // host document happens to support. (Doing this by asserting on happy-dom's support
  // would turn into a silently skipped suite the day it ships `htmlFor`.)
  new Function("HTMLTemplateElement", source)(undefined);
  patch = (globalThis as any).__renduPatch;
});

/** Run the sentinel against `template`, standing in for `document.currentScript`. */
function runSentinel(template: HTMLTemplateElement) {
  const script = document.createElement("script");
  template.after(script);
  const previous = Object.getOwnPropertyDescriptor(document, "currentScript");
  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
  try {
    patch();
  } finally {
    script.remove();
    if (previous) Object.defineProperty(document, "currentScript", previous);
    else Reflect.deleteProperty(document, "currentScript");
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

/** A fresh `<div>` holding `nodes`, as the document's only body content. */
function host(...nodes: Node[]) {
  const el = document.createElement("div");
  el.append(...nodes);
  document.body.replaceChildren(el);
  return el;
}

const el = (tag: string, text: string) =>
  Object.assign(document.createElement(tag), { textContent: text });

describe("defer client fallback", () => {
  it("replaces a marker with the patch content", () => {
    // A legacy parser turns `<?marker name="d0">` into a bogus comment.
    const h = host(document.createTextNode("before"), document.createComment(`?marker name="d0"`));
    applyPatch("d0", "<b>late</b>");
    expect(h.innerHTML).toBe("before<b>late</b>");
  });

  it("replaces everything between start and end, placeholder included", () => {
    const h = host(
      document.createComment(`?start name="d0"`),
      el("p", "placeholder"),
      document.createComment("?end"),
    );
    applyPatch("d0", "<b>real</b>");
    expect(h.innerHTML).toBe("<b>real</b>");
  });

  it("matches the end marker of the outermost range when ranges nest", () => {
    const h = host(
      document.createComment(`?start name="outer"`),
      document.createComment(`?start name="inner"`),
      document.createComment("?end"),
      el("i", "gone"),
      document.createComment("?end"),
      el("u", "kept"),
    );
    applyPatch("outer", "<b>x</b>");
    expect(h.innerHTML).toBe("<b>x</b><u>kept</u>");
  });

  it("counts only sibling markers towards nesting depth", () => {
    // `find markers` scans start's next *siblings*; a start marker nested inside a child
    // element must not consume the real sibling `<?end>`.
    const nested = document.createElement("div");
    nested.append(document.createComment(`?start name="other"`));
    const h = host(
      document.createComment(`?start name="d0"`),
      nested,
      document.createComment("?end"),
      el("u", "kept"),
    );
    applyPatch("d0", "<b>real</b>");
    expect(h.innerHTML).toBe("<b>real</b><u>kept</u>");
  });

  it("ignores an end marker that is not a sibling of the start marker", () => {
    // An unbalanced placeholder (`defer(v, '<p>loading')`) makes the parser nest `<?end>`
    // inside the `<p>`. Treating it as the range end deletes unrelated siblings and then
    // throws, because it is not a child of the start marker's parent.
    const nested = document.createElement("p");
    nested.append(document.createTextNode("loading"), document.createComment("?end"));
    const h = host(document.createComment(`?start name="d0"`), nested);
    expect(() => applyPatch("d0", "<b>real</b>")).not.toThrow();
    expect(h.innerHTML).toBe("<b>real</b>");
  });

  it("replaces to the end of the parent when there is no end marker", () => {
    const h = host(document.createComment(`?start name="d0"`), el("p", "loading"), el("i", "tail"));
    applyPatch("d0", "<b>real</b>");
    expect(h.innerHTML).toBe("<b>real</b>");
  });

  it("accepts the self-closing marker form", () => {
    const h = host(document.createComment(`?marker name="d0"?`));
    applyPatch("d0", "ok");
    expect(h.innerHTML).toBe("ok");
  });

  it("finds markers parsed as processing instructions", () => {
    // A browser could ship processing instructions before <template for> itself.
    const h = host(
      document.createProcessingInstruction("start", `name="d0"`),
      el("p", "placeholder"),
      document.createProcessingInstruction("end", ""),
    );
    applyPatch("d0", "<b>real</b>");
    expect(h.innerHTML).toBe("<b>real</b>");
  });

  it("only patches the marker with a matching name", () => {
    const h = host(
      document.createComment(`?marker name="other"`),
      document.createComment(`?marker name="d1"`),
    );
    applyPatch("d1", "<b>hit</b>");
    expect(h.innerHTML).toBe(`<!--?marker name="other"--><b>hit</b>`);
  });

  it("removes the template even when no marker matches", () => {
    document.body.innerHTML = "";
    const template = applyPatch("missing", "<b>orphan</b>");
    expect(template.isConnected).toBe(false);
    expect(document.body.innerHTML).toBe("");
  });

  it("does nothing when the preceding element is not a patch template", () => {
    const h = host(document.createComment(`?marker name="d0"`));
    const notATemplate = document.createElement("div");
    document.body.append(notATemplate);
    runSentinel(notATemplate as unknown as HTMLTemplateElement);
    expect(h.innerHTML).toBe(`<!--?marker name="d0"-->`);
    notATemplate.remove();
  });

  it("feature-detects without dereferencing a missing HTMLTemplateElement", () => {
    // The fallback runs in exactly the environments most likely to lack the global; a bare
    // reference throws before `window.__renduPatch` is ever assigned, after which every
    // sentinel throws too.
    expect(() => new Function("HTMLTemplateElement", source)(undefined)).not.toThrow();
  });
});
