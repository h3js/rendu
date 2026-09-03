// Shared prelude injected before the compiled template body.
// Provides `echo()` (chunk collector) and an inlined `htmlspecialchars()` so
// that compiled templates can be rendered without a render context.
// `htmlspecialchars` is declared as a function declaration (function scoped) so
// a `const { htmlspecialchars } = __context__` inside the (block scoped) body
// shadows it instead of colliding with it.
const prelude = /* js */ `const __chunks__ = [];
const echo = (chunk) => { __chunks__.push(chunk); };
const __htmlEscapes__ = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function htmlspecialchars(s) {
  return String(s).replace(/[&<>"']/g, (c) => __htmlEscapes__[c] || c);
}
`;

export function runtimeStream(body: string) {
  return /* js */ `${prelude}${body};
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

export function runtimeText(body: string) {
  return /* js */ `${prelude}${body};
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
