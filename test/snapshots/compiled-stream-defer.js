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
    __echo__("Hello, ");
    __echo__(defer(name, "<i>Guest</i>"));
    __echo__("!");
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
    function a(n, r) {
      let a = async (o) => {
        if (typeof o == `function` && !n.cancelled) {
          let [e, n] = t(o);
          o = e;
          for (let e of n) await a(e);
        }
        if ((e(o) && !n.cancelled && (o = await o), n.cancelled)) {
          i(o, n.reason);
          return;
        }
        if ((o instanceof Response && (o = o.body), o != null)) {
          if (o instanceof ReadableStream) {
            let e = o.getReader();
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
          } else r(o);
        }
      };
      return a;
    }
    let o = [`script`, `style`, `textarea`, `title`, `xmp`, `iframe`, `noembed`, `noframes`],
      s = [`noscript`, `style`, `title`, `xmp`, `iframe`, `noembed`, `noframes`],
      c = [
        `base`,
        `basefont`,
        `bgsound`,
        `link`,
        `meta`,
        `noframes`,
        `script`,
        `style`,
        `template`,
        `title`,
      ],
      l = [`foreignobject`, `desc`, `title`, `mi`, `mo`, `mn`, `ms`, `mtext`, `annotation-xml`];
    function u() {
      let e = ``,
        t = `data`,
        n = 0,
        r = 0,
        i = [],
        a = -1,
        u = [0],
        d = 0,
        f = 0,
        p = [],
        m = ``,
        h = !1,
        g = ``,
        _ = 0,
        v = 0,
        y = ``,
        b = (e) => {
          let t = (t) => (e ? t.startsWith(m) : t === m);
          return i.length > 0
            ? t(`template`) || (!h && t(`plaintext`))
            : h
              ? r === 0 && t(`template`)
              : t(`plaintext`) || (d + f > 0 && t(`template`));
        },
        x = () => {
          t = `data`;
          let e = u[r],
            n = d + f > 0;
          if ((!h && !e && !c.includes(m) && (u[r] = m === `col` ? 2 : 1), m === `template`)) {
            (h ? (r--, (d = f = 0), (p = [])) : (u[++r] = 0), r < a && (a = -1));
            return;
          }
          e !== 2 &&
            (n &&
              (h
                ? p[p.length - 1] === m && p.pop()
                : p.length > 0
                  ? (d = f = 1 / 0)
                  : l.includes(m) && p.push(m)),
            m === `select`
              ? !h && a < 0
                ? (a = r)
                : h && r === a && (a = -1)
              : h
                ? (i.includes(m) && (i = i.filter((e) => e !== m)),
                  m === `svg` && d > 0 && d--,
                  m === `math` && f > 0 && f--)
                : m === `svg`
                  ? d++
                  : m === `math`
                    ? f++
                    : m === `noscript` || (a >= 0 && s.includes(m)) || (n && o.includes(m))
                      ? i.includes(m) || i.push(m)
                      : o.includes(m) && ((t = `raw`), (g = m), (_ = 0), (v = 0)));
        },
        S = (r) => {
          ((r = e + r), (e = ``));
          let a = ``,
            o = 0,
            s = (e) => {
              o <= e && ((a += r.slice(o, e) + `&lt;`), (o = e + 1));
            },
            c = (e, t) => {
              for (t < 0 && (t = r.length); i.length > 0 && e < t; e++)
                r.charCodeAt(e) === 60 && s(e);
              return t;
            };
          for (let e = 0; e < r.length; e++) {
            let a = r[e],
              o = r.charCodeAt(e),
              l = o === 32 || o === 9 || o === 10 || o === 12 || o === 13,
              u = (o >= 65 && o <= 90) || (o >= 97 && o <= 122);
            switch (
              (o === 60 && i.length > 0 && t !== `data` && t !== `lt` && t[0] !== `r` && s(e), t)
            ) {
              case `data`:
                ((e = r.indexOf(`<`, e)),
                  e < 0 ? (e = r.length) : ((t = `lt`), (n = e), (m = ``), (h = !1)));
                break;
              case `lt`:
                (a === `/`
                  ? (t = `endlt`)
                  : a === `!`
                    ? (t = `md`)
                    : a === `?`
                      ? (t = `bogus`)
                      : ((t = u ? `name` : `data`), e--),
                  (h = t === `endlt`));
                break;
              case `endlt`:
                a === `>` ? (t = `data`) : ((t = u ? `name` : `bogus`), e--);
                break;
              case `name`:
                l || a === `/`
                  ? (t = `attr`)
                  : a === `>`
                    ? x()
                    : (m.length < 15 && (m += u ? a.toLowerCase() : a),
                      b(!1) && (s(n), (t = `data`)));
                break;
              case `attr`:
                a === `>` ? x() : !l && a !== `/` && (t = `aname`);
                break;
              case `aname`:
                a === `>` ? x() : a === `/` ? (t = `attr`) : a === `=` && (t = `aval`);
                break;
              case `aval`:
                a === `>` ? x() : a === `"` ? (t = `dq`) : a === `'` ? (t = `sq`) : l || (t = `uq`);
                break;
              case `dq`:
              case `sq`:
                ((e = c(e, r.indexOf(t === `dq` ? `"` : `'`, e))), e < r.length && (t = `attr`));
                break;
              case `uq`:
                a === `>` ? x() : l && (t = `attr`);
                break;
              case `md`:
              case `mdd`:
                if (a === `-`) t = t === `md` ? `mdd` : `cs`;
                else if (a === `[` && t === `md` && d + f > 0) {
                  let i = r.indexOf(`>`, e),
                    a = (i < 0 ? r.length : i) - n > 16384;
                  !r.startsWith(`[CDATA[`, e) && (i >= 0 || r.length - e >= 7)
                    ? ((t = `bogus`), e--)
                    : i < 0 && !a
                      ? (e = r.length)
                      : !a && i >= e + 9 && r.startsWith(`]]`, i - 2)
                        ? ((e = c(e, i)), (t = `data`))
                        : (s(n), (t = `data`));
                } else ((t = `bogus`), e--);
                break;
              case `bogus`:
                ((e = c(e, r.indexOf(`>`, e))), e < r.length && (t = `data`));
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
                ((e = c(e, r.indexOf(`-`, e))), e < r.length && (t = `ced`));
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
                _ === 0
                  ? ((e = r.indexOf(`<`, e)), e < 0 ? (e = r.length) : ((t = `rlt`), (n = e)))
                  : a === `<`
                    ? ((t = `rlt`), (n = e), (v = 0))
                    : a === `-`
                      ? v++
                      : (a === `>` && v > 1 && (_ = 0), (v = 0));
                break;
              case `rlt`:
                ((y = ``),
                  a === `/`
                    ? (t = _ === 2 ? `rdname` : `rname`)
                    : a === `!` && g === `script` && _ === 0
                      ? (t = `rbang`)
                      : ((t = u && _ === 1 ? `rdname` : `raw`), e--));
                break;
              case `rbang`:
              case `rbangd`:
                a === `-`
                  ? t === `rbang`
                    ? (t = `rbangd`)
                    : ((t = `raw`), (_ = 1), (v = 2))
                  : ((t = `raw`), e--);
                break;
              case `rname`:
              case `rdname`:
                u
                  ? (y.length < 10 && (y += a.toLowerCase()), y !== g && i.includes(y) && s(n))
                  : !l && a !== `/` && a !== `>`
                    ? ((t = `raw`), e--)
                    : t === `rdname`
                      ? ((t = `raw`), y === `script` && (_ = 3 - _))
                      : y === g
                        ? ((t = `attr`), (m = g), (h = !0), a === `>` && x())
                        : ((t = `raw`), e--);
            }
          }
          return ((t === `lt` || t === `endlt` || t === `name`) && b(!0)) ||
            (t === `md` && d + f > 0) ||
            (i.length > 0 &&
              o <= n &&
              (t === `rlt` ||
                ((t === `rname` || t === `rdname`) && i.some((e) => e.startsWith(y)))))
            ? ((e = r.slice(n)), (t = t[0] === `r` ? `raw` : `data`), a + r.slice(o, n))
            : a + r.slice(o);
        };
      return {
        guard: S,
        end: () => {
          let n = e && `&lt;` + e.slice(1);
          for (e = ``; t !== `data` || r > 0 || i.length > 0;)
            n += S(
              t === `dq`
                ? `">`
                : t === `sq`
                  ? `'>`
                  : t[0] === `c`
                    ? `-->`
                    : t[0] === `r`
                      ? _ === 2
                        ? `-->`
                        : `</` + g + `>`
                      : t === `data`
                        ? i.length > 0
                          ? `</` + i[0] + `>`
                          : `</template>`
                        : `>`,
            );
          return n;
        },
      };
    }
    function d(e) {
      let t = new Set(),
        n = [],
        r = `name="` + e,
        i = r.length + 20,
        a = ``,
        o = (e) => {
          for (let i = e.indexOf(r); i >= 0; i = e.indexOf(r, i + r.length)) {
            let a = i + r.length;
            for (; e.charCodeAt(a) >= 48 && e.charCodeAt(a) <= 57;) a++;
            let o = e.slice(i + 6, a);
            e[a] === `"` && a > i + r.length && !t.has(o) && (t.add(o), n.push(o));
          }
        };
      return {
        seen: t,
        found: n,
        scan: (e) => {
          (a && o(a + e.slice(0, i)), o(e), (a = (e.length < i ? a + e : e).slice(-i)));
        },
      };
    }
    function f(e, t, o) {
      let s = new TextEncoder(),
        c = new TextDecoder(),
        l = new Set(),
        f = { cancelled: !1, activeReader: void 0 };
      return new ReadableStream({
        async pull(i) {
          let p,
            { seen: m, found: h, scan: g } = d(o),
            _,
            v = !1,
            y = !1,
            b = (e) => {
              f.cancelled || (t.length > 0 && g(e), i.enqueue(s.encode(e)));
            },
            x = () => {
              ((v = !0),
                (p = u()),
                y ||
                  ((y = !0),
                  b(
                    "<script>window.__renduPatch=typeof HTMLTemplateElement<`u`&&`htmlFor`in HTMLTemplateElement.prototype?function(){}:function(){let e=document.currentScript,t=e&&e.previousElementSibling;if(!(!t||t.tagName!==`TEMPLATE`||!t.hasAttribute(`for`)))try{let e=t.getAttribute(`for`);if(!e)return;let n=e=>e.target?`?`+e.target+` `+e.data:e.data,r=document.createTreeWalker(document,192),i=null,a=null;for(let t=r.nextNode();t;t=r.nextNode()){let r=/^\\?(marker|start)\\s+name=[\"']?([^\"'\\s?>]+)/.exec(n(t));if(r&&r[2]===e){i=t,r[1]===`marker`&&(a=t);break}}if(!i)return;if(a!==i)for(let e=i.nextSibling,t=0;e;e=e.nextSibling){if(e.nodeType!==7&&e.nodeType!==8)continue;let r=n(e);if(/^\\?start\\b/.test(r))t++;else if(/^\\?end\\b/.test(r)){if(t===0){a=e;break}t--}}let o=i.parentNode;if(!o)return;if(a!==i)for(let e=i.nextSibling,t;e&&e!==a;e=t)t=e.nextSibling,o.removeChild(e);o.insertBefore(t.content,a),a&&a!==i&&o.removeChild(a),o.removeChild(i)}finally{t.remove()}};<\/script>",
                  )),
                b(`<template for="` + _ + `">`));
            },
            S = (e) => {
              if (f.cancelled) return;
              if (_ === void 0) {
                let t = n(e);
                t ? i.enqueue(t) : b(String(e));
                return;
              }
              let t = r(c, e);
              if (!t) return;
              (v || x(), g(t));
              let a = p.guard(t);
              a && i.enqueue(s.encode(a));
            },
            C = a(f, S);
          for (let t of e) {
            if (f.cancelled) return;
            await C(t);
          }
          let w = async (e, t) => {
              f.activeReader = e;
              try {
                for (let n = t; !n.done; n = await e.read()) {
                  if (f.cancelled) return;
                  S(n.value);
                }
              } finally {
                ((f.activeReader = void 0), l.delete(e), e.releaseLock());
              }
            },
            T = 0,
            E = 0,
            D = [],
            O,
            k = (e) => {
              let t = T++;
              (E++,
                e.then((e) => {
                  if (O) {
                    let t = O;
                    ((O = void 0), t(e));
                    return;
                  }
                  let n = D.length;
                  for (; n > 0 && D[(n - 1) >> 1].at > t;)
                    ((D[n] = D[(n - 1) >> 1]), (n = (n - 1) >> 1));
                  D[n] = { at: t, settled: e };
                }));
            },
            A = () => {
              if (D.length === 0) return new Promise((e) => (O = e));
              let { settled: e } = D[0],
                t = D.pop(),
                n = 0;
              for (
                let e = 1;
                e < D.length &&
                (e + 1 < D.length && D[e + 1].at < D[e].at && e++, !(t.at < D[e].at));
                n = e, e = 2 * n + 1
              )
                D[n] = D[e];
              return (n < D.length && (D[n] = t), e);
            },
            j = 0,
            M = 0,
            N = new Map(),
            P = () => {
              let e = [];
              for (let t of h.splice(0)) {
                let n = N.get(t);
                n !== void 0 && (N.delete(t), e.push(n));
              }
              for (let n of e.sort((e, t) => e - t)) k(t[n].settled);
              for (; j < t.length; j++) {
                let e = t[j];
                m.has(e.name) ? k(e.settled) : N.set(e.name, j);
              }
              if (E === 0 && N.size > 0) {
                for (; !N.has(t[M].name);) M++;
                (N.delete(t[M].name), k(t[M].settled));
              }
            };
          for (P(); E > 0;) {
            if (f.cancelled) return;
            await void 0;
            let e = await A();
            if ((E--, f.cancelled)) return;
            if (!e.failed && e.reader === void 0) {
              let { entry: t, value: n } = e,
                r = n instanceof Response ? n.body : n;
              if (r instanceof ReadableStream && E > 0)
                try {
                  let e = r.getReader();
                  (l.add(e),
                    k(
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
              (console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, e.error), P());
              continue;
            }
            _ = e.entry.name;
            let t = !1;
            try {
              await (e.reader ? w(e.reader, e.first) : C(e.value));
            } catch (n) {
              ((t = !0), console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, n));
            }
            let n = c.decode();
            (n && (v || !t) && S(n), !v && !t && x());
            let r = v ? p.end() + `</template>` : ``;
            ((_ = void 0), (v = !1), r && (b(r), b(`<script>__renduPatch()<\/script>`)), P());
          }
          f.cancelled || i.close();
        },
        cancel(n) {
          ((f.cancelled = !0), (f.reason = n));
          let r = f.activeReader;
          f.activeReader = void 0;
          for (let e of l) e.cancel(n).catch(() => {});
          l.clear();
          for (let t of e) i(t, n);
          for (let e of t) e.settled?.then((e) => i(`value` in e && e.value, n));
          return r?.cancel(n);
        },
      });
    }
    return f;
  })();
  __sink__ = void 0;
  return concatStreams(__chunks__, __deferred__, __deferId__);
}
