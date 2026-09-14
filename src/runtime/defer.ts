import { createWrite, discard, type StreamState } from "./_shared.ts";

/**
 * `defer()`: out-of-order streaming via `<template for>` patches. Spec transcribed in
 * [`.agents/html-template-for.md`](../../.agents/html-template-for.md).
 *
 * Two parts are built from this module: the `defer()` prelude helper (with the `__deferred__`
 * queue it fills) and the streaming runtime that flushes it (the default export, built twice,
 * with and without the client fallback).
 */

/** A value queued by the streaming `defer()`. */
interface DeferEntry {
  /** Marker name: the per-render `__deferId__` plus a sequence number. */
  name: string;
  /** The settled value, set right after the entry is queued (so never `undefined` at flush time). */
  settled: Promise<Settled> | undefined;
}

/** What a queued value settled to, as raced by the flush loop. */
type Settled = SettledValue | SettledError | SettledReader;

interface SettledValue {
  entry: DeferEntry;
  value: unknown;
  failed?: false;
  reader?: undefined;
}

interface SettledError {
  entry: DeferEntry;
  error: unknown;
  failed: true;
  reader?: undefined;
}

/** A stream value whose first chunk has been read (streams race on their first chunk). */
interface SettledReader {
  entry: DeferEntry;
  reader: ReadableStreamDefaultReader<unknown>;
  first: ReadableStreamReadResult<unknown>;
  failed?: false;
}

// ---- Prelude: defer()

/**
 * Prelude: `defer()` for streaming mode, inlined when the body references it.
 *
 * Emits an HTML processing instruction marker in place and queues the value to be
 * flushed later as `<template for>` (by `concatStreams()` below), so slow content does not block the
 * rest of the document. See <https://github.com/whatwg/html/pull/11818> and
 * [`.agents/html-template-for.md`](../../.agents/html-template-for.md).
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

const __deferred__: DeferEntry[] = [];

let __deferSeq__ = 0;

// A pure-annotated call, so the runtime built from this module drops it (the prelude minifies it
// back to a plain expression).
const __deferId__ = /* @__PURE__ */ (() => "d" + Math.random().toString(36).slice(2, 8) + "_")();

function defer(value: unknown, placeholder?: unknown): string {
  const name = __deferId__ + __deferSeq__++;
  const entry: DeferEntry = { name, settled: undefined };
  __deferred__.push(entry);
  entry.settled = (async () => (typeof value === "function" ? value() : value))().then(
    (value): Settled => ({ entry, value }),
    (error): Settled => ({ entry, error, failed: true }),
  );
  return placeholder
    ? '<?start name="' + name + '">' + placeholder + "<?end>"
    : '<?marker name="' + name + '">';
}

export { __deferred__, __deferSeq__, __deferId__, defer };

// ---- Patch framing

/**
 * The framing of an open `defer()` patch: `guard(text)` (patch content → text that is safe to
 * put on the wire) and `end()` (the text that has to go out right before the patch's
 * `</template>`).
 *
 * A patch's content is arbitrary, possibly truncated (a stream that errors mid-way) HTML, and
 * the only thing that closes the patch is a `</template>` *end tag token* at nesting depth 0.
 * So `guard()` runs a streaming copy of the HTML tokenizer over it, reduced to the states that
 * decide where a tag, an attribute value, a comment or a raw text element ends:
 *
 * | `ps`                                        | tokenizer state(s)                                 |
 * | ------------------------------------------- | -------------------------------------------------- |
 * | `data`                                      | data                                               |
 * | `lt`, `endlt`, `name`                       | tag open, end tag open, tag name                   |
 * | `attr`                                      | before attribute name, after attribute value (quoted), self-closing start tag |
 * | `aname`, `aval`                             | attribute name + after attribute name, before attribute value |
 * | `dq`, `sq`, `uq`                            | attribute value (double-quoted, single-quoted, unquoted) |
 * | `md`, `mdd`, `bogus`                        | markup declaration open (`<!`, `<!-`), bogus comment (also `<?…>` and `<!DOCTYPE …>`, which end at the first `>` too) |
 * | `cs`, `csd`, `c`, `ced`, `ce`, `ceb`        | comment start, start dash, comment, end dash, end, end bang |
 * | `raw` (`pRaw`, `pSub`, `pDash`)             | RCDATA / RAWTEXT / script data; `pSub` 1 and 2 are script data (double) escaped, `pDash` counts trailing `-` there |
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
 * - `end()` returns the tokenizer to the data state at depth 0 whatever the content
 *   left open: a dangling tail is escaped, then the minimal closer for the current state is
 *   fed through `guard()` itself until nothing is open (`">` closes an attribute and its tag,
 *   `>` a tag, `-->` a comment, `</script>` a raw text element, `</template>` a nested
 *   template), since closing a tag can open another state (`<script` → `>` → `</script>`).
 * - Some elements are raw text in one browser and markup in another: `<noscript>` (raw text only
 *   with scripting enabled), and `<style>`, `<title>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`
 *   inside a `<select>` (ignored there, so not raw text, by parsers that predate customizable
 *   `<select>`). Their content is tokenized as markup, and while one is open (`pShadow`) every `<`
 *   that does not start a tag in the data state is escaped (in raw text: only the end tags of
 *   those elements), and so are `<template>` tags: whichever way it is read, the element then
 *   ends at the same end tag and leaves the template depth alone. `end()` closes it with its end
 *   tag, a stray end tag (ignored) where it was markup. An open `<select>` is tracked by template
 *   depth (`pSelect`) until its end tag, which can overestimate but never miss it.
 * - Tree construction is not modelled otherwise: `<script>` / `<style>` / `<title>` inside `<svg>` or
 *   `<math>` are treated as raw text although foreign content tokenizes them as markup, and
 *   `<![CDATA[` as a bogus comment. That only matters for content that has `</template`,
 *   `<!--` or an unterminated tag inside those elements.
 */

