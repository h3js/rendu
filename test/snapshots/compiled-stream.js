async function anonymous(__context__) {
  const __chunks__ = [];
  let __sink__ = __chunks__;
  const echo = (e) => {
    if (!__sink__)
      throw Error(
        `echo() was called after the template body finished rendering. echo() must be called synchronously; after an await, return the content from the (deferred) value instead.`,
      );
    __sink__.push(e);
  };
  with (__context__) {
    echo("Hello, ");
    if (name) echo(await name);
    else echo("Guest");
  }
  var concatStreams = (function () {
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
    function n(n, r) {
      let i = async (a) => {
        if (typeof a == `function`) {
          let [e, r] = t(a);
          a = e;
          for (let e of r) {
            if (n.cancelled) return;
            await i(e);
          }
        }
        if ((e(a) && (a = await a), a instanceof Response && (a = a.body), a != null)) {
          if (a instanceof ReadableStream) {
            let e = a.getReader();
            n.activeReader = e;
            try {
              for (;;) {
                let { value: t, done: i } = await e.read();
                if (i) break;
                if (n.cancelled) return;
                r(t);
              }
            } finally {
              ((n.activeReader = void 0), e.releaseLock());
            }
          } else r(a);
        }
      };
      return i;
    }
    function r(e) {
      let t = new TextEncoder(),
        r = { cancelled: !1, activeReader: void 0 };
      return new ReadableStream({
        async pull(i) {
          let a = n(r, (e) => {
            r.cancelled || i.enqueue(ArrayBuffer.isView(e) ? e : t.encode(String(e)));
          });
          for (let t of e) {
            if (r.cancelled) return;
            await a(t);
          }
          r.cancelled || i.close();
        },
        cancel(e) {
          r.cancelled = !0;
          let t = r.activeReader;
          return ((r.activeReader = void 0), t?.cancel(e));
        },
      });
    }
    return r;
  })();
  __sink__ = void 0;
  return concatStreams(__chunks__);
}
