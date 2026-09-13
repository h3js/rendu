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
  function concatStreams(chunks) {
    const encoder = new TextEncoder();
    let activeReader;
    let cancelled = false;
    return new ReadableStream({
      async pull(controller) {
        const enqueue = (value) => {
          if (cancelled) return;
          controller.enqueue(ArrayBuffer.isView(value) ? value : encoder.encode(String(value)));
        };
        const write = async (chunk) => {
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
              for (const part of echoed) {
                if (cancelled) return;
                await write(part);
              }
            }
          }
          if (typeof chunk?.then === "function") {
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
  __sink__ = undefined;
  return concatStreams(__chunks__);
}
