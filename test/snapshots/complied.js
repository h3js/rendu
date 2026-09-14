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
      let n = (__sink__ = []),
        i;
      try {
        i = t();
      } catch (e) {
        for (let t of n) r(t, e);
        throw e;
      } finally {
        __sink__ = void 0;
      }
      return (n.length > 0 && e(i) && i.then(void 0, () => {}), [i, n]);
    }
    function n(e, t) {
      if (ArrayBuffer.isView(t)) return e.decode(t, { stream: !0 });
      let n = String(t);
      return n && e.decode() + n;
    }
    function r(t, n) {
      if (e(t)) {
        t.then(
          (e) => r(e, n),
          () => {},
        );
        return;
      }
      let i = t instanceof Response ? t.body : t;
      i instanceof ReadableStream && !i.locked && i.cancel(n).catch(() => {});
    }
    async function i(a, o) {
      let s = !o;
      o ??= new TextDecoder();
      let c = ``;
      for (let s of a)
        try {
          if (typeof s == `function`) {
            let [e, n] = t(s);
            ((s = e), n.length > 0 && (c += await i(n, o)));
          }
          if ((e(s) && (s = await s), s instanceof Response && (s = s.body), s == null)) continue;
          if (s instanceof ReadableStream) {
            let e = s.getReader();
            try {
              for (;;) {
                let { value: t, done: r } = await e.read();
                if (r) break;
                c += n(o, t);
              }
            } finally {
              e.releaseLock();
            }
          } else c += n(o, s);
        } catch (e) {
          for (let t of [s, ...a]) r(t, e);
          throw e;
        }
      return s ? c + o.decode() : c;
    }
    return i;
  })();
  __sink__ = void 0;
  return __render__(__chunks__);
}
