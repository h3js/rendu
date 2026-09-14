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
  const __deferred__ = [];
  let __deferSeq__ = 0;
  const __deferId__ = `d` + Math.random().toString(36).slice(2, 8) + `_`;
  function defer(e, t) {
    let n = __deferId__ + __deferSeq__++,
      r = { name: n, settled: void 0 };
    return (
      __deferred__.push(r),
      (r.settled = (async () => (typeof e == `function` ? e() : e))().then(
        (e) => ({ entry: r, value: e }),
        (e) => ({ entry: r, error: e, failed: !0 }),
      )),
      t ? `<?start name="` + n + `">` + t + `<?end>` : `<?marker name="` + n + `">`
    );
  }
  with (__context__) {
    echo("Hello, ");
    echo(defer(name, "<i>Guest</i>"));
    echo("!");
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
    let i = [`script`, `style`, `textarea`, `title`, `xmp`, `iframe`, `noembed`, `noframes`],
      a = [`noscript`, `style`, `title`, `xmp`, `iframe`, `noembed`, `noframes`];
    function o() {
      let e = ``,
        t = `data`,
        n = 0,
        r = 0,
        o = [],
        s = -1,
        c = ``,
        l = !1,
        u = ``,
        d = 0,
        f = 0,
        p = ``,
        m = (e) => {
          let t = (t) => (e ? t.startsWith(c) : t === c);
          return o.length > 0
            ? t(`template`) || (!l && t(`plaintext`))
            : l
              ? r === 0 && t(`template`)
              : t(`plaintext`);
        },
        h = () => {
          ((t = `data`),
            c === `template`
              ? ((r += l ? -1 : 1), r < s && (s = -1))
              : c === `select`
                ? !l && s < 0
                  ? (s = r)
                  : l && r === s && (s = -1)
                : l
                  ? o.includes(c) && (o = o.filter((e) => e !== c))
                  : c === `noscript` || (s >= 0 && a.includes(c))
                    ? o.includes(c) || o.push(c)
                    : i.includes(c) && ((t = `raw`), (u = c), (d = 0), (f = 0)));
        },
        g = (r) => {
          ((r = e + r), (e = ``));
          let i = ``,
            s = 0,
            g = (e) => {
              s <= e && ((i += r.slice(s, e) + `&lt;`), (s = e + 1));
            },
            _ = (e, t) => {
              for (t < 0 && (t = r.length); o.length > 0 && e < t; e++)
                r.charCodeAt(e) === 60 && g(e);
              return t;
            };
          for (let e = 0; e < r.length; e++) {
            let i = r[e],
              s = r.charCodeAt(e),
              v = s === 32 || s === 9 || s === 10 || s === 12 || s === 13,
              y = (s >= 65 && s <= 90) || (s >= 97 && s <= 122);
            switch (
              (s === 60 && o.length > 0 && t !== `data` && t !== `lt` && t[0] !== `r` && g(e), t)
            ) {
              case `data`:
                ((e = r.indexOf(`<`, e)),
                  e < 0 ? (e = r.length) : ((t = `lt`), (n = e), (c = ``), (l = !1)));
                break;
              case `lt`:
                (i === `/`
                  ? (t = `endlt`)
                  : i === `!`
                    ? (t = `md`)
                    : i === `?`
                      ? (t = `bogus`)
                      : ((t = y ? `name` : `data`), e--),
                  (l = t === `endlt`));
                break;
              case `endlt`:
                i === `>` ? (t = `data`) : ((t = y ? `name` : `bogus`), e--);
                break;
              case `name`:
                v || i === `/`
                  ? (t = `attr`)
                  : i === `>`
                    ? h()
                    : (c.length < 10 && (c += y ? i.toLowerCase() : i),
                      m(!1) && (g(n), (t = `data`)));
                break;
              case `attr`:
                i === `>` ? h() : !v && i !== `/` && (t = `aname`);
                break;
              case `aname`:
                i === `>` ? h() : i === `/` ? (t = `attr`) : i === `=` && (t = `aval`);
                break;
              case `aval`:
                i === `>` ? h() : i === `"` ? (t = `dq`) : i === `'` ? (t = `sq`) : v || (t = `uq`);
                break;
              case `dq`:
              case `sq`:
                ((e = _(e, r.indexOf(t === `dq` ? `"` : `'`, e))), e < r.length && (t = `attr`));
                break;
              case `uq`:
                i === `>` ? h() : v && (t = `attr`);
                break;
              case `md`:
              case `mdd`:
                i === `-` ? (t = t === `md` ? `mdd` : `cs`) : ((t = `bogus`), e--);
                break;
              case `bogus`:
                ((e = _(e, r.indexOf(`>`, e))), e < r.length && (t = `data`));
                break;
              case `cs`:
              case `csd`:
                i === `>`
                  ? (t = `data`)
                  : i === `-`
                    ? (t = t === `cs` ? `csd` : `ce`)
                    : ((t = `c`), e--);
                break;
              case `c`:
                ((e = _(e, r.indexOf(`-`, e))), e < r.length && (t = `ced`));
                break;
              case `ced`:
                i === `-` ? (t = `ce`) : ((t = `c`), e--);
                break;
              case `ce`:
              case `ceb`:
                i === `>`
                  ? (t = `data`)
                  : i === `-`
                    ? (t = t === `ce` ? `ce` : `ced`)
                    : i === `!` && t === `ce`
                      ? (t = `ceb`)
                      : ((t = `c`), e--);
                break;
              case `raw`:
                d === 0
                  ? ((e = r.indexOf(`<`, e)), e < 0 ? (e = r.length) : ((t = `rlt`), (n = e)))
                  : i === `<`
                    ? ((t = `rlt`), (n = e), (f = 0))
                    : i === `-`
                      ? f++
                      : (i === `>` && f > 1 && (d = 0), (f = 0));
                break;
              case `rlt`:
                ((p = ``),
                  i === `/`
                    ? (t = d === 2 ? `rdname` : `rname`)
                    : i === `!` && u === `script` && d === 0
                      ? (t = `rbang`)
                      : ((t = y && d === 1 ? `rdname` : `raw`), e--));
                break;
              case `rbang`:
              case `rbangd`:
                i === `-`
                  ? t === `rbang`
                    ? (t = `rbangd`)
                    : ((t = `raw`), (d = 1), (f = 2))
                  : ((t = `raw`), e--);
                break;
              case `rname`:
              case `rdname`:
                y
                  ? (p.length < 10 && (p += i.toLowerCase()),
                    p !== u && o.length > 0 && a.includes(p) && g(n))
                  : !v && i !== `/` && i !== `>`
                    ? ((t = `raw`), e--)
                    : t === `rdname`
                      ? ((t = `raw`), p === `script` && (d = 3 - d))
                      : p === u
                        ? ((t = `attr`), (c = u), (l = !0), i === `>` && h())
                        : ((t = `raw`), e--);
            }
          }
          return ((t === `lt` || t === `endlt` || t === `name`) && m(!0)) ||
            (o.length > 0 &&
              s <= n &&
              (t === `rlt` ||
                ((t === `rname` || t === `rdname`) && a.some((e) => e.startsWith(p)))))
            ? ((e = r.slice(n)), (t = t[0] === `r` ? `raw` : `data`), i + r.slice(s, n))
            : i + r.slice(s);
        };
      return {
        guard: g,
        end: () => {
          let n = e && `&lt;` + e.slice(1);
          for (e = ``; t !== `data` || r > 0 || o.length > 0;)
            n += g(
              t === `dq`
                ? `">`
                : t === `sq`
                  ? `'>`
                  : t[0] === `c`
                    ? `-->`
                    : t[0] === `r`
                      ? d === 2
                        ? `-->`
                        : `</` + u + `>`
                      : t === `data`
                        ? o.length > 0
                          ? `</` + o[0] + `>`
                          : `</template>`
                        : `>`,
            );
          return n;
        },
      };
    }
    function s(e) {
      let t = new Set(),
        n = `name="` + e,
        r = n.length + 20,
        i = ``,
        a = (e) => {
          for (let r = e.indexOf(n); r >= 0; r = e.indexOf(n, r + n.length)) {
            let i = r + n.length;
            for (; e.charCodeAt(i) >= 48 && e.charCodeAt(i) <= 57;) i++;
            e[i] === `"` && i > r + n.length && t.add(e.slice(r + 6, i));
          }
        };
      return {
        seen: t,
        scan: (e) => {
          (i && a(i + e.slice(0, r)), a(e), (i = (e.length < r ? i + e : e).slice(-r)));
        },
      };
    }
    function c(e, t, i) {
      let a = new TextEncoder(),
        c = new TextDecoder(),
        l = new Set(),
        u = { cancelled: !1, activeReader: void 0 },
        d = (r) => {
          ((u.cancelled = !0), (u.reason = r));
          let i = u.activeReader;
          u.activeReader = void 0;
          for (let e of l) e.cancel(r).catch(() => {});
          l.clear();
          for (let t of e) n(t, r);
          for (let e of t) e.settled?.then((e) => n(`value` in e && e.value, r));
          return i?.cancel(r);
        };
      return new ReadableStream({
        async pull(n) {
          let { guard: f, end: p } = o(),
            { seen: m, scan: h } = s(i),
            g,
            _ = !1,
            v = !1,
            y = (e) => {
              u.cancelled || (t.length > 0 && h(e), n.enqueue(a.encode(e)));
            },
            b = () => {
              ((_ = !0),
                v ||
                  ((v = !0),
                  y(
                    "<script>window.__renduPatch=typeof HTMLTemplateElement<`u`&&`htmlFor`in HTMLTemplateElement.prototype?function(){}:function(){let e=document.currentScript,t=e&&e.previousElementSibling;if(!(!t||t.tagName!==`TEMPLATE`||!t.hasAttribute(`for`)))try{let e=t.getAttribute(`for`);if(!e)return;let n=e=>e.target?`?`+e.target+` `+e.data:e.data,r=document.createTreeWalker(document,192),i=null,a=null;for(let t=r.nextNode();t;t=r.nextNode()){let r=/^\\?(marker|start)\\s+name=[\"']?([^\"'\\s?>]+)/.exec(n(t));if(r&&r[2]===e){i=t,r[1]===`marker`&&(a=t);break}}if(!i)return;if(a!==i)for(let e=i.nextSibling,t=0;e;e=e.nextSibling){if(e.nodeType!==7&&e.nodeType!==8)continue;let r=n(e);if(/^\\?start\\b/.test(r))t++;else if(/^\\?end\\b/.test(r)){if(t===0){a=e;break}t--}}let o=i.parentNode;if(!o)return;if(a!==i)for(let e=i.nextSibling,t;e&&e!==a;e=t)t=e.nextSibling,o.removeChild(e);o.insertBefore(t.content,a),a&&a!==i&&o.removeChild(a),o.removeChild(i)}finally{t.remove()}};<\/script>",
                  )),
                y(`<template for="` + g + `">`));
            },
            x = (e) => {
              if (u.cancelled) return;
              if (g === void 0) {
                ArrayBuffer.isView(e) ? n.enqueue(e) : y(String(e));
                return;
              }
              let t = ArrayBuffer.isView(e) ? c.decode(e, { stream: !0 }) : c.decode() + String(e);
              if (!t) return;
              (_ || b(), h(t));
              let r = f(t);
              r && n.enqueue(a.encode(r));
            },
            S = r(u, x);
          try {
            for (let t of e) {
              if (u.cancelled) return;
              await S(t);
            }
          } catch (e) {
            throw (d(e), e);
          }
          let C = async (e, t) => {
              u.activeReader = e;
              try {
                for (let n = t; !n.done; n = await e.read()) {
                  if (u.cancelled) return;
                  x(n.value);
                }
              } finally {
                ((u.activeReader = void 0), l.delete(e), e.releaseLock());
              }
            },
            w = 0,
            T = new Map(),
            E = new Set(),
            D = () => {
              for (; w < t.length;) E.add(t[w++]);
              for (let e of E) m.has(e.name) && (E.delete(e), T.set(e, e.settled));
              if (T.size === 0 && E.size > 0) {
                let e = E.values().next().value;
                (E.delete(e), T.set(e, e.settled));
              }
            };
          for (D(); T.size > 0;) {
            if (u.cancelled) return;
            let e = await Promise.race(T.values());
            if ((T.delete(e.entry), u.cancelled)) return;
            if (!e.failed && e.reader === void 0) {
              let { entry: t, value: n } = e,
                r = n instanceof Response ? n.body : n;
              if (r instanceof ReadableStream && T.size > 0)
                try {
                  let e = r.getReader();
                  (l.add(e),
                    T.set(
                      t,
                      e.read().then(
                        (n) => ({ entry: t, reader: e, first: n }),
                        (n) => (l.delete(e), e.releaseLock(), { entry: t, error: n, failed: !0 }),
                      ),
                    ));
                  continue;
                } catch (n) {
                  e = { entry: t, error: n, failed: !0 };
                }
            }
            if (e.failed) {
              (console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, e.error), D());
              continue;
            }
            g = e.entry.name;
            let t = !1;
            try {
              await (e.reader ? C(e.reader, e.first) : S(e.value));
            } catch (n) {
              ((t = !0), console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, n));
            }
            let n = c.decode();
            (n && x(n), !_ && !t && b());
            let r = _ ? p() + `</template>` : ``;
            ((g = void 0), (_ = !1), r && (y(r), y(`<script>__renduPatch()<\/script>`)), D());
          }
          u.cancelled || n.close();
        },
        cancel: d,
      });
    }
    return c;
  })();
  __sink__ = void 0;
  return concatStreams(__chunks__, __deferred__, __deferId__);
}
