async function anonymous(__context__) {
  const __chunks__ = [];
  const echo = (chunk) => {
    __chunks__.push(chunk);
  };
  const __htmlEscapes__ = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function htmlspecialchars(s) {
    return String(s).replace(/[&<>"']/g, (c) => __htmlEscapes__[c] || c);
  }
  {
    const { name } = __context__;
    echo("Hello, ");
    if (name) echo(await name);
    else echo("Guest");
  }
  let __out__ = "";
  for (let chunk of __chunks__) {
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
}
