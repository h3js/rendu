/**
 * `defer()`: out-of-order streaming via `<template for>` patches.
 *
 * Everything here is inlined into compiled templates by `runtimeStream()` / `runtimeText()`
 * in `_runtime.ts`: the `defer()` helper snippets, the client fallback scripts, and the
 * `concatStreams()` fragments that frame, flush and cancel deferred values
 * (`deferConcatStreams()`). The fragments are spliced into `concatStreams()` only when the
 * template calls `defer()`, and use its locals (`deferred`, `deferId`, `controller`, `encoder`, `write`, `cancelled`, the `decoder`
 * and `openReaders` they declare, `guard` / `patchEnd` from `deferGuard`, `seen` / `scan` from
 * `deferScan`, and `patchName` / `patchOpen` / `emit` / `openPatch` from `deferEnqueue`).
 *
 * Spec transcribed in [`.agents/html-template-for.md`](../.agents/html-template-for.md).
 */

/**
 * `defer()` for streaming mode.
 *
 * Emits an HTML processing instruction marker in place and queues the value to be
 * flushed later as `<template for>`, so slow content does not block the rest of the
 * document. See <https://github.com/whatwg/html/pull/11818>.
 *
 * - Marker names carry per-render entropy. `<template for>` matches the *first* marker of
 *   a given name in tree order, so two renders composed into one document (echo() of another
 *   rendu stream, a docs page that shows a literal marker) would otherwise patch each other.
 * - The value is settled in `defer()` rather than at flush time, for two reasons: the
 *   rejection handler is attached while the value is still fresh (attaching it later leaves
 *   a window in which a rejection is unhandled, which terminates the process under Node's
 *   default), and a function is invoked now so its work starts immediately and the
 *   completion race sees the real duration instead of the thunk.
 * - The entry is queued before a function value is invoked, so a `defer()` called inside it is
 *   queued after it: `__deferred__` is in name order, which the flush loop relies on when it
 *   flushes entries whose marker it never saw.
 * - Any falsy placeholder means "no placeholder": `defer(v, cond && skeleton())` must not
 *   render the literal text "false".
 */
// oxfmt-ignore
export const deferStream = /* js */ `const __deferred__ = []; let __deferSeq__ = 0; const __deferId__ = "d" + Math.random().toString(36).slice(2, 8) + "_"; function defer(value, placeholder) { const name = __deferId__ + (__deferSeq__++); const entry = { name, settled: undefined }; __deferred__.push(entry); entry.settled = (async () => (typeof value === "function" ? value() : value))().then((value) => ({ entry, value }), (error) => ({ entry, error, failed: true })); return placeholder ? '<?start name="' + name + '">' + placeholder + '<?end>' : '<?marker name="' + name + '">'; }`;

/**
 * `defer()` for text mode: there is no stream to reorder, so the value is rendered
 * in place (and the placeholder, which only exists to be replaced, is dropped).
 *
 * It returns a function chunk rather than the value itself so it renders what the streaming
 * patch would: a function value is called (while the output loop calls the returned function,
 * so what it echoes synchronously lands in place, see `runtimeHelpers.echo`), and a function it
 * resolves to is rendered as a function chunk too, like `write()` does at flush time.
 * `__render__` is the text runtime's output loop, declared after the body.
 */
export const deferText = /* js */ `function defer(value) { return async () => __render__([await (typeof value === "function" ? value() : value)]); }`;

/**
 * Client fallback for browsers without `<template for>` support.
 *
 * Emitted once before the first patch, followed by a `<script>` sentinel after each
 * `</template>`. The sentinel runs synchronously during parsing, right after the
 * template is complete, so no mutation observer or timing guesswork is needed.
 *
 * In a supporting browser a patched `<template for>` is never inserted into the DOM,
 * so `previousElementSibling` is not a template and the sentinel is a no-op (and the
 * whole helper is a no-op function anyway).
 *
 * Markers are `ProcessingInstruction` nodes where supported; in browsers that predate
 * that they are parsed as bogus comments with data `?marker name="d0"`. Both are walked,
 * since a browser could ship processing instructions before `<template for>`.
 *
 * The marker search follows the spec's "find markers" (see
 * [`.agents/html-template-for.md`](../.agents/html-template-for.md)): the *name* is matched
 * against any descendant in tree order, but the closing `<?end>` is matched only among the
 * start marker's next siblings, and only sibling markers count towards nesting. A missing
 * `<?end>` means the range runs to the end of the parent.
 *
 * A failed patch is silent, but the inert template is always removed.
 */
