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

/**
 * Build the prelude for a compiled template body, only including the optional helpers
 * that the body references (a false positive only costs an unused helper). `exclude` lists
 * helpers that are provided by the context instead.
 */
export function runtimePrelude(body: string, exclude: Iterable<string> = []): string {
  const excluded = new Set(exclude);
  const helpers: string[] = [runtimeHelpers.echo];
  for (const [name, code] of Object.entries(runtimeHelpers)) {
    if (name !== "echo" && !excluded.has(name) && referencesIdentifier(body, name)) {
      helpers.push(code);
    }
  }
  return helpers.join(" ") + "\n";
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

export function runtimeStream(body: string, exclude?: Iterable<string>) {
  return /* js */ `${runtimePrelude(body, exclude)}${body};
function concatStreams(chunks) {
  const encoder = new TextEncoder();
  let activeReader;
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      for (let chunk of chunks) {
        if (cancelled) return;
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
          activeReader = reader;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (cancelled) return;
              controller.enqueue(ArrayBuffer.isView(value) ? value : encoder.encode(String(value)));
            }
          } finally {
            activeReader = undefined;
            reader.releaseLock();
          }
        } else {
          controller.enqueue(ArrayBuffer.isView(chunk) ? chunk : encoder.encode(String(chunk)));
        }
      }
      if (cancelled) return;
      controller.close();
    },
    cancel(reason) {
      cancelled = true;
      const reader = activeReader;
      activeReader = undefined;
      return reader?.cancel(reason);
    },
  });
}
return concatStreams(__chunks__);
`;
}

export function runtimeText(body: string, exclude?: Iterable<string>) {
  return /* js */ `${runtimePrelude(body, exclude)}${body};
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
