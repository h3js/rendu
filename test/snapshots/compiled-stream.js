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
    function r(r, i) {
      let a = async (o) => {
        if (typeof o == `function` && !r.cancelled) {
          let [e, r] = t(o);
          o = e;
          try {
            for (let e of r) await a(e);
          } catch (t) {
            for (let i of [...r, e]) n(i, t);
            throw t;
          }
        }
        if ((e(o) && !r.cancelled && (o = await o), r.cancelled)) {
          n(o, r.reason);
          return;
        }
        if ((o instanceof Response && (o = o.body), o != null)) {
          if (o instanceof ReadableStream) {
            let e = o.getReader();
            r.activeReader = e;
            try {
              for (;;) {
                let { value: t, done: n } = await e.read();
                if (n) break;
                if (r.cancelled) return;
                i(t);
              }
            } finally {
              ((r.activeReader = void 0), e.releaseLock());
            }
          } else i(o);
        }
      };
      return a;
    }
    function i(e) {
      let t = new TextEncoder(),
        i = { cancelled: !1, activeReader: void 0 },
        a = (t) => {
          ((i.cancelled = !0), (i.reason = t));
          let r = i.activeReader;
          i.activeReader = void 0;
          for (let r of e) n(r, t);
          return r?.cancel(t);
        };
      return new ReadableStream({
        async pull(n) {
          let o = r(i, (e) => {
            i.cancelled || n.enqueue(ArrayBuffer.isView(e) ? e : t.encode(String(e)));
          });
          try {
            for (let t of e) {
              if (i.cancelled) return;
              await o(t);
            }
          } catch (e) {
            throw (a(e), e);
          }
          i.cancelled || n.close();
        },
        cancel: a,
      });
    }
    return i;
  })();
  __sink__ = void 0;
  return concatStreams(__chunks__);
}