const patchScript =
  /* html */ `<script>window.__renduPatch=(typeof HTMLTemplateElement!=="undefined"&&"htmlFor" in HTMLTemplateElement.prototype)?function(){}:function(){` +
  /* js */ `var t=document.currentScript&&document.currentScript.previousElementSibling;
if(!t||t.tagName!=="TEMPLATE"||!t.hasAttribute("for"))return;
try{
  var name=t.getAttribute("for");
  if(!name)return;
  var data=function(n){return n.target?"?"+n.target+" "+n.data:n.data};
  var w=document.createTreeWalker(document,192),n,m,start=null,end=null;
  while((n=w.nextNode())){
    m=/^\\?(marker|start)\\s+name=["']?([^"'\\s?>]+)/.exec(data(n));
    if(m&&m[2]===name){start=n;if(m[1]==="marker")end=n;break;}
  }
  if(!start)return;
  if(end!==start){
    for(var s=start.nextSibling,depth=0,d;s;s=s.nextSibling){
      if(s.nodeType!==7&&s.nodeType!==8)continue;
      d=data(s);
      if(/^\\?start\\b/.test(d))depth++;
      else if(/^\\?end\\b/.test(d)){if(depth===0){end=s;break;}depth--;}
    }
  }
  var parent=start.parentNode;
  if(!parent)return;
  if(end!==start){
    for(var c=start.nextSibling,nx;c&&c!==end;c=nx){nx=c.nextSibling;parent.removeChild(c);}
  }
  parent.insertBefore(t.content,end||null);
  if(end&&end!==start)parent.removeChild(end);
  parent.removeChild(start);
}finally{
  t.remove();
}` +
  `};</script>`;

const patchSentinel = /* html */ `<script>__renduPatch()</script>`;

/**
 * The scripts as JS string literals, with `</` escaped so that the *generated source* never
 * contains a literal `</script>` sequence — `compileTemplateToString()` output is documented
 * as embeddable, and an unescaped one would terminate a host `<script>` element early.
 */
const literal = (s: string) => JSON.stringify(s).replaceAll("</", String.raw`<\/`);
const patchScriptLiteral = literal(patchScript);
const patchSentinelLiteral = literal(patchSentinel);

/**
 * `concatStreams()` fragment: the framing of an open patch. Declares `patchTail`,
 * `guard(text)` (patch content → text safe to put on the wire) and `patchEnd()` (the text
 * that has to go out right before the patch's `</template>`).
 *
 * A patch's content is arbitrary, possibly truncated (a stream that errors mid-way) HTML, and
 * the only thing that closes the patch is a `</template>` *end tag token* at nesting depth 0.
 * So `guard()` runs a streaming copy of the HTML tokenizer over it, reduced to the states that
 * decide where a tag, an attribute value, a comment or a raw text element ends:
 *
 * | `ps`                                       | tokenizer state(s)                                 |
 * | ------------------------------------------ | -------------------------------------------------- |
 * | `data`                                     | data                                               |
 * | `lt`, `endlt`, `name`                      | tag open, end tag open, tag name                   |
 * | `attr`                                     | before attribute name, after attribute value (quoted), self-closing start tag |
 * | `aname`, `aval`                            | attribute name + after attribute name, before attribute value |
 * | `dq`, `sq`, `uq`                           | attribute value (double-quoted, single-quoted, unquoted) |
 * | `md`, `mdd`, `bogus`                       | markup declaration open (`<!`, `<!-`), bogus comment (also `<?…>` and `<!DOCTYPE …>`, which end at the first `>` too) |
 * | `cs`, `csd`, `c`, `ced`, `ce`, `ceb`       | comment start, start dash, comment, end dash, end, end bang |
 * | `raw` (`pRaw`, `pSub`, `pDash`)            | RCDATA / RAWTEXT / script data; `pSub` 1 and 2 are script data (double) escaped, `pDash` counts trailing `-` there |
 * | `rlt`, `rname`, `rbang`, `rbangd`, `rdname` | their less-than sign, end tag name, escape start (dash), double escape start/end |
 *
 * (The comment less-than-sign states are left out: they only ever lead back to the comment
 * end states the way the plain `-` transitions already do.)
 *
 * - `</template` is escaped as `&lt;/template` only where it would be a template end tag
 *   closing the patch (data state, no nested template open). Inside an attribute value, a
 *   comment or `<script>` it is left untouched, and a balanced nested `<template>` passes
 *   through (`pDepth`). `<plaintext` is escaped too: nothing can end that element.
 * - A `<`-led fragment at the end of a chunk that could still become one of those two
 *   (`<`, `</te`, `<plain`) is held back in `patchTail` and re-scanned with the next chunk.
 * - `patchEnd()` returns the tokenizer to the data state at depth 0 whatever the content
 *   left open: a dangling tail is escaped, then the minimal closer for the current state is
 *   fed through `guard()` itself until nothing is open (`">` closes an attribute and its tag,
 *   `>` a tag, `-->` a comment, `</script>` a raw text element, `</template>` a nested
 *   template), since closing a tag can open another state (`<script` → `>` → `</script>`).
 *   An unclosed `<noscript>` (raw text in a browser with scripting, markup without) gets a
 *   `</noscript>` before any `</template>`: a stray end tag is ignored either way.
 * - Tree construction is not modelled: `<script>` / `<style>` / `<title>` inside `<svg>` or
 *   `<math>` are treated as raw text although foreign content tokenizes them as markup, and
 *   `<![CDATA[` as a bogus comment. That only matters for content that has `</template`,
 *   `<!--` or an unterminated tag inside those elements.
 */
