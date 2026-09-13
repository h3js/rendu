import { deferCancel, deferFlush, deferStream, deferText } from "./_defer.ts";

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
 */
// oxfmt-ignore
export const runtimeHelpers = {
  echo: /* js */ `const __chunks__ = []; const echo = (chunk) => { __chunks__.push(chunk); };`,
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

export type RuntimeOptions = {
  /** Emit the client fallback for browsers without `<template for>` support. */
  polyfill?: boolean;
};

/**
 * Streaming runtime: `concatStreams()` writes the chunks in source order, then the
 * `defer()` patches (see `_defer.ts`).
 *
 * While a patch is open, output runs through a guard that escapes `</template` (holding back
 * a trailing fragment that could be the head of a split one): an unbalanced `</template>` in
 * a deferred value would otherwise close the patch early and leak the rest to document level.
 * `openReaders` are readers acquired to race a deferred stream on its first chunk; they lock
 * the upstream body, so `cancel()` releases them itself.
 */
export function runtimeStream(body: string, exclude?: Iterable<string>, opts: RuntimeOptions = {}) {
  const polyfill = opts.polyfill !== false;
  // Without an inlined `defer()` nothing can be queued, so the flush loop gets an empty list.
  const deferred = usedHelpers(body, exclude, streamHelpers).includes("defer")
    ? "__deferred__"
    : "[]";
  return /* js */ `${runtimePrelude(body, exclude, streamHelpers)}${body};
function concatStreams(chunks, deferred) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let activeReader;
  const openReaders = new Set();
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      let inPatch = false;
      let patchTail = "";
      const guard = (text) => {
        text = patchTail + text;
        patchTail = "";
        const i = text.lastIndexOf("<");
        if (i >= 0 && text.length - i < 10 && "<\\/template".startsWith(text.slice(i).toLowerCase())) {
          patchTail = text.slice(i);
          text = text.slice(0, i);
        }
        return text.replace(/<\\/template/gi, "&lt;/template");
      };
      const enqueue = (value) => {
        if (cancelled) return;
        if (inPatch) {
          const text = typeof value === 'string'
            ? value
            : ArrayBuffer.isView(value) ? decoder.decode(value, { stream: true }) : String(value);
          const guarded = guard(text);
          if (guarded) controller.enqueue(encoder.encode(guarded));
          return;
        }
        controller.enqueue(ArrayBuffer.isView(value) ? value : encoder.encode(String(value)));
      };
      const write = async (chunk) => {
        if (typeof chunk === 'function') {
          chunk = chunk();
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
      const drain = async (reader, first) => {
        activeReader = reader;
        try {
          for (let r = first; !r.done; r = await reader.read()) {
            if (cancelled) return;
            enqueue(r.value);
          }
        } finally {
          activeReader = undefined;
          openReaders.delete(reader);
          reader.releaseLock();
        }
      };

      for (const chunk of chunks) {
        if (cancelled) return;
        await write(chunk);
      }

${deferFlush(polyfill)}

      if (cancelled) return;
      controller.close();
    },
    cancel(reason) {
      cancelled = true;
      const reader = activeReader;
      activeReader = undefined;
${deferCancel}
      return reader?.cancel(reason);
    },
  });
}
return concatStreams(__chunks__, ${deferred});
`;
}

export function runtimeText(body: string, exclude?: Iterable<string>) {
  return /* js */ `${runtimePrelude(body, exclude, textHelpers)}${body};
let __out__ = "";
for (let chunk of __chunks__) {
  if (typeof chunk === 'function') {
    chunk = chunk();
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
        __out__ += typeof value === "string" ? value : decoder.decode(value, { stream: true });
      }
      __out__ += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  } else if (typeof chunk === "string") {
    __out__ += chunk;
  } else {
    __out__ += ArrayBuffer.isView(chunk) ? new TextDecoder().decode(chunk) : String(chunk);
  }
}
return __out__;
`;
}
