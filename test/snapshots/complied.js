async function anonymous(__context__) {
  const __chunks__ = [];
  let __sink__ = __chunks__;
  const __echo__ = (e) => {
      if (!__sink__)
        throw Error(
          `echo() was called after the template body finished rendering. echo() must be called synchronously; after an await, return the content from the (deferred) value instead.`,
        );
      (e instanceof Promise && e.then(void 0, () => {}), __sink__.push(e));
    },
    echo = __echo__;
  with (__context__) {
    __echo__("Hello, ");
    if (name) __echo__(await name);
    else __echo__("Guest");
  }
  var __render__ = (function () {
    function e(e) {
      return typeof e?.then == `function`;
    }
    function t(t) {
      let r = (__sink__ = []),
        i;
      try {
        i = t();
      } catch (e) {
        for (let t of r) n(t, e);
        throw e;
      } finally {
        __sink__ = void 0;
      }
      return (r.length > 0 && e(i) && i.then(void 0, () => {}), [i, r]);
    }
    function n(t, r) {
      if (e(t)) {
        t.then(
          (e) => n(e, r),
          () => {},
        );
        return;
      }
      let i = t instanceof Response ? t.body : t;
      i instanceof ReadableStream && !i.locked && i.cancel(r).catch(() => {});
    }
    async function r(i) {
      let a = ``;
      for (let o of i)
        try {
          if (typeof o == `function`) {
            let [e, n] = t(o);
            ((o = e), n.length > 0 && (a += await r(n)));
          }
          if ((e(o) && (o = await o), o instanceof Response && (o = o.body), o == null)) continue;
          if (o instanceof ReadableStream) {
            let e = o.getReader(),
              t = new TextDecoder();
            try {
              for (;;) {
                let { value: n, done: r } = await e.read();
                if (r) break;
                a += typeof n == `string` ? n : t.decode(n, { stream: !0 });
              }
              a += t.decode();
            } finally {
              e.releaseLock();
            }
          } else
            a +=
              typeof o == `string`
                ? o
                : ArrayBuffer.isView(o)
                  ? new TextDecoder().decode(o)
                  : String(o);
        } catch (e) {
          for (let t of [o, ...i]) n(t, e);
          throw e;
        }
      return a;
    }
    return r;
  })();
  __sink__ = void 0;
  return __render__(__chunks__);
}
