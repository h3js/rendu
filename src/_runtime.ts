export function runtimeStream(body: string) {
  return /* js */ `const __chunks__ = [];const echo = (chunk) => { __chunks__.push(chunk); };${body};
function concatStreams(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      for (let chunk of chunks) {
        if (typeof chunk === 'function'){
          chunk = chunk();
        }
        if (chunk instanceof Promise) {
          chunk = await chunk;
          if (!chunk) continue;
          if (chunk instanceof Response){
              chunk = chunk.body;
          }
          if (!(chunk instanceof ReadableStream)) {
            controller.enqueue(chunk instanceof Uint8Array ? chunk : encoder.encode(chunk));
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
          controller.enqueue(chunk instanceof Uint8Array ? chunk : encoder.encode(chunk));
        }
      }
      controller.close();
    },
});
    }
    return concatStreams(__chunks__);
`;
}

export function runtimeText(body: string) {
  return /* js */ `const __chunks__ = [];const echo = (chunk) => { __chunks__.push(chunk); };${body};
let __out__ = "";
for(let chunk of __chunks__){
  if (typeof chunk === 'function'){
    chunk = chunk();
  }
  if (chunk instanceof Promise){
    chunk = await chunk;
  }
  if (chunk instanceof Response){
    chunk = chunk.body;
  }
  if (chunk instanceof ReadableStream){
    const reader = chunk.getReader();
    while(true){
      const {value, done} = await reader.read();
      if(done) break;
      __out__ += typeof value === "string" ? value : new TextDecoder().decode(value);
    }
    reader.releaseLock();
  } else {
    __out__ += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
  }
}
return __out__;
    `;
}
