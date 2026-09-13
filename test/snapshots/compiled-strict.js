async function anonymous(__context__) {
  const __chunks__ = [];
  let __sink__ = __chunks__;
  const echo = (e) => {
    if (!__sink__)
      throw Error(
        `echo() was called after the template body finished rendering. echo() must be called synchronously; after an await, return the content from the (deferred) value instead.`,
      );
    (e instanceof Promise && e.then(void 0, () => {}), __sink__.push(e));
  };
  {
    const { name } = __context__;
    echo("Hello, ");
    if (name) echo(await name);
    else echo("Guest");
  }
  var __render__ = (function () {
    function e(e) {
      return typeof e?.then == `function`;
    }
    function t(t) {
      let n = (__sink__ = []),
        r;
      try {
        r = t();
      } finally {
        __sink__ = void 0;
      }
      return (n.length > 0 && e(r) && r.then(void 0, () => {}), [r, n]);
    }
    async function n(r) {
      let i = ``;
      for (let a of r) {
        if (typeof a == `function`) {
          let [e, r] = t(a);
          ((a = e), r.length > 0 && (i += await n(r)));
        }
        if ((e(a) && (a = await a), a instanceof Response && (a = a.body), a != null)) {
          if (a instanceof ReadableStream) {
            let e = a.getReader(),
              t = new TextDecoder();
            try {
              for (;;) {
                let { value: n, done: r } = await e.read();
                if (r) break;
                i += typeof n == `string` ? n : t.decode(n, { stream: !0 });
              }
              i += t.decode();
            } finally {
              e.releaseLock();
            }
          } else
            i +=
              typeof a == `string`
                ? a
                : ArrayBuffer.isView(a)
                  ? new TextDecoder().decode(a)
                  : String(a);
        }
      }
      return i;
    }
    return n;
  })();
  __sink__ = void 0;
  return __render__(__chunks__);
}