// oxfmt-ignore
const deferGuard = /* js */ `      let patchTail = "";
      let ps = "data";
      let pAt = 0;
      let pDepth = 0;
      let pNoscript = 0;
      let pName = "";
      let pEnd = false;
      let pRaw = "";
      let pSub = 0;
      let pDash = 0;
      let pBuf = "";
      const rawTextElements = ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"];
      const tagEnd = () => {
        ps = "data";
        if (pName === "template") {
          pDepth += pEnd ? -1 : 1;
        } else if (pName === "noscript") {
          pNoscript = Math.max(0, pNoscript + (pEnd ? -1 : 1));
        } else if (!pEnd && rawTextElements.includes(pName)) {
          ps = "raw";
          pRaw = pName;
          pSub = 0;
          pDash = 0;
        }
      };
      const guard = (text) => {
        text = patchTail + text;
        patchTail = "";
        let out = "";
        let from = 0;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          const code = text.charCodeAt(i);
          const ws = code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
          const alpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
          switch (ps) {
            case "data":
              i = text.indexOf("<", i);
              if (i < 0) {
                i = text.length;
              } else {
                ps = "lt";
                pAt = i;
                pName = "";
                pEnd = false;
              }
              break;
            case "lt":
              if (ch === "/") ps = "endlt";
              else if (ch === "!") ps = "md";
              else if (ch === "?") ps = "bogus";
              else { ps = alpha ? "name" : "data"; i--; }
              pEnd = ps === "endlt";
              break;
            case "endlt":
              if (ch === ">") ps = "data";
              else { ps = alpha ? "name" : "bogus"; i--; }
              break;
            case "name":
              if (ws || ch === "/") {
                ps = "attr";
              } else if (ch === ">") {
                tagEnd();
              } else {
                if (pName.length < 10) pName += alpha ? ch.toLowerCase() : ch;
                if (pEnd ? pDepth === 0 && pName === "template" : pName === "plaintext") {
                  out += text.slice(from, pAt) + "&lt;";
                  from = pAt + 1;
                  ps = "data";
                }
              }
              break;
            case "attr":
              if (ch === ">") tagEnd();
              else if (!ws && ch !== "/") ps = "aname";
              break;
            case "aname":
              if (ch === ">") tagEnd();
              else if (ch === "/") ps = "attr";
              else if (ch === "=") ps = "aval";
              break;
            case "aval":
              if (ch === ">") tagEnd();
              else if (ch === '"') ps = "dq";
              else if (ch === "'") ps = "sq";
              else if (!ws) ps = "uq";
              break;
            case "dq":
            case "sq":
              i = text.indexOf(ps === "dq" ? '"' : "'", i);
              if (i < 0) i = text.length;
              else ps = "attr";
              break;
            case "uq":
              if (ch === ">") tagEnd();
              else if (ws) ps = "attr";
              break;
            case "md":
            case "mdd":
              if (ch === "-") ps = ps === "md" ? "mdd" : "cs";
              else { ps = "bogus"; i--; }
              break;
            case "bogus":
              i = text.indexOf(">", i);
              if (i < 0) i = text.length;
              else ps = "data";
              break;
            case "cs":
            case "csd":
              if (ch === ">") ps = "data";
              else if (ch === "-") ps = ps === "cs" ? "csd" : "ce";
              else { ps = "c"; i--; }
              break;
            case "c":
              i = text.indexOf("-", i);
              if (i < 0) i = text.length;
              else ps = "ced";
              break;
            case "ced":
              if (ch === "-") ps = "ce";
              else { ps = "c"; i--; }
              break;
            case "ce":
            case "ceb":
              if (ch === ">") ps = "data";
              else if (ch === "-") ps = ps === "ce" ? "ce" : "ced";
              else if (ch === "!" && ps === "ce") ps = "ceb";
              else { ps = "c"; i--; }
              break;
            case "raw":
              if (pSub === 0) {
                i = text.indexOf("<", i);
                if (i < 0) i = text.length;
                else ps = "rlt";
              } else if (ch === "<") {
                ps = "rlt";
                pDash = 0;
              } else if (ch === "-") {
                pDash++;
              } else {
                if (ch === ">" && pDash > 1) pSub = 0;
                pDash = 0;
              }
              break;
            case "rlt":
              pBuf = "";
              if (ch === "/") ps = pSub === 2 ? "rdname" : "rname";
              else if (ch === "!" && pRaw === "script" && pSub === 0) ps = "rbang";
              else { ps = alpha && pSub === 1 ? "rdname" : "raw"; i--; }
              break;
            case "rbang":
            case "rbangd":
              if (ch !== "-") { ps = "raw"; i--; }
              else if (ps === "rbang") ps = "rbangd";
              else { ps = "raw"; pSub = 1; pDash = 2; }
              break;
            case "rname":
            case "rdname":
              if (alpha) {
                if (pBuf.length < 10) pBuf += ch.toLowerCase();
              } else if (!ws && ch !== "/" && ch !== ">") {
                ps = "raw";
                i--;
              } else if (ps === "rdname") {
                ps = "raw";
                if (pBuf === "script") pSub = 3 - pSub;
              } else if (pBuf === pRaw) {
                ps = "attr";
                pName = pRaw;
                pEnd = true;
                if (ch === ">") tagEnd();
              } else {
                ps = "raw";
                i--;
              }
              break;
          }
        }
        if ((ps === "lt" || ps === "endlt" || ps === "name") && (pEnd ? pDepth === 0 && "template".startsWith(pName) : "plaintext".startsWith(pName))) {
          patchTail = text.slice(pAt);
          ps = "data";
          return out + text.slice(from, pAt);
        }
        return out + text.slice(from);
      };
      const patchEnd = () => {
        let out = patchTail && "&lt;" + patchTail.slice(1);
        patchTail = "";
        while (ps !== "data" || pDepth > 0 || pNoscript > 0) {
          out += guard(
            ps === "dq" ? '">'
              : ps === "sq" ? "'>"
              : ps[0] === "c" ? "-->"
              : ps[0] === "r" ? (pSub === 2 ? "-->" : "</" + pRaw + ">")
              : ps !== "data" ? ">"
              : pNoscript > 0 ? "</noscript>" : "</template>",
          );
        }
        return out;
      };`;

