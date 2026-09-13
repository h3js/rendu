import { deferConcatStreams, deferStream, deferText } from "./_defer.ts";

/**
 * Runtime helpers that can be inlined before the compiled template body.
 *
 * Each helper is a self-contained, single line snippet so the prelude always spans
 * exactly one line no matter which helpers are included (keeps `preserveLines`
 * line offsets constant). `echo` is always required, the other helpers are only
 * injected when the compiled body references them (see `runtimePrelude`).
 *
 * `htmlspecialchars` is declared as a function declaration (function scoped) so a
 * `const { htmlspecialchars } = __context__` inside the (block scoped) body shadows
 * it instead of colliding with it.
 *
 * `echo` pushes into `__sink__`, the chunk list that owns the output at the current point
 * of the render. During the body that is `__chunks__`, the main chunk list. The runtime clears
 * `__sink__` when the body ends and only sets it (to a fresh list) for the synchronous call of a
 * function chunk, so echoed chunks are written in place, right before that function's result
 * (`echoCall` below). Any other call (after an `await`, from a timer) can no longer be tied to a
 * position in the output, so it throws instead of landing wherever the output happens to be.
 * (Without AsyncContext, a call from another async function while the body itself is suspended
 * in an `await` cannot be told apart from the body's own calls, so it is written at the body's
 * current position.)
 */
const lateEcho =
  "echo() was called after the template body finished rendering. echo() must be called " +
  "synchronously; after an await, return the content from the (deferred) value instead.";

// oxfmt-ignore
export const runtimeHelpers = {
  echo: /* js */ `const __chunks__ = []; let __sink__ = __chunks__; const echo = (chunk) => { if (!__sink__) throw new Error(${JSON.stringify(lateEcho)}); __sink__.push(chunk); };`,
  htmlspecialchars: /* js */ `const __htmlEscapes__ = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }; function htmlspecialchars(s) { return String(s).replace(/[&<>"']/g, (c) => __htmlEscapes__[c] || c); }`,
} as const;

export type RuntimeHelper = keyof typeof runtimeHelpers;

const streamHelpers = { ...runtimeHelpers, defer: deferStream };
const textHelpers = { ...runtimeHelpers, defer: deferText };

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
      .join(" ") + "\n"
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

/**
 * Call a function chunk with its own `__sink__` (see `runtimeHelpers.echo`), assigning its
 * result to `chunk`, then run `writeEchoed` (the caller's code to write the chunks it echoed
 * synchronously, `echoed`) before the caller writes the result. `__sink__` is reset to `undefined`, not to the previous sink: the runtime
 * only calls function chunks once the body has ended, and the call is synchronous, so nothing
 * else can run in between.
 *
 * The result is written after the echoed chunks, which can take a while, so a promise result
 * gets a rejection handler right away (awaiting it later still throws): otherwise its rejection
 * would be unhandled in the meantime.
 */
function echoCall(indent: string, writeEchoed: string): string {
  return /* js */ `const echoed = __sink__ = [];
try {
  chunk = chunk();
} finally {
  __sink__ = undefined;
}
if (echoed.length > 0) {
  if (typeof chunk?.then === 'function') {
    chunk.then(undefined, () => {});
  }
  ${writeEchoed}
}`.replaceAll("\n", "\n" + indent);
}

export type RuntimeOptions = {
  /** Emit the client fallback for browsers without `<template for>` support. */
  polyfill?: boolean;
};

/**
 * The parts of `concatStreams()` that only a template calling `defer()` needs. Each one is
 * spliced in as-is (`""` for none): `params` / `args` extend its signature and call, `locals`
 * are declared before the stream, `enqueue` declares `enqueue(value)` (which `write()` feeds),
 * `flush` runs after the main chunks, and `cancel` runs in `cancel()`. Every part but `params`
 * and `args` is whole lines, each ending in a newline.
 */
export type ConcatStreamsParts = ReturnType<typeof deferConcatStreams>;

