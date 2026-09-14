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
    let r = [`script`, `style`, `textarea`, `title`, `xmp`, `iframe`, `noembed`, `noframes`],
      i = [`noscript`, `style`, `title`, `xmp`, `iframe`, `noembed`, `noframes`];
    function a() {
      let e = ``,
        t = `data`,
        n = 0,
        a = 0,
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
              ? a === 0 && t(`template`)
              : t(`plaintext`);
        },
        h = () => {
          ((t = `data`),
            c === `template`
              ? ((a += l ? -1 : 1), a < s && (s = -1))
              : c === `select`
                ? !l && s < 0
                  ? (s = a)
                  : l && a === s && (s = -1)
                : l
                  ? o.includes(c) && (o = o.filter((e) => e !== c))
                  : c === `noscript` || (s >= 0 && i.includes(c))
                    ? o.includes(c) || o.push(c)
                    : r.includes(c) && ((t = `raw`), (u = c), (d = 0), (f = 0)));
        },
        g = (r) => {
          ((r = e + r), (e = ``));
          let a = ``,
            s = 0,
            g = (e) => {
              s <= e && ((a += r.slice(s, e) + `&lt;`), (s = e + 1));
            },
            _ = (e, t) => {
              for (t < 0 && (t = r.length); o.length > 0 && e < t; e++)
                r.charCodeAt(e) === 60 && g(e);
              return t;
            };
          for (let e = 0; e < r.length; e++) {
            let a = r[e],
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
                (a === `/`
                  ? (t = `endlt`)
                  : a === `!`
                    ? (t = `md`)
                    : a === `?`
                      ? (t = `bogus`)
                      : ((t = y ? `name` : `data`), e--),
                  (l = t === `endlt`));
                break;
              case `endlt`:
                a === `>` ? (t = `data`) : ((t = y ? `name` : `bogus`), e--);
                break;
              case `name`:
                v || a === `/`
                  ? (t = `attr`)
                  : a === `>`
                    ? h()
                    : (c.length < 10 && (c += y ? a.toLowerCase() : a),
                      m(!1) && (g(n), (t = `data`)));
                break;
              case `attr`:
                a === `>` ? h() : !v && a !== `/` && (t = `aname`);
                break;
              case `aname`:
                a === `>` ? h() : a === `/` ? (t = `attr`) : a === `=` && (t = `aval`);
                break;
              case `aval`:
                a === `>` ? h() : a === `"` ? (t = `dq`) : a === `'` ? (t = `sq`) : v || (t = `uq`);
                break;
              case `dq`:
              case `sq`:
                ((e = _(e, r.indexOf(t === `dq` ? `"` : `'`, e))), e < r.length && (t = `attr`));
                break;
              case `uq`:
                a === `>` ? h() : v && (t = `attr`);
                break;
              case `md`:
              case `mdd`:
                a === `-` ? (t = t === `md` ? `mdd` : `cs`) : ((t = `bogus`), e--);
                break;
              case `bogus`:
                ((e = _(e, r.indexOf(`>`, e))), e < r.length && (t = `data`));
                break;
              case `cs`:
              case `csd`:
                a === `>`
                  ? (t = `data`)
                  : a === `-`
                    ? (t = t === `cs` ? `csd` : `ce`)
                    : ((t = `c`), e--);
                break;
              case `c`:
                ((e = _(e, r.indexOf(`-`, e))), e < r.length && (t = `ced`));
                break;
              case `ced`:
                a === `-` ? (t = `ce`) : ((t = `c`), e--);
                break;
              case `ce`:
              case `ceb`:
                a === `>`
                  ? (t = `data`)
                  : a === `-`
                    ? (t = t === `ce` ? `ce` : `ced`)
                    : a === `!` && t === `ce`
                      ? (t = `ceb`)
                      : ((t = `c`), e--);
                break;
              case `raw`:
                d === 0
                  ? ((e = r.indexOf(`<`, e)), e < 0 ? (e = r.length) : ((t = `rlt`), (n = e)))
                  : a === `<`
                    ? ((t = `rlt`), (n = e), (f = 0))
                    : a === `-`
                      ? f++
                      : (a === `>` && f > 1 && (d = 0), (f = 0));
                break;
              case `rlt`:
                ((p = ``),
                  a === `/`
                    ? (t = d === 2 ? `rdname` : `rname`)
                    : a === `!` && u === `script` && d === 0
                      ? (t = `rbang`)
                      : ((t = y && d === 1 ? `rdname` : `raw`), e--));
                break;
              case `rbang`:
              case `rbangd`:
                a === `-`
                  ? t === `rbang`
                    ? (t = `rbangd`)
                    : ((t = `raw`), (d = 1), (f = 2))
                  : ((t = `raw`), e--);
                break;
              case `rname`:
              case `rdname`:
                y
                  ? (p.length < 10 && (p += a.toLowerCase()),
                    p !== u && o.length > 0 && i.includes(p) && g(n))
                  : !v && a !== `/` && a !== `>`
                    ? ((t = `raw`), e--)
                    : t === `rdname`
                      ? ((t = `raw`), p === `script` && (d = 3 - d))
                      : p === u
                        ? ((t = `attr`), (c = u), (l = !0), a === `>` && h())
                        : ((t = `raw`), e--);
            }
          }
          return ((t === `lt` || t === `endlt` || t === `name`) && m(!0)) ||
            (o.length > 0 &&
              s <= n &&
              (t === `rlt` ||
                ((t === `rname` || t === `rdname`) && i.some((e) => e.startsWith(p)))))
            ? ((e = r.slice(n)), (t = t[0] === `r` ? `raw` : `data`), a + r.slice(s, n))
            : a + r.slice(s);
        };
      return {
        guard: g,
        end: () => {
          let n = e && `&lt;` + e.slice(1);
          for (e = ``; t !== `data` || a > 0 || o.length > 0;)
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
    function o(e) {
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
    function s(e, t, r) {
      let i = new TextEncoder(),
        s = new TextDecoder(),
        c = new Set(),
        l = { cancelled: !1, activeReader: void 0 };
      return new ReadableStream({
        async pull(u) {
          let { guard: d, end: f } = a(),
            { seen: p, scan: m } = o(r),
            h,
            g = !1,
            _ = !1,
            v = (e) => {
              l.cancelled || (t.length > 0 && m(e), u.enqueue(i.encode(e)));
            },
            y = () => {
              ((g = !0),
                _ ||
                  ((_ = !0),
                  v(
                    "<script>window.__renduPatch=typeof HTMLTemplateElement<`u`&&`htmlFor`in HTMLTemplateElement.prototype?function(){}:function(){let e=document.currentScript,t=e&&e.previousElementSibling;if(!(!t||t.tagName!==`TEMPLATE`||!t.hasAttribute(`for`)))try{let e=t.getAttribute(`for`);if(!e)return;let n=e=>e.target?`?`+e.target+` `+e.data:e.data,r=document.createTreeWalker(document,192),i=null,a=null;for(let t=r.nextNode();t;t=r.nextNode()){let r=/^\\?(marker|start)\\s+name=[\"']?([^\"'\\s?>]+)/.exec(n(t));if(r&&r[2]===e){i=t,r[1]===`marker`&&(a=t);break}}if(!i)return;if(a!==i)for(let e=i.nextSibling,t=0;e;e=e.nextSibling){if(e.nodeType!==7&&e.nodeType!==8)continue;let r=n(e);if(/^\\?start\\b/.test(r))t++;else if(/^\\?end\\b/.test(r)){if(t===0){a=e;break}t--}}let o=i.parentNode;if(!o)return;if(a!==i)for(let e=i.nextSibling,t;e&&e!==a;e=t)t=e.nextSibling,o.removeChild(e);o.insertBefore(t.content,a),a&&a!==i&&o.removeChild(a),o.removeChild(i)}finally{t.remove()}};<\/script>",
                  )),
                v(`<template for="` + h + `">`));
            },
            b = (e) => {
              if (l.cancelled) return;
              if (h === void 0) {
                ArrayBuffer.isView(e) ? u.enqueue(e) : v(String(e));
                return;
              }
              let t = ArrayBuffer.isView(e) ? s.decode(e, { stream: !0 }) : s.decode() + String(e);
              if (!t) return;
              (g || y(), m(t));
              let n = d(t);
              n && u.enqueue(i.encode(n));
            },
            x = n(l, b);
          for (let t of e) {
            if (l.cancelled) return;
            await x(t);
          }
          let S = async (e, t) => {
              l.activeReader = e;
              try {
                for (let n = t; !n.done; n = await e.read()) {
                  if (l.cancelled) return;
                  b(n.value);
                }
              } finally {
                ((l.activeReader = void 0), c.delete(e), e.releaseLock());
              }
            },
            C = 0,
            w = new Map(),
            T = new Set(),
            E = () => {
              for (; C < t.length;) T.add(t[C++]);
              for (let e of T) p.has(e.name) && (T.delete(e), w.set(e, e.settled));
              if (w.size === 0 && T.size > 0) {
                let e = T.values().next().value;
                (T.delete(e), w.set(e, e.settled));
              }
            };
          for (E(); w.size > 0;) {
            if (l.cancelled) return;
            let e = await Promise.race(w.values());
            if ((w.delete(e.entry), l.cancelled)) return;
            if (!e.failed && e.reader === void 0) {
              let { entry: t, value: n } = e,
                r = n instanceof Response ? n.body : n;
              if (r instanceof ReadableStream && w.size > 0)
                try {
                  let e = r.getReader();
                  (c.add(e),
                    w.set(
                      t,
                      e.read().then(
                        (n) => ({ entry: t, reader: e, first: n }),
                        (e) => ({ entry: t, error: e, failed: !0 }),
                      ),
                    ));
                  continue;
                } catch (n) {
                  e = { entry: t, error: n, failed: !0 };
                }
            }
            if (e.failed) {
              (console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, e.error), E());
              continue;
            }
            h = e.entry.name;
            let t = !1;
            try {
              await (e.reader ? S(e.reader, e.first) : x(e.value));
            } catch (n) {
              ((t = !0), console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, n));
            }
            let n = s.decode();
            (n && b(n), !g && !t && y());
            let r = g ? f() + `</template>` : ``;
            ((h = void 0), (g = !1), r && (v(r), v(`<script>__renduPatch()<\/script>`)), E());
          }
          l.cancelled || u.close();
        },
        cancel(e) {
          l.cancelled = !0;
          let n = l.activeReader;
          l.activeReader = void 0;
          for (let t of c) t.cancel(e).catch(() => {});
          c.clear();
          for (let n of t)
            n.settled?.then(
              (t) => {
                let n = `value` in t ? t.value : void 0,
                  r = n instanceof Response ? n.body : n;
                r instanceof ReadableStream && !r.locked && r.cancel(e).catch(() => {});
              },
              () => {},
            );
          return n?.cancel(e);
        },
      });
    }
    return s;
  })();
  __sink__ = void 0;
  return concatStreams(__chunks__, __deferred__, __deferId__);
}