/**
 * `concatStreams()` fragment: record which markers have been emitted. Declares `seen` (the
 * names of this render's `<?marker name>` / `<?start name>` markers found in the output so
 * far) and `scan(text)`, which `enqueue()` calls on every chunk of text it writes, in the main
 * document and in patches alike, while any `defer()` has been called (`deferred` is non-empty).
 *
 * - A patch only applies to a marker that is already in the document, so the flush loop holds
 *   an entry back until its marker has been seen: a marker nested in another deferred value
 *   reaches the document only with that value's patch. A marker seen in an open patch is in
 *   the document by the time a later patch is parsed, because patches are contiguous and
 *   applied in order.
 * - It matches `name="` + the per-render `deferId` + digits + `"`: marker names carry the
 *   render's entropy, so nothing but this render's `defer()` produces the needle, and
 *   `<template for="...">` (`for=`, not `name=`) and an escaped marker (`&quot;`) do not match.
 * - `seenTail` keeps the last few characters so a marker split across chunks (a deferred stream
 *   cut mid-marker) is still found: the boundary is rescanned as `seenTail` plus the head of
 *   the next chunk, which is short, so a chunk is never copied whole. A match found twice is
 *   harmless.
 * - Only text is scanned: byte chunks in the main document pass through as they are, without
 *   decoding. A marker is a string returned by `defer()`; it can only turn into bytes in the
 *   main document if the template encodes it itself, and no foreign stream (another render,
 *   a fetched body) can contain this render's names. Patch content is decoded for `guard()`
 *   anyway, so a marker in a deferred stream or Response is found. An entry whose marker is
 *   never seen is not lost either: the flush loop flushes it once nothing else can emit one.
 */
