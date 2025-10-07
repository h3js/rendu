async function anonymous(data) {
  const __chunks__ = [];
  const echo = (chunk) => {
    __chunks__.push(chunk);
  };
  with (data) {
    echo("Hello, ");
    if (name) echo(await name);
    else echo("Guest");
  }
  function concatStreams(chunks) {
    const encoder = new TextEncoder();
    return new ReadableStream({
      async pull(controller) {
        for (let chunk of chunks) {
          if (chunk instanceof Promise) {
            chunk = await chunk;
            if (!chunk) continue;
            if (chunk instanceof Response) {
              chunk = chunk.body;
            }
            if (!(chunk instanceof ReadableStream)) {
              controller.enqueue(
                chunk instanceof Uint8Array ? chunk : encoder.encode(chunk),
              );
              continue;
            }
          }
          if (chunk instanceof ReadableStream) {
            const reader = chunk.getReader();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            reader.releaseLock();
          } else {
            controller.enqueue(
              chunk instanceof Uint8Array ? chunk : encoder.encode(chunk),
            );
          }
        }
        controller.close();
      },
    });
  }
  return concatStreams(__chunks__);
}
