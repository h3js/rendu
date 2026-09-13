async function anonymous(__context__) {
  const __chunks__ = [];
  let __sink__ = __chunks__;
  const echo = (chunk) => {
    if (!__sink__)
      throw new Error(
        "echo() was called after the template body finished rendering. echo() must be called synchronously; after an await, return the content from the (deferred) value instead.",
      );
    __sink__.push(chunk);
  };
  const __deferred__ = [];
  let __deferSeq__ = 0;
  const __deferId__ = "d" + Math.random().toString(36).slice(2, 8) + "_";
  function defer(value, placeholder) {
    const name = __deferId__ + __deferSeq__++;
    const entry = { name, settled: undefined };
    __deferred__.push(entry);
    entry.settled = (async () => (typeof value === "function" ? value() : value))().then(
      (value) => ({ entry, value }),
      (error) => ({ entry, error, failed: true }),
    );
    return placeholder
      ? '<?start name="' + name + '">' + placeholder + "<?end>"
      : '<?marker name="' + name + '">';
  }
  with (__context__) {
    echo("Hello, ");
    echo(defer(name, "<i>Guest</i>"));
    echo("!");
  }
  function concatStreams(chunks, deferred, deferId) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const openReaders = new Set();
    let activeReader;
    let cancelled = false;
    return new ReadableStream({
      async pull(controller) {
        let patchTail = "";
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
        const rawTextElements = [
          "script",
          "style",
          "textarea",
          "title",
          "xmp",
          "iframe",
          "noembed",
          "noframes",
        ];
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
                else {
                  ps = alpha ? "name" : "data";
                  i--;
                }
                pEnd = ps === "endlt";
                break;
              case "endlt":
                if (ch === ">") ps = "data";
                else {
                  ps = alpha ? "name" : "bogus";
                  i--;
                }
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
                else {
                  ps = "bogus";
                  i--;
                }
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
                else {
                  ps = "c";
                  i--;
                }
                break;
              case "c":
                i = text.indexOf("-", i);
                if (i < 0) i = text.length;
                else ps = "ced";
                break;
              case "ced":
                if (ch === "-") ps = "ce";
                else {
                  ps = "c";
                  i--;
                }
                break;
              case "ce":
              case "ceb":
                if (ch === ">") ps = "data";
                else if (ch === "-") ps = ps === "ce" ? "ce" : "ced";
                else if (ch === "!" && ps === "ce") ps = "ceb";
                else {
                  ps = "c";
                  i--;
                }
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
                else {
                  ps = alpha && pSub === 1 ? "rdname" : "raw";
                  i--;
                }
                break;
              case "rbang":
              case "rbangd":
                if (ch !== "-") {
                  ps = "raw";
                  i--;
                } else if (ps === "rbang") ps = "rbangd";
                else {
                  ps = "raw";
                  pSub = 1;
                  pDash = 2;
                }
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
          if (
            (ps === "lt" || ps === "endlt" || ps === "name") &&
            (pEnd ? pDepth === 0 && "template".startsWith(pName) : "plaintext".startsWith(pName))
          ) {
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
              ps === "dq"
                ? '">'
                : ps === "sq"
                  ? "'>"
                  : ps[0] === "c"
                    ? "-->"
                    : ps[0] === "r"
                      ? pSub === 2
                        ? "-->"
                        : "</" + pRaw + ">"
                      : ps !== "data"
                        ? ">"
                        : pNoscript > 0
                          ? "</noscript>"
                          : "</template>",
            );
          }
          return out;
        };
        const seen = new Set();
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
        };
        let patchName;
        let patchOpen = false;
        let helperSent = false;
        const emit = (text) => {
          if (cancelled) return;
          if (deferred.length > 0) scan(text);
          controller.enqueue(encoder.encode(text));
        };
        const openPatch = () => {
          patchOpen = true;
          if (!helperSent) {
            helperSent = true;
            emit(
              '<script>window.__renduPatch=(typeof HTMLTemplateElement!=="undefined"&&"htmlFor" in HTMLTemplateElement.prototype)?function(){}:function(){var t=document.currentScript&&document.currentScript.previousElementSibling;\nif(!t||t.tagName!=="TEMPLATE"||!t.hasAttribute("for"))return;\ntry{\n  var name=t.getAttribute("for");\n  if(!name)return;\n  var data=function(n){return n.target?"?"+n.target+" "+n.data:n.data};\n  var w=document.createTreeWalker(document,192),n,m,start=null,end=null;\n  while((n=w.nextNode())){\n    m=/^\\?(marker|start)\\s+name=["\']?([^"\'\\s?>]+)/.exec(data(n));\n    if(m&&m[2]===name){start=n;if(m[1]==="marker")end=n;break;}\n  }\n  if(!start)return;\n  if(end!==start){\n    for(var s=start.nextSibling,depth=0,d;s;s=s.nextSibling){\n      if(s.nodeType!==7&&s.nodeType!==8)continue;\n      d=data(s);\n      if(/^\\?start\\b/.test(d))depth++;\n      else if(/^\\?end\\b/.test(d)){if(depth===0){end=s;break;}depth--;}\n    }\n  }\n  var parent=start.parentNode;\n  if(!parent)return;\n  if(end!==start){\n    for(var c=start.nextSibling,nx;c&&c!==end;c=nx){nx=c.nextSibling;parent.removeChild(c);}\n  }\n  parent.insertBefore(t.content,end||null);\n  if(end&&end!==start)parent.removeChild(end);\n  parent.removeChild(start);\n}finally{\n  t.remove();\n}};<\/script>',
            );
          }
          emit('<template for="' + patchName + '">');
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
        };
        const write = async (chunk) => {
          if (typeof chunk === "function") {
            const echoed = (__sink__ = []);
            try {
              chunk = chunk();
            } finally {
              __sink__ = undefined;
            }
            if (echoed.length > 0) {
              if (typeof chunk?.then === "function") {
                chunk.then(undefined, () => {});
              }
              for (const part of echoed) {
                if (cancelled) return;
                await write(part);
              }
            }
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
              pending.set(
                settled.entry,
                reader.read().then(
                  (first) => ({ entry: settled.entry, reader, first }),
                  (error) => ({ entry: settled.entry, error, failed: true }),
                ),
              );
              continue;
            }
          }
          if (settled.failed) {
            console.error(
              "[rendu] deferred value " + settled.entry.name + " failed:",
              settled.error,
            );
            track();
            continue;
          }
          patchName = settled.entry.name;
          let failed = false;
          try {
            await (settled.reader ? drain(settled.reader, settled.first) : write(settled.value));
          } catch (error) {
            failed = true;
            console.error("[rendu] deferred value " + settled.entry.name + " failed:", error);
          }
          const rest = decoder.decode();
          if (rest) enqueue(rest);
          if (!patchOpen && !failed) openPatch();
          const end = patchOpen ? patchEnd() + "</template>" : "";
          patchName = undefined;
          patchOpen = false;
          if (end) {
            emit(end);
            emit("<script>__renduPatch()<\/script>");
          }
          track();
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
        for (const entry of deferred) {
          entry.settled?.then(
            (settled) => {
              const body = settled.value instanceof Response ? settled.value.body : settled.value;
              if (body instanceof ReadableStream && !body.locked)
                body.cancel(reason).catch(() => {});
            },
            () => {},
          );
        }
        return reader?.cancel(reason);
      },
    });
  }
  __sink__ = undefined;
  return concatStreams(__chunks__, __deferred__, __deferId__);
}