// oxfmt-ignore
const deferScan = /* js */ `      const seen = new Set();
      const needle = 'name="' + deferId;
      const reach = needle.length + 20;
      let seenTail = "";
      const find = (text) => {
        for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
          let j = i + needle.length;
          while (text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) j++;
          if (text[j] === '"' && j > i + needle.length) seen.add(text.slice(i + 6, j));
        }
      };
      const scan = (text) => {
        if (seenTail) find(seenTail + text.slice(0, reach));
        find(text);
        seenTail = (text.length < reach ? seenTail + text : text).slice(-reach);
      };`;

/**
 * `concatStreams()` fragment: `enqueue(value)`, the patch-aware writer. Declares `patchName`
 * (the entry being flushed, `undefined` outside a patch), `patchOpen`, `emit(text)` (text for
 * the main document) and `openPatch()`.
 *
 * - Outside a patch, byte chunks pass through as they are and text is scanned for markers
 *   once any `defer()` has been called (see `deferScan`).
 * - Inside a patch, output is decoded and runs through `guard()`. A string chunk first flushes
 *   the decoder, so bytes still pending from a previous chunk go out ahead of it, not after.
 * - The patch is opened lazily, by the first chunk that has content (`openPatch()`: the client
 *   fallback before the first patch, then `<template for>`). A value that fails before that
 *   emits no patch at all, so its placeholder stays: even an empty `<template for>` would
 *   replace it. The flush loop opens the patch itself for a value that succeeds empty.
 */
function deferEnqueue(polyfill: boolean): string {
  // Emitted only when the fallback is enabled, so the generated code carries no
  // dead `if (false)` branch.
  const helperOnce = /* js */ `        if (!helperSent) {
          helperSent = true;
          emit(${patchScriptLiteral});
        }
`;
  return /* js */ `      let patchName;
      let patchOpen = false;${polyfill ? "\n      let helperSent = false;" : ""}
      const emit = (text) => {
        if (cancelled) return;
        if (deferred.length > 0) scan(text);
        controller.enqueue(encoder.encode(text));
      };
      const openPatch = () => {
        patchOpen = true;
${polyfill ? helperOnce : ""}        emit('<template for="' + patchName + '">');
      };
      const enqueue = (value) => {
        if (cancelled) return;
        if (patchName === undefined) {
          if (ArrayBuffer.isView(value)) controller.enqueue(value);
          else emit(String(value));
          return;
        }
        const text = ArrayBuffer.isView(value)
          ? decoder.decode(value, { stream: true })
          : decoder.decode() + String(value);
        if (!text) return;
        if (!patchOpen) openPatch();
        scan(text);
        const guarded = guard(text);
        if (guarded) controller.enqueue(encoder.encode(guarded));
      };`;
}

/**
 * `concatStreams()` fragment: flush the queued deferred values, after the main chunks,
 * as `<template for>` patches. Declares `drain(reader, first)`, which writes a stream whose
 * first chunk was already read by the race.
 *
 * - Patches go out in completion order (not source order), so a slow one never blocks a
 *   fast one. A function value is called by `write()` inside the patch, so what it echoes
 *   synchronously is written in place there. Nothing else can add output: `echo()` throws once
 *   the template body has ended (see `runtimeHelpers.echo`), so a late echo fails its own
 *   deferred value instead of landing in whichever patch happens to be open.
 * - A `<template>`'s content has to be contiguous on the wire, so an open patch holds the
 *   loop until it ends. A stream value therefore races on its first chunk: racing on merely
 *   being a stream would let an idle one claim the loop ahead of a finished sibling.
 * - A failed value is logged and skipped (silent by design in `<template for>`): the head is
 *   already committed, so there is no status to fail with. A value that fails before any
 *   content emits no patch (see `deferEnqueue`), so its placeholder stays, whether it failed
 *   racing or while it was written (as the last pending entry, a stream is written without
 *   racing). A value that fails mid-stream has already been partly written into its open
 *   patch: that part stays, and `patchEnd()` closes whatever it left open so later patches
 *   are unaffected.
 * - An entry races only once its marker has been `seen` (`pending`); until then it waits in
 *   `parked`. That is what makes nested `defer()` work: a marker inside another deferred value
 *   (a string, stream, Response or function result, at any depth) reaches the document with
 *   that value's patch, so the inner patch has to go out after it, whichever settles first.
 *   `track()` re-checks the parked entries after every patch, which is the only time `seen`
 *   can grow once the main chunks are written.
 * - When no entry is left racing, nothing can emit a marker any more (markers are only written
 *   by patches now, and every patch is followed by `track()`), so the oldest parked entry is
 *   flushed anyway, and the next one after it, until none is left and the stream closes. Its
 *   marker was never echoed, was escaped, or is nested in a value that failed, so its patch
 *   usually cannot apply. It is scanned like any other patch, though, and one at a time in
 *   `defer()` order rather than racing them: an inner `defer()` called while the outer value is
 *   produced is always queued after it, so it still goes out after the outer patch that holds
 *   its marker (which matters if that marker did reach the document unseen, as bytes the
 *   template encoded itself). Nothing that could apply waits behind it, since nothing is racing.
 */
