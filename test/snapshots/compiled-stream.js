async function anonymous(__context__) {
  const __chunks__ = [];
  const echo = (chunk) => {
    __chunks__.push(chunk);
  };
  const __htmlEscapes__ = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function htmlspecialchars(s) {
    return String(s).replace(/[&<>"']/g, (c) => __htmlEscapes__[c] || c);
  }
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
        for (let chunk of chunks) {
          if (cancelled) return;
          if (typeof chunk === "function") {
            chunk = chunk();
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
            activeReader = reader;
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (cancelled) return;
                controller.enqueue(
                  ArrayBuffer.isView(value) ? value : encoder.encode(String(value)),
                );
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
}
