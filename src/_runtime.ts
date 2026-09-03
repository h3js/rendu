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
function defer(value, placeholder) {
  const name = "d" + (__deferSeq__++);
  __deferred__.push({ name, value });
  return placeholder === undefined || placeholder === null || placeholder === ""
    ? '<?marker name="' + name + '">'
    : '<?start name="' + name + '">' + placeholder + '<?end>';
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
 */
const patchScript =
  /* html */ `<script>window.__renduPatch=("htmlFor" in HTMLTemplateElement.prototype)?function(){}:function(){` +
  /* js */ `var t=document.currentScript&&document.currentScript.previousElementSibling;
if(!t||t.tagName!=="TEMPLATE"||!t.hasAttribute("for"))return;
var name=t.getAttribute("for"),w=document.createTreeWalker(document,192),n,d,m,start=null,end=null,depth=0;
while((n=w.nextNode())){
  // A marker is a ProcessingInstruction where those are parsed, and a bogus comment
  // where they are not; normalize both to the same leading-question-mark shape.
  d=n.target?"?"+n.target+" "+n.data:n.data;
  if(start){
    if(/^\\?start\\b/.test(d))depth++;
    else if(/^\\?end\\b/.test(d)){if(depth===0){end=n;break;}depth--;}
    continue;
  }
  m=/^\\?(marker|start)\\s+name=["']?([^"'\\s?>]+)/.exec(d);
  if(m&&m[2]===name){start=n;if(m[1]==="marker"){end=n;break;}}
}
var parent=start&&start.parentNode;
if(parent){
  if(end&&end!==start){
    for(var c=start.nextSibling,nx;c&&c!==end;c=nx){nx=c.nextSibling;parent.removeChild(c);}
  }
  parent.insertBefore(t.content,end||null);
  if(end&&end!==start)parent.removeChild(end);
  parent.removeChild(start);
}
t.remove();` +
  `};</script>`;

const patchSentinel = /* html */ `<script>__renduPatch()</script>`;

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
          enqueue(${JSON.stringify(patchScript)});
        }
`;
  const sentinel = /* js */ `        enqueue(${JSON.stringify(patchSentinel)});
`;
  return /* js */ `${prelude(deferStream)}${body};
function concatStreams(chunks, deferred) {
  const encoder = new TextEncoder();
  let activeReader;
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      const enqueue = (value) => {
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

      for (const chunk of chunks) {
        if (cancelled) return;
        await write(chunk);
      }

      // Deferred content, flushed in completion order (not source order) so a slow
      // patch never blocks a fast one. Each is emitted as a <template for> patch
      // targeting the marker that defer() left behind.
      let index = 0;${polyfill ? "\n      let helperSent = false;" : ""}
      const pending = new Map();
      const track = () => {
        while (index < deferred.length) {
          const entry = deferred[index++];
          // Rejections are captured here (instead of propagating out of the race) so
          // that a slow sibling patch cannot turn into an unhandled rejection.
          pending.set(
            entry,
            (async () => entry.value)().then(
              (value) => ({ entry, value }),
              (error) => ({ entry, failure: { error } }),
            ),
          );
        }
      };
      track();
      while (pending.size > 0) {
        if (cancelled) return;
        const settled = await Promise.race(pending.values());
        pending.delete(settled.entry);
        if (settled.failure) {
          throw settled.failure.error;
        }
${polyfill ? helperOnce : ""}        enqueue('<template for="' + settled.entry.name + '">');
        await write(settled.value);
        enqueue('</template>');
${polyfill ? sentinel : ""}        track();
      }

      if (cancelled) return;
      controller.close();
    },
    cancel(reason) {
      cancelled = true;
      const reader = activeReader;
      activeReader = undefined;
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
