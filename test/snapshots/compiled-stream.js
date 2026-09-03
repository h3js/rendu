async function anonymous(__context__) {
  const __chunks__ = [];
  const echo = (chunk) => {
    __chunks__.push(chunk);
  };
  const __htmlEscapes__ = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function htmlspecialchars(s) {
    return String(s).replace(/[&<>"']/g, (c) => __htmlEscapes__[c] || c);
  }
  const __deferred__ = [];
  let __deferSeq__ = 0;
  function defer(value, placeholder) {
    const name = "d" + __deferSeq__++;
    __deferred__.push({ name, value });
    return placeholder === undefined || placeholder === null || placeholder === ""
      ? '<?marker name="' + name + '">'
      : '<?start name="' + name + '">' + placeholder + "<?end>";
  }
  with (__context__) {
    echo("Hello, ");
    if (name) echo(await name);
    else echo("Guest");
  }
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
          if (typeof chunk === "function") {
            chunk = chunk();
          }
          if (typeof chunk?.then === "function") {
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
        let index = 0;
        let helperSent = false;
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
          if (!helperSent) {
            helperSent = true;
            enqueue(
              '<script>window.__renduPatch=("htmlFor" in HTMLTemplateElement.prototype)?function(){}:function(){var t=document.currentScript&&document.currentScript.previousElementSibling;\nif(!t||t.tagName!=="TEMPLATE"||!t.hasAttribute("for"))return;\nvar name=t.getAttribute("for"),w=document.createTreeWalker(document,192),n,d,m,start=null,end=null,depth=0;\nwhile((n=w.nextNode())){\n  // A marker is a ProcessingInstruction where those are parsed, and a bogus comment\n  // where they are not; normalize both to the same leading-question-mark shape.\n  d=n.target?"?"+n.target+" "+n.data:n.data;\n  if(start){\n    if(/^\\?start\\b/.test(d))depth++;\n    else if(/^\\?end\\b/.test(d)){if(depth===0){end=n;break;}depth--;}\n    continue;\n  }\n  m=/^\\?(marker|start)\\s+name=["\']?([^"\'\\s?>]+)/.exec(d);\n  if(m&&m[2]===name){start=n;if(m[1]==="marker"){end=n;break;}}\n}\nvar parent=start&&start.parentNode;\nif(parent){\n  if(end&&end!==start){\n    for(var c=start.nextSibling,nx;c&&c!==end;c=nx){nx=c.nextSibling;parent.removeChild(c);}\n  }\n  parent.insertBefore(t.content,end||null);\n  if(end&&end!==start)parent.removeChild(end);\n  parent.removeChild(start);\n}\nt.remove();};</script>',
            );
          }
          enqueue('<template for="' + settled.entry.name + '">');
          await write(settled.value);
          enqueue("</template>");
          enqueue("<script>__renduPatch()</script>");
          track();
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
}
