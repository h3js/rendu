async function anonymous(__context__) {
  const __chunks__ = [];
  let __sink__ = __chunks__;
  const echo = (chunk) => {
    if (!__sink__)
      throw new Error(
        "echo() was called after the template body finished rendering. echo() must be called synchronously; after an await, return the content from the (deferred) value instead.",
      );
    __sink__.push(chunk);
  };
  with (__context__) {
    echo("Hello, ");
    if (name) echo(await name);
    else echo("Guest");
  }
  __sink__ = undefined;
  const __render__ = async (chunks) => {
    let out = "";
    for (let chunk of chunks) {
      if (typeof chunk === "function") {
        const echoed = (__sink__ = []);
        try {
          chunk = chunk();
        } finally {
          __sink__ = undefined;
        }
        if (echoed.length > 0) {
          if (typeof chunk?.then === "function") {
            chunk.then(undefined, () => {});
          }
          out += await __render__(echoed);
        }
      }
      if (typeof chunk?.then === "function") {
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
}
