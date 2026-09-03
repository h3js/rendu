// Shared prelude injected before the compiled template body.
// Provides `echo()` (chunk collector), `defer()` (out-of-order streaming) and an
// inlined `htmlspecialchars()` so that compiled templates can be rendered without
// a render context.
// `htmlspecialchars` is declared as a function declaration (function scoped) so
// a `const { htmlspecialchars } = __context__` inside the (block scoped) body
// shadows it instead of colliding with it.
function prelude(defer: string) {
  return /* js */ `const __chunks__ = [];
const echo = (chunk) => { __chunks__.push(chunk); };
const __htmlEscapes__ = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function htmlspecialchars(s) {
  return String(s).replace(/[&<>"']/g, (c) => __htmlEscapes__[c] || c);
}
${defer}
`;
}

/**
 * `defer()` for streaming mode.
 *
 * Emits an HTML processing instruction marker in place and queues the value to be
 * flushed later as `<template for>`, so slow content does not block the rest of the
 * document. See <https://github.com/whatwg/html/pull/11818>.
 */
const deferStream = /* js */ `const __deferred__ = [];
let __deferSeq__ = 0;
// Marker names carry per-render entropy. \`<template for>\` matches the *first* marker of
// a given name in tree order, so two renders composed into one document (echo() of another
// rendu stream, a docs page that shows a literal marker) would otherwise patch each other.
const __deferId__ = "d" + Math.random().toString(36).slice(2, 8) + "_";
function defer(value, placeholder) {
  const name = __deferId__ + (__deferSeq__++);
  const entry = { name, settled: undefined };
  // Settled here rather than at flush time, for two reasons: the rejection handler is
  // attached while the value is still fresh (attaching it later leaves a window in which
  // a rejection is unhandled, which terminates the process under Node's default), and a
  // function is invoked now so its work starts immediately and the completion race sees
  // the real duration instead of the thunk.
  entry.settled = (async () => (typeof value === "function" ? value() : value))().then(
    (value) => ({ entry, value }),
    (error) => ({ entry, error, failed: true }),
  );
  __deferred__.push(entry);
  // Any falsy placeholder means "no placeholder": \`defer(v, cond && skeleton())\` must not
  // render the literal text "false".
  return placeholder
    ? '<?start name="' + name + '">' + placeholder + '<?end>'
    : '<?marker name="' + name + '">';
}`;

/**
 * `defer()` for text mode: there is no stream to reorder, so the value is rendered
 * in place (and the placeholder, which only exists to be replaced, is dropped).
 */
const deferText = /* js */ `function defer(value) {
  return value;
}`;

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
 */
const patchScript =
  /* html */ `<script>window.__renduPatch=(typeof HTMLTemplateElement!=="undefined"&&"htmlFor" in HTMLTemplateElement.prototype)?function(){}:function(){` +
  /* js */ `var t=document.currentScript&&document.currentScript.previousElementSibling;
if(!t||t.tagName!=="TEMPLATE"||!t.hasAttribute("for"))return;
try{
  var name=t.getAttribute("for");
  if(!name)return;
  // A marker is a ProcessingInstruction where those are parsed, and a bogus comment
  // where they are not; normalize both to the same leading-question-mark shape.
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
  // end===null: no matching <?end>, so the range runs to the end of the parent.
  if(end!==start){
    for(var c=start.nextSibling,nx;c&&c!==end;c=nx){nx=c.nextSibling;parent.removeChild(c);}
  }
  parent.insertBefore(t.content,end||null);
  if(end&&end!==start)parent.removeChild(end);
  parent.removeChild(start);
}finally{
  // A failed patch is silent by design: never leave the inert template behind.
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

export type RuntimeOptions = {
  /** Emit the client fallback for browsers without `<template for>` support. */
  polyfill?: boolean;
};

export function runtimeStream(body: string, opts: RuntimeOptions = {}) {
  const polyfill = opts.polyfill !== false;
  // Emitted only when the fallback is enabled, so the generated code carries no
  // dead `if (false)` branch.
  const helperOnce = /* js */ `        if (!helperSent) {
          helperSent = true;
          enqueue(${patchScriptLiteral});
        }
`;
  const sentinel = /* js */ `        enqueue(${patchSentinelLiteral});
`;
  return /* js */ `${prelude(deferStream)}${body};
