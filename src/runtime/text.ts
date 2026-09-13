import { callEchoed, isThenable } from "./_shared.ts";

/**
 * Text runtime: renders the chunks in order into a string. A function chunk's synchronous
 * `echo()` output is rendered in place, right before its result (`callEchoed()`), the same as in
 * streaming mode.
 *
 * The generated code binds the default export to `__render__`, which the text `defer()` below
 * calls.
 */

export default async function render(chunks: unknown[]): Promise<string> {
  let out = "";
  for (let chunk of chunks) {
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
  }
  return out;
}

/**
 * Prelude: `defer()` for text mode, inlined when the body references it (built on its own, without
 * the output loop).
 *
 * There is no stream to reorder, so the value is rendered in place (and the placeholder, which
 * only exists to be replaced, is dropped).
 *
 * It returns a function chunk rather than the value itself so it renders what the streaming
 * patch would: a function value is called (while the output loop calls the returned function,
 * so what it echoes synchronously lands in place, see `prelude.ts`), and a function it resolves to
 * is rendered as a function chunk too, like `write()` does at flush time.
 *
 * A promise value is only awaited when the returned function is rendered, so it gets a rejection
 * handler right away (see `echo()` in `prelude.ts`).
 */

/**
 * The output loop above, as bound by the generated code after the body. (Referencing `render`
 * directly would inline the whole loop into the prelude.)
 */
declare const __render__: (chunks: unknown[]) => Promise<string>;

export function defer(value: unknown): () => Promise<string> {
  if (value instanceof Promise) {
    value.then(undefined, () => {});
  }
  return async () => __render__([await (typeof value === "function" ? value() : value)]);
}