type TokenizerState =
  | "data"
  | "lt"
  | "endlt"
  | "name"
  | "attr"
  | "aname"
  | "aval"
  | "dq"
  | "sq"
  | "uq"
  | "md"
  | "mdd"
  | "bogus"
  | "cs"
  | "csd"
  | "c"
  | "ced"
  | "ce"
  | "ceb"
  | "raw"
  | "rlt"
  | "rbang"
  | "rbangd"
  | "rname"
  | "rdname";

interface PatchGuard {
  guard(text: string): string;
  end(): string;
}

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

/** Elements whose content a browser may or may not read as raw text (see `createPatchGuard()`). */
const shadowElements = ["noscript", "style", "title", "xmp", "iframe", "noembed", "noframes"];

function createPatchGuard(): PatchGuard {
  let patchTail = "";
  let ps: TokenizerState = "data";
  /** Where the current tag starts. */
  let pAt = 0;
  /** Nested `<template>` depth. */
  let pDepth = 0;
  /** Open elements from `shadowElements` that are tokenized as markup but may be raw text. */
  let pShadow: string[] = [];
  /** Template depth of the outermost open `<select>`, or -1. */
  let pSelect = -1;
  /** The current tag name (lowercase, capped: only short names matter). */
  let pName = "";
  /** Whether the current tag is an end tag. */
  let pEnd = false;
  /** The raw text element being skipped. */
  let pRaw = "";
  /** Script data escape level: 0 none, 1 escaped, 2 double escaped. */
  let pSub = 0;
  let pDash = 0;
  /** The end tag name after a `</` in raw text. */
  let pBuf = "";

  /** Whether the current tag (or a tag starting with its name so far, if `partial`) is escaped. */
  const escapedTag = (partial: boolean) => {
    const is = (name: string) => (partial ? name.startsWith(pName) : name === pName);
    return pShadow.length > 0
      ? is("template") || (!pEnd && is("plaintext"))
      : pEnd
        ? pDepth === 0 && is("template")
        : is("plaintext");
  };

  const tagEnd = () => {
    ps = "data";
    if (pName === "template") {
      pDepth += pEnd ? -1 : 1;
      if (pDepth < pSelect) pSelect = -1;
    } else if (pName === "select") {
      if (!pEnd && pSelect < 0) pSelect = pDepth;
      else if (pEnd && pDepth === pSelect) pSelect = -1;
    } else if (pEnd) {
      if (pShadow.includes(pName)) pShadow = pShadow.filter((name) => name !== pName);
    } else if (pName === "noscript" || (pSelect >= 0 && shadowElements.includes(pName))) {
      if (!pShadow.includes(pName)) pShadow.push(pName);
    } else if (rawTextElements.includes(pName)) {
      ps = "raw";
      pRaw = pName;
      pSub = 0;
      pDash = 0;
    }
  };

  const guard = (text: string): string => {
    text = patchTail + text;
    patchTail = "";
    let out = "";
    let from = 0;
    const escape = (at: number) => {
      if (from <= at) {
        out += text.slice(from, at) + "&lt;";
        from = at + 1;
      }
    };
    /** Skip from `at` to `to` (-1: the end of the text), escaping every `<` in between in a shadow. */
    const skip = (at: number, to: number) => {
      if (to < 0) to = text.length;
      for (; pShadow.length > 0 && at < to; at++) if (text.charCodeAt(at) === 60) escape(at);
      return to;
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const code = text.charCodeAt(i);
      const ws = code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
      const alpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
      if (code === 60 && pShadow.length > 0 && ps !== "data" && ps !== "lt" && ps[0] !== "r") {
        escape(i);
      }
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
            if (escapedTag(false)) {
              escape(pAt);
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
          i = skip(i, text.indexOf(ps === "dq" ? '"' : "'", i));
          if (i < text.length) ps = "attr";
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
          i = skip(i, text.indexOf(">", i));
          if (i < text.length) ps = "data";
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
          i = skip(i, text.indexOf("-", i));
          if (i < text.length) ps = "ced";
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
            if (i < 0) {
              i = text.length;
            } else {
              ps = "rlt";
              pAt = i;
            }
          } else if (ch === "<") {
            ps = "rlt";
            pAt = i;
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
          } else if (ps === "rbang") {
            ps = "rbangd";
          } else {
            ps = "raw";
            pSub = 1;
            pDash = 2;
          }
          break;
        case "rname":
        case "rdname":
          if (alpha) {
            if (pBuf.length < 10) pBuf += ch.toLowerCase();
            if (pBuf !== pRaw && pShadow.length > 0 && shadowElements.includes(pBuf)) escape(pAt);
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
      ((ps === "lt" || ps === "endlt" || ps === "name") && escapedTag(true)) ||
      (pShadow.length > 0 &&
        from <= pAt &&
        (ps === "rlt" ||
          ((ps === "rname" || ps === "rdname") &&
            shadowElements.some((name) => name.startsWith(pBuf)))))
    ) {
      patchTail = text.slice(pAt);
      ps = ps[0] === "r" ? "raw" : "data";
      return out + text.slice(from, pAt);
    }
    return out + text.slice(from);
  };

  const end = (): string => {
    let out = patchTail && "&lt;" + patchTail.slice(1);
    patchTail = "";
    while (ps !== "data" || pDepth > 0 || pShadow.length > 0) {
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
                  : pShadow.length > 0
                    ? "</" + pShadow[0] + ">"
                    : "</template>",
      );
    }
    return out;
  };

  return { guard, end };
}

