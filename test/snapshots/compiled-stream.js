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
    function n(e) {
      if (e instanceof Uint8Array) return e;
      if (ArrayBuffer.isView(e)) return new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
      if (e instanceof ArrayBuffer) return new Uint8Array(e);
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
    function i(n, i) {
      let a = async (o) => {
        if (typeof o == `function` && !n.cancelled) {
          let [e, n] = t(o);
          o = e;
          for (let e of n) await a(e);
        }
        if ((e(o) && !n.cancelled && (o = await o), n.cancelled)) {
          r(o, n.reason);
          return;
        }
        if ((o instanceof Response && (o = o.body), o != null)) {
          if (o instanceof ReadableStream) {
            let e = o.getReader();
            n.activeReader = e;
            try {
              for (;;) {
                let { value: t, done: r } = await e.read();
                if (r) break;
                if (n.cancelled) return;
                i(t);
              }
            } finally {
              ((n.activeReader = void 0), e.releaseLock());
            }
          } else i(o);
        }
      };
      return a;
    }
    function a(e) {
      let t = new TextEncoder(),
        a = { cancelled: !1, activeReader: void 0 };
      return new ReadableStream({
        async pull(r) {
          let o = i(a, (e) => {
            a.cancelled || r.enqueue(n(e) ?? t.encode(String(e)));
          });
          for (let t of e) {
            if (a.cancelled) return;
            await o(t);
          }
          a.cancelled || r.close();
        },
        cancel(t) {
          ((a.cancelled = !0), (a.reason = t));
          let n = a.activeReader;
          a.activeReader = void 0;
          for (let n of e) r(n, t);
          return n?.cancel(t);
        },
      });
    }
    return a;
  })();
  __sink__ = void 0;
  return concatStreams(__chunks__);
}
