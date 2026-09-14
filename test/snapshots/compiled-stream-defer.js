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
      return ArrayBuffer.isView(e)
        ? new Uint8Array(e.buffer, e.byteOffset, e.byteLength)
        : e instanceof ArrayBuffer
          ? new Uint8Array(e)
          : void 0;
    }
    function r(e, t) {
      if (t instanceof ArrayBuffer || ArrayBuffer.isView(t)) return e.decode(t, { stream: !0 });
      let n = String(t);
      return n && e.decode() + n;
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
    let o = [`script`, `style`, `textarea`, `title`, `xmp`, `iframe`, `noembed`, `noframes`];
    function s() {
      let e = ``,
        t = `data`,
        n = 0,
        r = 0,
        i = 0,
        a = ``,
        s = !1,
        c = ``,
        l = 0,
        u = 0,
        d = ``,
        f = () => {
          ((t = `data`),
            a === `template`
              ? (r += s ? -1 : 1)
              : a === `noscript`
                ? (i = Math.max(0, i + (s ? -1 : 1)))
                : !s && o.includes(a) && ((t = `raw`), (c = a), (l = 0), (u = 0)));
        },
        p = (i) => {
          ((i = e + i), (e = ``));
          let o = ``,
            p = 0;
          for (let e = 0; e < i.length; e++) {
            let m = i[e],
              h = i.charCodeAt(e),
              g = h === 32 || h === 9 || h === 10 || h === 12 || h === 13,
              _ = (h >= 65 && h <= 90) || (h >= 97 && h <= 122);
            switch (t) {
              case `data`:
                ((e = i.indexOf(`<`, e)),
                  e < 0 ? (e = i.length) : ((t = `lt`), (n = e), (a = ``), (s = !1)));
                break;
              case `lt`:
                (m === `/`
                  ? (t = `endlt`)
                  : m === `!`
                    ? (t = `md`)
                    : m === `?`
                      ? (t = `bogus`)
                      : ((t = _ ? `name` : `data`), e--),
                  (s = t === `endlt`));
                break;
              case `endlt`:
                m === `>` ? (t = `data`) : ((t = _ ? `name` : `bogus`), e--);
                break;
              case `name`:
                g || m === `/`
                  ? (t = `attr`)
                  : m === `>`
                    ? f()
                    : (a.length < 10 && (a += _ ? m.toLowerCase() : m),
                      (s ? r === 0 && a === `template` : a === `plaintext`) &&
                        ((o += i.slice(p, n) + `&lt;`), (p = n + 1), (t = `data`)));
                break;
              case `attr`:
                m === `>` ? f() : !g && m !== `/` && (t = `aname`);
                break;
              case `aname`:
                m === `>` ? f() : m === `/` ? (t = `attr`) : m === `=` && (t = `aval`);
                break;
              case `aval`:
                m === `>` ? f() : m === `"` ? (t = `dq`) : m === `'` ? (t = `sq`) : g || (t = `uq`);
                break;
              case `dq`:
              case `sq`:
                ((e = i.indexOf(t === `dq` ? `"` : `'`, e)), e < 0 ? (e = i.length) : (t = `attr`));
                break;
              case `uq`:
                m === `>` ? f() : g && (t = `attr`);
                break;
              case `md`:
              case `mdd`:
                m === `-` ? (t = t === `md` ? `mdd` : `cs`) : ((t = `bogus`), e--);
                break;
              case `bogus`:
                ((e = i.indexOf(`>`, e)), e < 0 ? (e = i.length) : (t = `data`));
                break;
              case `cs`:
              case `csd`:
                m === `>`
                  ? (t = `data`)
                  : m === `-`
                    ? (t = t === `cs` ? `csd` : `ce`)
                    : ((t = `c`), e--);
                break;
              case `c`:
                ((e = i.indexOf(`-`, e)), e < 0 ? (e = i.length) : (t = `ced`));
                break;
              case `ced`:
                m === `-` ? (t = `ce`) : ((t = `c`), e--);
                break;
              case `ce`:
              case `ceb`:
                m === `>`
                  ? (t = `data`)
                  : m === `-`
                    ? (t = t === `ce` ? `ce` : `ced`)
                    : m === `!` && t === `ce`
                      ? (t = `ceb`)
                      : ((t = `c`), e--);
                break;
              case `raw`:
                l === 0
                  ? ((e = i.indexOf(`<`, e)), e < 0 ? (e = i.length) : (t = `rlt`))
                  : m === `<`
                    ? ((t = `rlt`), (u = 0))
                    : m === `-`
                      ? u++
                      : (m === `>` && u > 1 && (l = 0), (u = 0));
                break;
              case `rlt`:
                ((d = ``),
                  m === `/`
                    ? (t = l === 2 ? `rdname` : `rname`)
                    : m === `!` && c === `script` && l === 0
                      ? (t = `rbang`)
                      : ((t = _ && l === 1 ? `rdname` : `raw`), e--));
                break;
              case `rbang`:
              case `rbangd`:
                m === `-`
                  ? t === `rbang`
                    ? (t = `rbangd`)
                    : ((t = `raw`), (l = 1), (u = 2))
                  : ((t = `raw`), e--);
                break;
              case `rname`:
              case `rdname`:
                _
                  ? d.length < 10 && (d += m.toLowerCase())
                  : !g && m !== `/` && m !== `>`
                    ? ((t = `raw`), e--)
                    : t === `rdname`
                      ? ((t = `raw`), d === `script` && (l = 3 - l))
                      : d === c
                        ? ((t = `attr`), (a = c), (s = !0), m === `>` && f())
                        : ((t = `raw`), e--);
            }
          }
          return (t === `lt` || t === `endlt` || t === `name`) &&
            (s ? r === 0 && `template`.startsWith(a) : `plaintext`.startsWith(a))
            ? ((e = i.slice(n)), (t = `data`), o + i.slice(p, n))
            : o + i.slice(p);
        };
      return {
        guard: p,
        end: () => {
          let n = e && `&lt;` + e.slice(1);
          for (e = ``; t !== `data` || r > 0 || i > 0;)
            n += p(
              t === `dq`
                ? `">`
                : t === `sq`
                  ? `'>`
                  : t[0] === `c`
                    ? `-->`
                    : t[0] === `r`
                      ? l === 2
                        ? `-->`
                        : `</` + c + `>`
                      : t === `data`
                        ? i > 0
                          ? `</noscript>`
                          : `</template>`
                        : `>`,
            );
          return n;
        },
      };
    }
    function c(e) {
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
    function l(e, t, o) {
      let l = new TextEncoder(),
        u = new TextDecoder(),
        d = new Set(),
        f = { cancelled: !1, activeReader: void 0 };
      return new ReadableStream({
        async pull(i) {
          let { guard: p, end: m } = s(),
            { seen: h, found: g, scan: _ } = c(o),
            v,
            y = !1,
            b = !1,
            x = (e) => {
              f.cancelled || (t.length > 0 && _(e), i.enqueue(l.encode(e)));
            },
            S = () => {
              ((y = !0),
                b ||
                  ((b = !0),
                  x(
                    "<script>window.__renduPatch=typeof HTMLTemplateElement<`u`&&`htmlFor`in HTMLTemplateElement.prototype?function(){}:function(){let e=document.currentScript,t=e&&e.previousElementSibling;if(!(!t||t.tagName!==`TEMPLATE`||!t.hasAttribute(`for`)))try{let e=t.getAttribute(`for`);if(!e)return;let n=e=>e.target?`?`+e.target+` `+e.data:e.data,r=document.createTreeWalker(document,192),i=null,a=null;for(let t=r.nextNode();t;t=r.nextNode()){let r=/^\\?(marker|start)\\s+name=[\"']?([^\"'\\s?>]+)/.exec(n(t));if(r&&r[2]===e){i=t,r[1]===`marker`&&(a=t);break}}if(!i)return;if(a!==i)for(let e=i.nextSibling,t=0;e;e=e.nextSibling){if(e.nodeType!==7&&e.nodeType!==8)continue;let r=n(e);if(/^\\?start\\b/.test(r))t++;else if(/^\\?end\\b/.test(r)){if(t===0){a=e;break}t--}}let o=i.parentNode;if(!o)return;if(a!==i)for(let e=i.nextSibling,t;e&&e!==a;e=t)t=e.nextSibling,o.removeChild(e);o.insertBefore(t.content,a),a&&a!==i&&o.removeChild(a),o.removeChild(i)}finally{t.remove()}};<\/script>",
                  )),
                x(`<template for="` + v + `">`));
            },
            C = (e) => {
              if (f.cancelled) return;
              if (v === void 0) {
                let t = n(e);
                t ? i.enqueue(t) : x(String(e));
                return;
              }
              let t = r(u, e);
              if (!t) return;
              (y || S(), _(t));
              let a = p(t);
              a && i.enqueue(l.encode(a));
            },
            w = a(f, C);
          for (let t of e) {
            if (f.cancelled) return;
            await w(t);
          }
          let T = async (e, t) => {
              f.activeReader = e;
              try {
                for (let n = t; !n.done; n = await e.read()) {
                  if (f.cancelled) return;
                  C(n.value);
                }
              } finally {
                ((f.activeReader = void 0), d.delete(e), e.releaseLock());
              }
            },
            E = 0,
            D = [],
            O = 0,
            k,
            A = (e) => {
              (E++,
                e.then((e) => {
                  (D.push(e), k?.());
                }));
            },
            j = 0,
            M = 0,
            N = new Map(),
            P = () => {
              for (let e of g.splice(0)) {
                let n = N.get(e);
                n !== void 0 && (N.delete(e), A(t[n].settled));
              }
              for (; j < t.length; j++) {
                let e = t[j];
                h.has(e.name) ? A(e.settled) : N.set(e.name, j);
              }
              if (E === 0 && N.size > 0) {
                for (; !N.has(t[M].name);) M++;
                (N.delete(t[M].name), A(t[M].settled));
              }
            };
          for (P(); E > 0;) {
            if (f.cancelled) return;
            O === D.length && (await new Promise((e) => (k = e)));
            let e = D[O++];
            if ((O === D.length && (D.length = O = 0), E--, f.cancelled)) return;
            if (!e.failed && e.reader === void 0) {
              let { entry: t, value: n } = e,
                r = n instanceof Response ? n.body : n;
              if (r instanceof ReadableStream && E > 0)
                try {
                  let e = r.getReader();
                  (d.add(e),
                    A(
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
              (console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, e.error), P());
              continue;
            }
            v = e.entry.name;
            let t = !1;
            try {
              await (e.reader ? T(e.reader, e.first) : w(e.value));
            } catch (n) {
              ((t = !0), console.error(`[rendu] deferred value ` + e.entry.name + ` failed:`, n));
            }
            let n = u.decode();
            (n && (y || !t) && C(n), !y && !t && S());
            let r = y ? m() + `</template>` : ``;
            ((v = void 0), (y = !1), r && (x(r), x(`<script>__renduPatch()<\/script>`)), P());
          }
          f.cancelled || i.close();
        },
        cancel(n) {
          ((f.cancelled = !0), (f.reason = n));
          let r = f.activeReader;
          f.activeReader = void 0;
          for (let e of d) e.cancel(n).catch(() => {});
          d.clear();
          for (let t of e) i(t, n);
          for (let e of t) e.settled?.then((e) => i(`value` in e && e.value, n));
          return r?.cancel(n);
        },
      });
    }
    return l;
  })();
  __sink__ = void 0;
  return concatStreams(__chunks__, __deferred__, __deferId__);
}