function deferFlush(polyfill: boolean): string {
  const sentinel = /* js */ `          emit(${patchSentinelLiteral});
`;
  return /* js */ `      const drain = async (reader, first) => {
        activeReader = reader;
        try {
          for (let r = first; !r.done; r = await reader.read()) {
            if (cancelled) return;
            enqueue(r.value);
          }
        } finally {
          activeReader = undefined;
          openReaders.delete(reader);
          reader.releaseLock();
        }
      };
      let index = 0;
      const pending = new Map();
      const parked = new Set();
      const track = () => {
        while (index < deferred.length) {
          parked.add(deferred[index++]);
        }
        for (const entry of parked) {
          if (seen.has(entry.name)) {
            parked.delete(entry);
            pending.set(entry, entry.settled);
          }
        }
        if (pending.size === 0 && parked.size > 0) {
          const [entry] = parked;
          parked.delete(entry);
          pending.set(entry, entry.settled);
        }
      };
      track();
      while (pending.size > 0) {
        if (cancelled) return;
        let settled = await Promise.race(pending.values());
        pending.delete(settled.entry);
        if (cancelled) return;
        if (!settled.failed && settled.reader === undefined) {
          const body = settled.value instanceof Response ? settled.value.body : settled.value;
          if (body instanceof ReadableStream && pending.size > 0) {
            const reader = body.getReader();
            openReaders.add(reader);
            pending.set(settled.entry, reader.read().then(
              (first) => ({ entry: settled.entry, reader, first }),
              (error) => ({ entry: settled.entry, error, failed: true }),
            ));
            continue;
          }
        }
        if (settled.failed) {
          console.error('[rendu] deferred value ' + settled.entry.name + ' failed:', settled.error);
          track();
          continue;
        }
        patchName = settled.entry.name;
        let failed = false;
        try {
          await (settled.reader ? drain(settled.reader, settled.first) : write(settled.value));
        } catch (error) {
          failed = true;
          console.error('[rendu] deferred value ' + settled.entry.name + ' failed:', error);
        }
        const rest = decoder.decode();
        if (rest) enqueue(rest);
        if (!patchOpen && !failed) openPatch();
        const end = patchOpen ? patchEnd() + '</template>' : '';
        patchName = undefined;
        patchOpen = false;
        if (end) {
          emit(end);
${polyfill ? sentinel : ""}        }
        track();
      }`;
}

/**
 * `concatStreams()` fragment for `cancel()`: release the upstream bodies held by deferred
 * values (racing readers, and values that were queued but never written).
 */
const deferCancel = /* js */ `      for (const reader of openReaders) reader.cancel(reason).catch(() => {});
      openReaders.clear();
      for (const entry of deferred) {
        entry.settled?.then((settled) => {
          const body = settled.value instanceof Response ? settled.value.body : settled.value;
          if (body instanceof ReadableStream && !body.locked) body.cancel(reason).catch(() => {});
        }, () => {});
      }
`;

/**
 * The defer-only parts of `concatStreams()` (see `ConcatStreamsParts` in `_runtime.ts`), for a
 * template that calls `defer()`. `openReaders` are readers acquired to race a deferred stream on
 * its first chunk; they lock the upstream body, so `cancel()` releases them itself.
 */
export function deferConcatStreams(polyfill: boolean) {
  return {
    params: ", deferred, deferId",
    args: ", __deferred__, __deferId__",
    locals: /* js */ `  const decoder = new TextDecoder();
  const openReaders = new Set();
`,
    enqueue: `${deferGuard}\n${deferScan}\n${deferEnqueue(polyfill)}\n`,
    flush: `\n${deferFlush(polyfill)}\n\n`,
    cancel: deferCancel,
  };
}