/** `concatStreams()` for a template without `defer()`: chunks go out in order, as they are. */
const plainConcatStreams: ConcatStreamsParts = {
  params: "",
  args: "",
  locals: "",
  enqueue: /* js */ `      const enqueue = (value) => {
        if (cancelled) return;
        controller.enqueue(ArrayBuffer.isView(value) ? value : encoder.encode(String(value)));
      };
`,
  flush: "",
  cancel: "",
};

/**
 * Streaming runtime: `concatStreams()` writes the chunks in source order.
 *
 * `write()` calls a function chunk through `echoCall()` and writes what it echoed right before
 * its result, recursively, so that output lands in place whether the chunk is in the main
 * document or in a patch. The main chunk list is complete by the time `concatStreams()` runs:
 * `__sink__` is cleared first, so a late `echo()` throws rather than appending to it.
 *
 * Only a template that inlines `defer()` gets the patch machinery (`deferConcatStreams()` in
 * `_defer.ts`): the `<template for>` framing and tokenizer guard, marker scanning, the flush
 * loop, the client fallback and the cancellation of deferred bodies. Without `defer()` nothing
 * can be queued, so none of it could ever run, and `concatStreams()` stays a plain loop.
 */
export function runtimeStream(body: string, exclude?: Iterable<string>, opts: RuntimeOptions = {}) {
  const parts = usedHelpers(body, exclude, streamHelpers).includes("defer")
    ? deferConcatStreams(opts.polyfill !== false)
    : plainConcatStreams;
  return /* js */ `${runtimePrelude(body, exclude, streamHelpers)}${body};
function concatStreams(chunks${parts.params}) {
  const encoder = new TextEncoder();
${parts.locals}  let activeReader;
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
${parts.enqueue}      const write = async (chunk) => {
        if (typeof chunk === 'function') {
          ${echoCall("          ", "for (const part of echoed) {\n    if (cancelled) return;\n    await write(part);\n  }")}
        }
        if (typeof chunk?.then === 'function') {
          chunk = await chunk;
        }
        if (chunk instanceof Response) {
          chunk = chunk.body;
        }
        if (chunk === null || chunk === undefined) {
          return;
        }
        if (chunk instanceof ReadableStream) {
          const reader = chunk.getReader();
          activeReader = reader;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (cancelled) return;
              enqueue(value);
            }
          } finally {
            activeReader = undefined;
            reader.releaseLock();
          }
        } else {
          enqueue(chunk);
        }
      };

      for (const chunk of chunks) {
        if (cancelled) return;
        await write(chunk);
      }
${parts.flush}      if (cancelled) return;
      controller.close();
    },
    cancel(reason) {
      cancelled = true;
      const reader = activeReader;
      activeReader = undefined;
${parts.cancel}      return reader?.cancel(reason);
    },
  });
}
__sink__ = undefined;
return concatStreams(__chunks__${parts.args});
`;
}

/**
 * Text runtime: renders the chunks in order into a string. A function chunk's synchronous
 * `echo()` output is rendered in place, right before its result (`echoCall()`), the same as in
 * streaming mode.
 */
export function runtimeText(body: string, exclude?: Iterable<string>) {
  return /* js */ `${runtimePrelude(body, exclude, textHelpers)}${body};
__sink__ = undefined;
const __render__ = async (chunks) => {
  let out = "";
  for (let chunk of chunks) {
    if (typeof chunk === 'function') {
      ${echoCall("      ", "out += await __render__(echoed);")}
    }
    if (typeof chunk?.then === 'function') {
      chunk = await chunk;
    }
    if (chunk instanceof Response) {
      chunk = chunk.body;
    }
    if (chunk === null || chunk === undefined) {
      continue;
    }
    if (chunk instanceof ReadableStream) {
      const reader = chunk.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          out += typeof value === "string" ? value : decoder.decode(value, { stream: true });
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
};
return __render__(__chunks__);
`;
}
