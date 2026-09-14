import { callEchoed, discard, isThenable } from "./_shared.ts";

/**
 * Text runtime: renders the chunks in order into a string. A function chunk's synchronous
 * `echo()` output is rendered in place, right before its result (`callEchoed()`), the same as in
 * streaming mode.
 *
 * Built twice, with `__DEFER__` on and off: only a template that inlines `defer()` gets the
 * marker replacement (`renderDeferred()` below).
 */

/** Build flag: the template inlines the text `defer()`, and the generated code passes its queue. */
declare const __DEFER__: boolean;

async function render(chunks: unknown[]): Promise<string> {
  let out = "";
  for (let chunk of chunks) {
    try {
      if (typeof chunk === "function") {
        const [result, echoed] = callEchoed(chunk as () => unknown);
        chunk = result;
        if (echoed.length > 0) {
          out += await render(echoed);
        }
      }
      if (isThenable(chunk)) {
        chunk = await chunk;
      }
      if (chunk instanceof Response) {
        chunk = chunk.body;
      }
      if (chunk === null || chunk === undefined) {
        continue;
      }
      if (chunk instanceof ReadableStream) {
        const reader: ReadableStreamDefaultReader<unknown> = chunk.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            out +=
              typeof value === "string"
                ? value
                : decoder.decode(value as AllowSharedBufferSource, { stream: true });
          }
          out += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      } else if (typeof chunk === "string") {
        out += chunk;
      } else {
        out += ArrayBuffer.isView(chunk) ? new TextDecoder().decode(chunk) : String(chunk);
      }
    } catch (error) {
      // Release what will not be read: the chunks after this one, and a function's result.
      for (const rest of [chunk, ...chunks]) discard(rest, error);
      throw error;
    }
  }
  return out;
}

/** A value queued by the text `defer()`: its marker name and its (already settling) value. */
type TextDeferEntry = [name: string, value: Promise<unknown>];

/**
 * Render the chunks, then the `defer()`red values in `defer()` order, and replace each marker
 * with its value's content, the way the streaming patches would.
 *
 * - `deferred` is walked by index: a function a value resolves to is only called here, and a
 *   `defer()` it calls is queued behind it.
 * - A value that fails rejects the render, whether its marker was written or not (in streaming
 *   mode its patch goes out either way too).
 * - Markers are replaced recursively, only the first occurrence of each (`<template for>` patches
 *   the first marker of a name): a marker inside another deferred value is replaced along with
 *   it, whichever was deferred first. A marker that is never written as markup (not echoed,
 *   escaped with `{{ }}`) is not replaced, and neither is anything that is not this render's
 *   marker (names carry the per-render `deferId`).
 * - When the render fails, the deferred values that will not be read are discarded.
 */
async function renderDeferred(
  chunks: unknown[],
  deferred: TextDeferEntry[],
  deferId: string,
): Promise<string> {
  let out: string;
  const contents = new Map<string, string>();
  try {
    out = await render(chunks);
    for (let i = 0; i < deferred.length; i++) {
      const [name, value] = deferred[i]!;
      contents.set(name, await render([await value]));
    }
  } catch (error) {
    for (const [, value] of deferred) discard(value, error);
    throw error;
  }
  const marker = new RegExp('<\\?marker name="(' + deferId + '\\d+)">', "g");
  const replace = (text: string): string =>
    text.replace(marker, (match, name: string) => {
      const content = contents.get(name);
      if (content === undefined) return match;
      contents.delete(name);
      return replace(content);
    });
  return replace(out);
}

// A pure-annotated call, so the prelude built from this module drops it.
export default /* @__PURE__ */ (() => (__DEFER__ ? renderDeferred : render))();

/**
 * Prelude: `defer()` for text mode, inlined when the body references it (built on its own, without
 * the output loop).
 *
 * There is no stream to reorder, so it returns a marker (like the streaming `defer()`, so string
 * concatenation and nested `defer()` work the same) that `renderDeferred()` replaces with the
 * rendered value. The placeholder, which only exists to be replaced, is dropped.
 *
 * As in streaming mode, the entry is queued before a function value is invoked (so a `defer()`
 * inside it is queued after it), the function is invoked right away (what it echoes
 * synchronously lands before the marker), and the value gets a rejection handler right away
 * (awaiting it later still throws).
 */

const __deferred__: TextDeferEntry[] = [];

let __deferSeq__ = 0;

// A pure-annotated call, so nothing but the prelude keeps it (see `defer.ts`).
const __deferId__ = /* @__PURE__ */ (() => "d" + Math.random().toString(36).slice(2, 8) + "_")();

function defer(value: unknown): string {
  const name = __deferId__ + __deferSeq__++;
  const entry: TextDeferEntry = [name, undefined!];
  __deferred__.push(entry);
  entry[1] = (async () => (typeof value === "function" ? value() : value))();
  entry[1].then(undefined, () => {});
  return '<?marker name="' + name + '">';
}

export { __deferred__, __deferSeq__, __deferId__, defer };
