import * as generated from "./runtime/_generated.ts";

/**
 * Runtime helpers that can be inlined before the compiled template body.
 *
 * The sources are typed modules in `src/runtime/`, minified into `src/runtime/_generated.ts`
 * by `pnpm build:runtime` (the generated code carries no comments: document it in the sources).
 *
 * Each helper is a self-contained, single line snippet so the prelude always spans
 * exactly one line no matter which helpers are included (keeps `preserveLines`
 * line offsets constant). `echo` is always required, the other helpers are only
 * injected when the compiled body references them (see `runtimePrelude`).
 */
export const runtimeHelpers = {
  echo: generated.echo,
  htmlspecialchars: generated.htmlspecialchars,
} as const;

export type RuntimeHelper = keyof typeof runtimeHelpers;

const streamHelpers = { ...runtimeHelpers, defer: generated.deferStream };
const textHelpers = { ...runtimeHelpers, defer: generated.deferText };

/**
 * Names of the helpers to inline for a compiled template body: `echo` always, the others
 * only when the body references them (a false positive only costs an unused helper) and
 * they are not in `exclude` (helpers that are provided by the context instead).
 */
function usedHelpers(
  body: string,
  exclude: Iterable<string> = [],
  helpers: Record<string, string> = runtimeHelpers,
): string[] {
  const excluded = new Set(exclude);
  return Object.keys(helpers).filter(
    (name) => name === "echo" || (!excluded.has(name) && referencesIdentifier(body, name)),
  );
}

/**
 * Build the prelude for a compiled template body, only including the optional helpers
 * that the body references. `exclude` lists helpers that are provided by the context instead.
 */
export function runtimePrelude(
  body: string,
  exclude?: Iterable<string>,
  helpers: Record<string, string> = runtimeHelpers,
): string {
  return (
    usedHelpers(body, exclude, helpers)
      .map((name) => helpers[name])
      .join("") + "\n"
  );
}

/**
 * Whether the code contains `name` as a standalone identifier (a simple match, a false
 * positive from a string literal or comment is possible).
 */
export function referencesIdentifier(code: string, name: string): boolean {
  const escaped = name.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
  // Not part of a longer identifier or a property access (`obj.name`, but `...name` is).
  return new RegExp(`(?<![\\w$])(?<!(?<!\\.)\\.)${escaped}(?![\\w$])`).test(code);
}

export type RuntimeOptions = {
  /** Emit the client fallback for browsers without `<template for>` support. */
  polyfill?: boolean;
};

/**
 * Streaming runtime: returns a `ReadableStream` of the chunks in source order (`stream.ts`).
 *
 * Only a template that inlines `defer()` gets the patch machinery (`defer.ts`): the
 * `<template for>` framing and tokenizer guard, marker scanning, the flush loop, the client
 * fallback and the cancellation of deferred bodies. Without `defer()` nothing can be queued, so
 * none of it could ever run.
 */
export function runtimeStream(body: string, exclude?: Iterable<string>, opts: RuntimeOptions = {}) {
  const tail = usedHelpers(body, exclude, streamHelpers).includes("defer")
    ? opts.polyfill === false
      ? generated.streamDefer
      : generated.streamDeferPolyfill
    : generated.stream;
  return `${runtimePrelude(body, exclude, streamHelpers)}${body};\n${tail}\n`;
}

/**
 * Text runtime: renders the chunks in order into a string (`text.ts`). `defer()` returns a
 * marker, as in streaming mode; only a template that inlines it gets the runtime that replaces
 * the markers with the rendered values.
 */
export function runtimeText(body: string, exclude?: Iterable<string>) {
  const tail = usedHelpers(body, exclude, textHelpers).includes("defer")
    ? generated.textDefer
    : generated.text;
  return `${runtimePrelude(body, exclude, textHelpers)}${body};\n${tail}\n`;
}
