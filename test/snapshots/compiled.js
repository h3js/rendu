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
  let __out__ = "";
  for (let chunk of __chunks__) {
    if (chunk instanceof Promise) {
      chunk = await chunk;
    }
    if (chunk instanceof Response) {
      chunk = chunk.body;
    }
    if (chunk instanceof ReadableStream) {
      const reader = chunk.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        __out__ +=
          typeof value === "string" ? value : new TextDecoder().decode(value);
      }
      reader.releaseLock();
    } else {
      __out__ +=
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    }
  }
  return __out__;
}
