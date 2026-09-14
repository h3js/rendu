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
  {
    const { name } = __context__;
    {
      __echo__("Hello, ");
      if (name) __echo__(await name);
      else __echo__("Guest");
    }
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
      } catch (e) {
        for (let t of n) i(t, e);
        throw e;
      } finally {
        __sink__ = void 0;
      }
      return (n.length > 0 && e(r) && r.then(void 0, () => {}), [r, n]);
    }
    function n(e) {
      if (e instanceof Uint8Array) return e;
      if (ArrayBuffer.isView(e)) return new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
      if (e instanceof ArrayBuffer) return new Uint8Array(e);
    }
    function r(e, t) {
      let r = n(t);
      if (r) return e.decode(r, { stream: !0 });
      let i = String(t);
      return i && e.decode() + i;
    }
    function i(t, n) {
      if (e(t)) {
        t.then(
          (e) => i(e, n),
          () => {},
        );
        return;
      }
      let r = t instanceof Response ? t.body : t;
      r instanceof ReadableStream && !r.locked && r.cancel(n).catch(() => {});
    }
    async function a(n, o) {
      let s = !o;
      o ??= new TextDecoder();
      let c = ``;
      for (let s of n)
        try {
          if (typeof s == `function`) {
            let [e, n] = t(s);
            ((s = e), n.length > 0 && (c += await a(n, o)));
          }
          if ((e(s) && (s = await s), s instanceof Response && (s = s.body), s == null)) continue;
          if (s instanceof ReadableStream) {
            let e = s.getReader();
            try {
              for (;;) {
                let { value: t, done: n } = await e.read();
                if (n) break;
                c += r(o, t);
              }
            } finally {
              e.releaseLock();
            }
          } else c += r(o, s);
        } catch (e) {
          for (let t of [s, ...n]) i(t, e);
          throw e;
        }
      return s ? c + o.decode() : c;
    }
    return a;
  })();
  __sink__ = void 0;
  return __render__(__chunks__);
}
