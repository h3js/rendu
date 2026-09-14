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
      } finally {
        __sink__ = void 0;
      }
      return (n.length > 0 && e(r) && r.then(void 0, () => {}), [r, n]);
    }
    function n(e, t) {
      if (t instanceof ArrayBuffer || ArrayBuffer.isView(t)) return e.decode(t, { stream: !0 });
      let n = String(t);
      return n && e.decode() + n;
    }
    async function r(i, a) {
      let o = !a;
      a ??= new TextDecoder();
      let s = ``;
      for (let o of i) {
        if (typeof o == `function`) {
          let [e, n] = t(o);
          ((o = e), n.length > 0 && (s += await r(n, a)));
        }
        if ((e(o) && (o = await o), o instanceof Response && (o = o.body), o != null)) {
          if (o instanceof ReadableStream) {
            let e = o.getReader();
            try {
              for (;;) {
                let { value: t, done: r } = await e.read();
                if (r) break;
                s += n(a, t);
              }
            } finally {
              e.releaseLock();
            }
          } else s += n(a, o);
        }
      }
      return o ? s + a.decode() : s;
    }
    return r;
  })();
  __sink__ = void 0;
  return __render__(__chunks__);
}