// ---- Marker tracking

/**
 * Record which `defer()` markers have been emitted: `seen` (the names of this render's
 * `<?marker name>` / `<?start name>` markers found in the output so far), `found` (the names added
 * to `seen` since the flush loop last took them, so it never re-checks every waiting entry) and
 * `scan(text)`, which `enqueue()` calls on every chunk of text it writes, in the main document and
 * in patches alike, while any `defer()` has been called.
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

interface MarkerScan {
  seen: Set<string>;
  found: string[];
  scan(text: string): void;
}

function createMarkerScan(deferId: string): MarkerScan {
  const seen = new Set<string>();
  const found: string[] = [];
  const needle = 'name="' + deferId;
  const reach = needle.length + 20;
  let seenTail = "";
  const find = (text: string) => {
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
      let j = i + needle.length;
      while (text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) j++;
      const name = text.slice(i + 6, j);
      if (text[j] === '"' && j > i + needle.length && !seen.has(name)) {
        seen.add(name);
        found.push(name);
      }
    }
  };
  const scan = (text: string) => {
    if (seenTail) find(seenTail + text.slice(0, reach));
    find(text);
    seenTail = (text.length < reach ? seenTail + text : text).slice(-reach);
  };
  return { seen, found, scan };
}

// ---- Runtime

/**
 * Streaming runtime for a template that calls `defer()`: `concatStreams()` writes the chunks in
 * source order, then flushes the `defer()`red values out of order as `<template for>` patches.
 *
 * Built twice, with `__POLYFILL__` on and off: the client fallback (`patch.ts`) is emitted once
 * before the first patch, followed by a `<script>` sentinel after each `</template>`.
 */

/** Build flag: emit the client fallback for browsers without `<template for>` support. */
declare const __POLYFILL__: boolean;

/** Build constant: `<script>` + the minified `patch.ts` + `</script>`. */
declare const __PATCH_SCRIPT__: string;

/**
 * `openReaders` are readers acquired to race a deferred stream on its first chunk; they lock the
 * upstream body, so `cancel()` releases them itself.
 */
