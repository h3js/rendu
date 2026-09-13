/**
 * `defer()`: out-of-order streaming via `<template for>` patches.
 *
 * Everything here is inlined into compiled templates by `runtimeStream()` / `runtimeText()`
 * in `_runtime.ts`: the `defer()` helper snippets, the client fallback scripts, and the
 * `concatStreams()` fragments that flush and cancel deferred values. The fragments are
 * spliced into `concatStreams()` and use its locals (`chunks`, `deferred`, `enqueue`,
 * `write`, `drain`, `inPatch`, `patchTail`, `decoder`, `openReaders`, `cancelled`).
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
 * - Any falsy placeholder means "no placeholder": `defer(v, cond && skeleton())` must not
 *   render the literal text "false".
 */
// oxfmt-ignore
export const deferStream = /* js */ `const __deferred__ = []; let __deferSeq__ = 0; const __deferId__ = "d" + Math.random().toString(36).slice(2, 8) + "_"; function defer(value, placeholder) { const name = __deferId__ + (__deferSeq__++); const entry = { name, settled: undefined }; entry.settled = (async () => (typeof value === "function" ? value() : value))().then((value) => ({ entry, value }), (error) => ({ entry, error, failed: true })); __deferred__.push(entry); return placeholder ? '<?start name="' + name + '">' + placeholder + '<?end>' : '<?marker name="' + name + '">'; }`;

/**
 * `defer()` for text mode: there is no stream to reorder, so the value is rendered
 * in place (and the placeholder, which only exists to be replaced, is dropped).
 */
export const deferText = /* js */ `function defer(value) { return value; }`;

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
 * `concatStreams()` fragment: flush the queued deferred values, after the main chunks,
 * as `<template for>` patches.
 *
 * - Patches go out in completion order (not source order), so a slow one never blocks a
 *   fast one. Chunks echoed while a deferred value is produced belong to its patch.
 * - A `<template>`'s content has to be contiguous on the wire, so an open patch holds the
 *   loop until it ends. A stream value therefore races on its first chunk: racing on merely
 *   being a stream would let an idle one claim the loop ahead of a finished sibling.
 * - A failed value is logged and skipped (silent by design in `<template for>`): its
 *   placeholder stays, and the head is already committed, so there is no status to fail with.
 * - `flushed` detects a marker nested inside another patch's content: it only enters the
 *   document when that patch is applied, after its own patch already went out and was dropped.
 */
export function deferFlush(polyfill: boolean): string {
  // Emitted only when the fallback is enabled, so the generated code carries no
  // dead `if (false)` branch.
  const helperOnce = /* js */ `        if (!helperSent) {
          helperSent = true;
          enqueue(${patchScriptLiteral});
        }
`;
  const sentinel = /* js */ `        enqueue(${patchSentinelLiteral});
`;
  return /* js */ `      let index = 0;
      let chunkIndex = chunks.length;${polyfill ? "\n      let helperSent = false;" : ""}
      const pending = new Map();
      const flushed = new Set();
      const track = () => {
        while (index < deferred.length) {
          const entry = deferred[index++];
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
        if (typeof settled.value === 'string' && settled.value.includes('<?')) {
          for (const m of settled.value.matchAll(/<\\?(?:marker|start) name="([^"]+)"/g)) {
            if (flushed.has(m[1])) {
              console.error('[rendu] the defer() marker ' + m[1] + ' is nested inside the patch for ' + settled.entry.name + ', so its patch was flushed before the marker reached the document and its content is dropped. Call defer() from inside the deferred value instead of embedding its marker in another one.');
            }
          }
        }
${polyfill ? helperOnce : ""}        enqueue('<template for="' + settled.entry.name + '">');
        inPatch = true;
        try {
          await (settled.reader ? drain(settled.reader, settled.first) : write(settled.value));
          while (chunkIndex < chunks.length) {
            await write(chunks[chunkIndex++]);
          }
        } catch (error) {
          console.error('[rendu] deferred value ' + settled.entry.name + ' failed:', error);
        } finally {
          const rest = (cancelled ? '' : decoder.decode()) + patchTail;
          patchTail = "";
          inPatch = false;
          if (rest) enqueue(rest);
          enqueue('</template>');
          flushed.add(settled.entry.name);
        }
${polyfill ? sentinel : ""}        track();
      }`;
}

/**
 * `concatStreams()` fragment for `cancel()`: release the upstream bodies held by deferred
 * values (racing readers, and values that were queued but never written).
 */
export const deferCancel = /* js */ `      for (const reader of openReaders) reader.cancel(reason).catch(() => {});
      openReaders.clear();
      for (const entry of deferred) {
        entry.settled?.then((settled) => {
          const body = settled.value instanceof Response ? settled.value.body : settled.value;
          if (body instanceof ReadableStream && !body.locked) body.cancel(reason).catch(() => {});
        }, () => {});
      }`;
