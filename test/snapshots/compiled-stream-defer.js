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
    function a(n, r) {
      let a = async (o) => {
        if (typeof o == `function` && !n.cancelled) {
          let [e, n] = t(o);
          o = e;
          try {
            for (let e of n) await a(e);
          } catch (t) {
            for (let r of [...n, e]) i(r, t);
            throw t;
          }
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
      s = [`noscript`, `style`, `title`, `xmp`, `iframe`, `noembed`, `noframes`];
    function c() {
      let e = ``,
        t = `data`,
        n = 0,
        r = 0,
        i = [],
        a = -1,
        c = ``,
        l = !1,
        u = ``,
        d = 0,
        f = 0,
        p = ``,
        m = (e) => {
          let t = (t) => (e ? t.startsWith(c) : t === c);
          return i.length > 0
            ? t(`template`) || (!l && t(`plaintext`))
            : l
              ? r === 0 && t(`template`)
              : t(`plaintext`);
        },
        h = () => {
          ((t = `data`),
            c === `template`
              ? ((r += l ? -1 : 1), r < a && (a = -1))
              : c === `select`
                ? !l && a < 0
                  ? (a = r)
                  : l && r === a && (a = -1)
                : l
                  ? i.includes(c) && (i = i.filter((e) => e !== c))
                  : c === `noscript` || (a >= 0 && s.includes(c))
                    ? i.includes(c) || i.push(c)
                    : o.includes(c) && ((t = `raw`), (u = c), (d = 0), (f = 0)));
        },
        g = (r) => {
          ((r = e + r), (e = ``));
          let a = ``,
            o = 0,
            g = (e) => {
              o <= e && ((a += r.slice(o, e) + `&lt;`), (o = e + 1));
            },
            _ = (e, t) => {
              for (t < 0 && (t = r.length); i.length > 0 && e < t; e++)
                r.charCodeAt(e) === 60 && g(e);
              return t;
            };
          for (let e = 0; e < r.length; e++) {
            let a = r[e],
              o = r.charCodeAt(e),
              v = o === 32 || o === 9 || o === 10 || o === 12 || o === 13,
              y = (o >= 65 && o <= 90) || (o >= 97 && o <= 122);
            switch (
              (o === 60 && i.length > 0 && t !== `data` && t !== `lt` && t[0] !== `r` && g(e), t)
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
                    p !== u && i.length > 0 && s.includes(p) && g(n))
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
            (i.length > 0 &&
              o <= n &&
              (t === `rlt` ||
                ((t === `rname` || t === `rdname`) && s.some((e) => e.startsWith(p)))))
            ? ((e = r.slice(n)), (t = t[0] === `r` ? `raw` : `data`), a + r.slice(o, n))
            : a + r.slice(o);
        };
      return {
        guard: g,
        end: () => {
          let n = e && `&lt;` + e.slice(1);
          for (e = ``; t !== `data` || r > 0 || i.length > 0;)
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
                        ? i.length > 0
                          ? `</` + i[0] + `>`
                          : `</template>`
                        : `>`,
            );
          return n;
        },
      };
    }
    function l(e) {
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
    function u(e, t, o) {
      let s = new TextEncoder(),
        u = new TextDecoder(),
        d = new Set(),
        f = { cancelled: !1, activeReader: void 0 },
        p = (n) => {
          ((f.cancelled = !0), (f.reason = n));
          let r = f.activeReader;
          f.activeReader = void 0;
          for (let e of d) e.cancel(n).catch(() => {});
          d.clear();
          for (let t of e) i(t, n);
          for (let e of t) e.settled?.then((e) => i(`value` in e && e.value, n));
          return r?.cancel(n);
        };
      return new ReadableStream({
        async pull(i) {
          let { guard: m, end: h } = c(),
            { seen: g, found: _, scan: v } = l(o),
            y,
            b = !1,
            x = !1,
            S = (e) => {
              f.cancelled || (t.length > 0 && v(e), i.enqueue(s.encode(e)));
            },
            C = () => {
              ((b = !0),
                x ||
                  ((x = !0),
                  S(
                    "<script>window.__renduPatch=typeof HTMLTemplateElement<`u`&&`htmlFor`in HTMLTemplateElement.prototype?function(){}:function(){let e=document.currentScript,t=e&&e.previousElementSibling;if(!(!t||t.tagName!==`TEMPLATE`||!t.hasAttribute(`for`)))try{let e=t.getAttribute(`for`);if(!e)return;let n=e=>e.target?`?`+e.target+` `+e.data:e.data,r=document.createTreeWalker(document,192),i=null,a=null;for(let t=r.nextNode();t;t=r.nextNode()){let r=/^\\?(marker|start)\\s+name=[\"']?([^\"'\\s?>]+)/.exec(n(t));if(r&&r[2]===e){i=t,r[1]===`marker`&&(a=t);break}}if(!i)return;if(a!==i)for(let e=i.nextSibling,t=0;e;e=e.nextSibling){if(e.nodeType!==7&&e.nodeType!==8)continue;let r=n(e);if(/^\\?start\\b/.test(r))t++;else if(/^\\?end\\b/.test(r)){if(t===0){a=e;break}t--}}let o=i.parentNode;if(!o)return;if(a!==i)for(let e=i.nextSibling,t;e&&e!==a;e=t)t=e.nextSibling,o.removeChild(e);o.insertBefore(t.content,a),a&&a!==i&&o.removeChild(a),o.removeChild(i)}finally{t.remove()}};<\/script>",
                  )),
                S(`<template for="` + y + `">`));
            },
            w = (e) => {
              if (f.cancelled) return;
              if (y === void 0) {
                let t = n(e);
                t ? i.enqueue(t) : S(String(e));
                return;
              }
              let t = r(u, e);
              if (!t) return;
              (b || C(), v(t));
              let a = m(t);
              a && i.enqueue(s.encode(a));
            },
            T = a(f, w);
          try {
            for (let t of e) {
              if (f.cancelled) return;
              await T(t);
            }
          } catch (e) {
            throw (p(e), e);
          }
          let E = async (e, t) => {
              f.activeReader = e;
              try {
                for (let n = t; !n.done; n = await e.read()) {
                  if (f.cancelled) return;
                  w(n.value);
                }
              } finally {
                ((f.activeReader = void 0), d.delete(e), e.releaseLock());
              }
            },
            D = 0,
            O = 0,
            k = [],
            A,
            j = (e) => {
              let t = D++;
              (O++,
                e.then((e) => {
                  if (A) {
                    let t = A;
                    ((A = void 0), t(e));
                    return;
                  }
                  let n = k.length;
                  for (; n > 0 && k[(n - 1) >> 1].at > t;)
                    ((k[n] = k[(n - 1) >> 1]), (n = (n - 1) >> 1));
                  k[n] = { at: t, settled: e };
                }));
            },
            M = () => {
              if (k.length === 0) return new Promise((e) => (A = e));
              let { settled: e } = k[0],
                t = k.pop(),
                n = 0;
              for (
                let e = 1;
                e < k.length &&
                (e + 1 < k.length && k[e + 1].at < k[e].at && e++, !(t.at < k[e].at));
                n = e, e = 2 * n + 1
              )
                k[n] = k[e];
              return (n < k.length && (k[n] = t), e);
            },
            N = 0,
            P = 0,
            F = new Map(),
            I = () => {
              let e = [];
              for (let t of _.splice(0)) {
                let n = F.get(t);
                n !== void 0 && (F.delete(t), e.push(n));
              }
              for (let n of e.sort((e, t) => e - t)) j(t[n].settled);
              for (; N < t.length; N++) {
                let e = t[N];
                g.has(e.name) ? j(e.settled) : F.set(e.name, N);
              }
              if (O === 0 && F.size > 0) {
                for (; !F.has(t[P].name);) P++;
                (F.delete(t[P].name), j(t[P].settled));
              }
            };
          for (I(); O > 0;) {
            if (f.cancelled) return;
            await void 0;
            let e = await M();
            if ((O--, f.cancelled)) return;
            if (!e.failed && e.reader === void 0) {
              let { entry: t, value: n } = e,
                r = n instanceof Response ? n.body : n;
              if (r instanceof ReadableStream && O > 0)
                try {
                  let e = r.getReader();
                  (d.add(e),
                    j(
                      e.read().then(
                        (n) => ({ entry: t, reader: e, first: n }),
                        (n) => (d.delete(e), e.releaseLock(), { entry: t, error: n, failed: !0 }),
                      ),
                    ));
                  continue;
                } catch (n) {
                  e = { entry: t, error: n, failed: !0 };
                }
            }
            if (e.failed) {
              (console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, e.error), I());
              continue;
            }
            y = e.entry.name;
            let t = !1;
            try {
              await (e.reader ? E(e.reader, e.first) : T(e.value));
            } catch (n) {
              ((t = !0), console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, n));
            }
            let n = u.decode();
            (n && (b || !t) && w(n), !b && !t && C());
            let r = b ? h() + `</template>` : ``;
            ((y = void 0), (b = !1), r && (S(r), S(`<script>__renduPatch()<\/script>`)), I());
          }
          f.cancelled || i.close();
        },
        cancel: p,
      });
    }
    return u;
  })();
  __sink__ = void 0;
  return concatStreams(__chunks__, __deferred__, __deferId__);
}