function concatStreams(chunks, deferred) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let activeReader;
  // Readers acquired to race a deferred stream on its first chunk. They hold a lock on the
  // upstream body, so cancel() has to release them itself.
  const openReaders = new Set();
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      // Content written between a <template for> start and end tag runs through a guard:
      // an unbalanced </template> in a deferred value would otherwise close the patch
      // envelope early and relocate the rest of the value to document level.
      let inPatch = false;
      let patchTail = "";
      const guard = (text) => {
        text = patchTail + text;
        patchTail = "";
        // Hold back a trailing fragment that could be the head of a split "</template".
        const i = text.lastIndexOf("<");
        if (i >= 0 && text.length - i < 10 && "<\\/template".startsWith(text.slice(i).toLowerCase())) {
          patchTail = text.slice(i);
          text = text.slice(0, i);
        }
        return text.replace(/<\\/template/gi, "&lt;/template");
      };
      const enqueue = (value) => {
        if (cancelled) return;
        if (inPatch) {
          const text = typeof value === 'string'
            ? value
            : ArrayBuffer.isView(value) ? decoder.decode(value, { stream: true }) : String(value);
          const guarded = guard(text);
          if (guarded) controller.enqueue(encoder.encode(guarded));
          return;
        }
        controller.enqueue(ArrayBuffer.isView(value) ? value : encoder.encode(String(value)));
      };
      const write = async (chunk) => {
        if (typeof chunk === 'function') {
          chunk = chunk();
        }
        if (typeof chunk?.then === 'function') {
          chunk = await chunk;
        }
        if (chunk instanceof Response) {
          chunk = chunk.body;
        }
        if (chunk === null || chunk === undefined) {
          return;
        }
        if (chunk instanceof ReadableStream) {
          const reader = chunk.getReader();
          activeReader = reader;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (cancelled) return;
              enqueue(value);
            }
          } finally {
            activeReader = undefined;
            reader.releaseLock();
          }
        } else {
          enqueue(chunk);
        }
      };
      // Drain a reader whose first chunk has already been read (see the first-chunk race).
      const drain = async (reader, first) => {
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

      for (const chunk of chunks) {
        if (cancelled) return;
        await write(chunk);
      }

      // Deferred content, flushed in completion order (not source order) so a slow
      // patch never blocks a fast one. Each is emitted as a <template for> patch
      // targeting the marker that defer() left behind.
      let index = 0;
      // Chunks appended from here on come from echo() calls made while a deferred value
      // was being produced, so they belong to that value's patch.
      let chunkIndex = chunks.length;${polyfill ? "\n      let helperSent = false;" : ""}
      const pending = new Map();
      // Names already patched, used to detect a marker that was nested inside another
      // patch's content: it only enters the document when *that* patch is applied, so its
      // own patch went out too early and the browser drops it.
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
            // A <template>'s content has to be contiguous on the wire, so whichever patch
            // opens first holds the loop until it ends. A stream is therefore only as ready
            // as its first chunk: racing it on merely *being* a stream lets one that has
            // produced nothing claim the loop ahead of a finished sibling, and parking it
            // behind every pending value pins it to the slowest one. Race the first read.
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
          // A failed patch is silent by design in <template for>: the placeholder stays and
          // the document keeps streaming. The head and shell are already committed, so
          // there is no status left to fail with — report it instead of killing the body.
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
      }

      if (cancelled) return;
      controller.close();
    },
    cancel(reason) {
      cancelled = true;
      const reader = activeReader;
      activeReader = undefined;
      for (const reader of openReaders) reader.cancel(reason).catch(() => {});
      openReaders.clear();
      // Deferred values that were queued but never written hold their own upstream bodies.
      for (const entry of deferred) {
        entry.settled?.then((settled) => {
          const body = settled.value instanceof Response ? settled.value.body : settled.value;
          if (body instanceof ReadableStream && !body.locked) body.cancel(reason).catch(() => {});
        }, () => {});
      }
      return reader?.cancel(reason);
    },
  });
}
return concatStreams(__chunks__, __deferred__);
`;
}

export function runtimeText(body: string) {
  return /* js */ `${prelude(deferText)}${body};
let __out__ = "";
for (let chunk of __chunks__) {
  if (typeof chunk === 'function') {
    chunk = chunk();
  }
  if (typeof chunk?.then === 'function') {
    chunk = await chunk;
  }
  if (chunk instanceof Response) {
    chunk = chunk.body;
  }
  if (chunk === null || chunk === undefined) {
    continue;
  }
  if (chunk instanceof ReadableStream) {
    const reader = chunk.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        __out__ += typeof value === "string" ? value : decoder.decode(value, { stream: true });
      }
      __out__ += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  } else if (typeof chunk === "string") {
    __out__ += chunk;
  } else {
    __out__ += ArrayBuffer.isView(chunk) ? new TextDecoder().decode(chunk) : String(chunk);
  }
}
return __out__;
`;
}