export default function concatStreams(
  chunks: unknown[],
  deferred: DeferEntry[],
  deferId: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const openReaders = new Set<ReadableStreamDefaultReader<unknown>>();
  const state: StreamState = { cancelled: false, activeReader: undefined };
  /**
   * Cancel the output, or clean up after a main chunk failed it: also release the upstream bodies
   * held by racing readers and by the chunks and deferred values that are not written yet (the
   * one being written releases itself, see `createWrite()`).
   */
  const abort = (reason: unknown) => {
    state.cancelled = true;
    state.reason = reason;
    const reader = state.activeReader;
    state.activeReader = undefined;
    for (const open of openReaders) open.cancel(reason).catch(() => {});
    openReaders.clear();
    for (const chunk of chunks) discard(chunk, reason);
    for (const entry of deferred) {
      entry.settled?.then((settled) => discard("value" in settled && settled.value, reason));
    }
    return reader?.cancel(reason);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { guard, end: patchEnd } = createPatchGuard();
      const { seen, found, scan } = createMarkerScan(deferId);

      /** The entry being flushed, `undefined` outside a patch. */
      let patchName: string | undefined;
      let patchOpen = false;
      let helperSent = false;

      /** Text for the main document. */
      const emit = (text: string) => {
        if (state.cancelled) return;
        if (deferred.length > 0) scan(text);
        controller.enqueue(encoder.encode(text));
      };

      const openPatch = () => {
        patchOpen = true;
        if (__POLYFILL__ && !helperSent) {
          helperSent = true;
          emit(__PATCH_SCRIPT__);
        }
        emit('<template for="' + patchName + '">');
      };

      /**
       * The patch-aware writer.
       *
       * - Outside a patch, byte chunks pass through as they are and text is scanned for markers
       *   once any `defer()` has been called (see `createMarkerScan()`).
       * - Inside a patch, output is decoded and runs through `guard()`. A string chunk first
       *   flushes the decoder, so bytes still pending from a previous chunk go out ahead of it,
       *   not after.
       * - The patch is opened lazily, by the first chunk that has content (`openPatch()`: the
       *   client fallback before the first patch, then `<template for>`). A value that fails
       *   before that emits no patch at all, so its placeholder stays: even an empty
       *   `<template for>` would replace it. The flush loop opens the patch itself for a value
       *   that succeeds empty.
       */
      const enqueue = (value: unknown) => {
        if (state.cancelled) return;
        if (patchName === undefined) {
          if (ArrayBuffer.isView(value)) controller.enqueue(value as Uint8Array);
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

      const write = createWrite(state, enqueue);

      try {
        for (const chunk of chunks) {
          if (state.cancelled) return;
          await write(chunk);
        }
      } catch (error) {
        abort(error);
        throw error;
      }

      /*
       * Flush the queued deferred values, after the main chunks, as `<template for>` patches.
       *
       * - Patches go out in completion order (not source order), so a slow one never blocks a
       *   fast one. A function value is called by `write()` inside the patch, so what it echoes
       *   synchronously is written in place there. Nothing else can add output: `echo()` throws
       *   once the template body has ended (see `prelude.ts`), so a late echo fails its own deferred
       *   value instead of landing in whichever patch happens to be open.
       * - A `<template>`'s content has to be contiguous on the wire, so an open patch holds the
       *   loop until it ends. A stream value therefore races on its first chunk: racing on merely
       *   being a stream would let an idle one claim the loop ahead of a finished sibling.
       * - A failed value is logged and skipped (silent by design in `<template for>`): the head
       *   is already committed, so there is no status to fail with. A value that fails before
       *   any content emits no patch (see `enqueue`), so its placeholder stays, whether it
       *   failed racing or while it was written (as the last pending entry, a stream is written
       *   without racing). A value that fails mid-stream has already been partly written into
       *   its open patch: that part stays, and `patchEnd()` closes whatever it left open so later
       *   patches are unaffected.
       * - An entry races only once its marker has been `seen`; until then it waits in `parked`.
       *   That is what makes nested `defer()` work: a marker inside another deferred value (a
       *   string, stream, Response or function result, at any depth) reaches the document with
       *   that value's patch, so the inner patch has to go out after it, whichever settles first.
       *   `track()` takes the markers `found` since its last call after every patch, which is the
       *   only time `seen` can grow once the main chunks are written.
       * - When no entry is left racing, nothing can emit a marker any more (markers are only
       *   written by patches now, and every patch is followed by `track()`), so the oldest parked
       *   entry is flushed anyway, and the next one after it, until none is left and the stream
       *   closes. Its marker was never echoed, was escaped, or is nested in a value that failed,
       *   so its patch usually cannot apply. It is scanned like any other patch, though, and one
       *   at a time in `defer()` order rather than racing them: an inner `defer()` called while
       *   the outer value is produced is always queued after it, so it still goes out after the
       *   outer patch that holds its marker (which matters if that marker did reach the document
       *   unseen, as bytes the template encoded itself). Nothing that could apply waits behind
       *   it, since nothing is racing.
       */

      /** Write a stream whose first chunk was already read by the race. */
      const drain = async (
        reader: ReadableStreamDefaultReader<unknown>,
        first: ReadableStreamReadResult<unknown>,
      ) => {
        state.activeReader = reader;
        try {
          for (let r = first; !r.done; r = await reader.read()) {
            if (state.cancelled) return;
            enqueue(r.value);
          }
        } finally {
          state.activeReader = undefined;
          openReaders.delete(reader);
          reader.releaseLock();
        }
      };

      /*
       * The race, in logarithmic time per entry however many are racing (`Promise.race()` over
       * all of them for every patch is quadratic): `race()` adds a promise, which once settled
       * either wakes the waiting loop or waits in `ready`, a min-heap by the order the promises
       * were added. So the loop picks exactly what `Promise.race()` would: the first-added of the
       * entries that had settled when it asks (see `await undefined` below), or else the first to
       * settle after that, and it resumes on the same microtask tick.
       */
      let raced = 0;
      let racing = 0;
      const ready: { at: number; settled: Settled }[] = [];
      let wake: ((settled: Settled) => void) | undefined;
      const race = (promise: Promise<Settled>) => {
        const at = raced++;
        racing++;
        promise.then((settled) => {
          if (wake) {
            const resolve = wake;
            wake = undefined;
            resolve(settled);
            return;
          }
          let i = ready.length;
          while (i > 0 && ready[(i - 1) >> 1]!.at > at) {
            ready[i] = ready[(i - 1) >> 1]!;
            i = (i - 1) >> 1;
          }
          ready[i] = { at, settled };
        });
      };
      const next = (): Settled | Promise<Settled> => {
        if (ready.length === 0) return new Promise((resolve) => (wake = resolve));
        const { settled } = ready[0]!;
        const last = ready.pop()!;
        let i = 0;
        for (let down = 1; down < ready.length; i = down, down = 2 * i + 1) {
          if (down + 1 < ready.length && ready[down + 1]!.at < ready[down]!.at) down++;
          if (last.at < ready[down]!.at) break;
          ready[i] = ready[down]!;
        }
        if (i < ready.length) ready[i] = last;
        return settled;
      };

      /** Entries waiting for their marker: name → index in `deferred`, in `defer()` order. */
      let index = 0;
      let oldest = 0;
      const parked = new Map<string, number>();
      const track = () => {
        const marked: number[] = [];
        for (const name of found.splice(0)) {
          const at = parked.get(name);
          if (at !== undefined) {
            parked.delete(name);
            marked.push(at);
          }
        }
        // Race them in `defer()` order, as the promises that settled together are picked in it.
        for (const at of marked.sort((a, b) => a - b)) race(deferred[at]!.settled!);
        for (; index < deferred.length; index++) {
          const entry = deferred[index]!;
          if (seen.has(entry.name)) race(entry.settled!);
          else parked.set(entry.name, index);
        }
        if (racing === 0 && parked.size > 0) {
          // The oldest parked entry (entries older than `oldest` are never parked again).
          while (!parked.has(deferred[oldest]!.name)) oldest++;
          parked.delete(deferred[oldest]!.name);
          race(deferred[oldest]!.settled!);
        }
      };

      track();
      while (racing > 0) {
        if (state.cancelled) return;
        // Let the callbacks of the promises that have settled by now run first.
        await undefined;
        let settled = await next();
        racing--;
        if (state.cancelled) return;
        if (!settled.failed && settled.reader === undefined) {
          const { entry, value } = settled;
          const body = value instanceof Response ? value.body : value;
          if (body instanceof ReadableStream && racing > 0) {
            try {
              const reader: ReadableStreamDefaultReader<unknown> = body.getReader();
              openReaders.add(reader);
              race(
                reader.read().then(
                  (first): Settled => ({ entry, reader, first }),
                  (error): Settled => {
                    openReaders.delete(reader);
                    reader.releaseLock();
                    return { entry, error, failed: true };
                  },
                ),
              );
              continue;
            } catch (error) {
              // A locked body (e.g. a Response that was already read) fails only its own entry.
              settled = { entry, error, failed: true };
            }
          }
        }
        if (settled.failed) {
          console.error("[rendu] deferred value " + settled.entry.name + " failed:", settled.error);
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
          if (__POLYFILL__) emit("<script>__renduPatch()</script>");
        }
        track();
      }

      if (state.cancelled) return;
      controller.close();
    },

    cancel: abort,
  });
}
