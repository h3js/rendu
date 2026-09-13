/**
 * Client fallback for browsers without `<template for>` support, built into `__PATCH_SCRIPT__`
 * (`defer.ts`). Runs in the browser as a classic script.
 *
 * Emitted once before the first patch, followed by a `<script>` sentinel after each
 * `</template>`. The sentinel runs synchronously during parsing, right after the
 * template is complete, so no mutation observer or timing guesswork is needed.
 *
 * In a supporting browser a patched `<template for>` is never inserted into the DOM,
 * so `previousElementSibling` is not a template and the sentinel is a no-op (and the
 * whole helper is a no-op function anyway). The feature detection does not dereference a missing
 * `HTMLTemplateElement`: a bare reference would throw before `__renduPatch` is ever assigned,
 * after which every sentinel throws too.
 *
 * Markers are `ProcessingInstruction` nodes where supported; in browsers that predate
 * that they are parsed as bogus comments with data `?marker name="d0"`. Both are walked,
 * since a browser could ship processing instructions before `<template for>`.
 *
 * The marker search follows the spec's "find markers" (see
 * [`.agents/html-template-for.md`](../../.agents/html-template-for.md)): the *name* is matched
 * against any descendant in tree order, but the closing `<?end>` is matched only among the
 * start marker's next siblings, and only sibling markers count towards nesting. A missing
 * `<?end>` means the range runs to the end of the parent.
 *
 * A failed patch is silent, but the inert template is always removed.
 */

/** A marker node: a `ProcessingInstruction`, or a `Comment` where those are not supported. */
type Marker = CharacterData & { target?: string };

declare global {
  interface Window {
    __renduPatch: () => void;
  }
}

window.__renduPatch =
  typeof HTMLTemplateElement !== "undefined" && "htmlFor" in HTMLTemplateElement.prototype
    ? function () {}
    : function () {
        const script = document.currentScript;
        const t = script && script.previousElementSibling;
        if (!t || t.tagName !== "TEMPLATE" || !t.hasAttribute("for")) return;
        try {
          const name = t.getAttribute("for");
          if (!name) return;
          // A processing instruction's text as it would read as a bogus comment.
          const data = (n: Marker) => (n.target ? "?" + n.target + " " + n.data : n.data);
          // SHOW_PROCESSING_INSTRUCTION | SHOW_COMMENT
          const walker = document.createTreeWalker(document, 192);
          let start: Node | null = null;
          let end: Node | null = null;
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const m = /^\?(marker|start)\s+name=["']?([^"'\s?>]+)/.exec(data(n as Marker));
            if (m && m[2] === name) {
              start = n;
              if (m[1] === "marker") end = n;
              break;
            }
          }
          if (!start) return;
          if (end !== start) {
            for (let s = start.nextSibling, depth = 0; s; s = s.nextSibling) {
              if (s.nodeType !== 7 && s.nodeType !== 8) continue;
              const d = data(s as Marker);
              if (/^\?start\b/.test(d)) {
                depth++;
              } else if (/^\?end\b/.test(d)) {
                if (depth === 0) {
                  end = s;
                  break;
                }
                depth--;
              }
            }
          }
          const parent = start.parentNode;
          if (!parent) return;
          if (end !== start) {
            for (let c = start.nextSibling, next; c && c !== end; c = next) {
              next = c.nextSibling;
              parent.removeChild(c);
            }
          }
          parent.insertBefore((t as HTMLTemplateElement).content, end);
          if (end && end !== start) parent.removeChild(end);
          parent.removeChild(start);
        } finally {
          t.remove();
        }
      };
