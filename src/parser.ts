export type Token = {
  type: "text" | "code" | "expr";
  contents: string;
};

/** An attribute value: quoted, or unquoted (no whitespace, quotes, `=`, `<` or `>`). */
const attrValue = String.raw`(?:"[^"]*"|'[^']*'|[^\s"'=<>]+)`;

/** An attribute: a name with an optional value (quoted values are skipped whole). */
const attr = String.raw`[^\s"'>/=]+(?:\s*=\s*${attrValue})?`;

/**
 * A `<script ...>` opening tag whose attribute list contains a standalone `server`
 * attribute (`<script server>`, `<script server type="module">`,
 * `<script type="module" server>`, `<script server="true">`).
 *
 * Attributes are matched one by one, so `server` only counts as an attribute name: not
 * as part of a longer tag name (`<scriptural server>`), a longer attribute name
 * (`data-server`, `server-side`) or an attribute value (`title=" server"`). Only the
 * first `server` is a candidate (the attributes before it cannot be `server`), which keeps
 * a long unterminated tag from backtracking over every occurrence.
 */
const scriptServerOpen = String.raw`<script(?:\s+(?!server(?![^\s"'>/=]))${attr})*\s+server(?:\s*=\s*${attrValue})?(?=[\s/>])(?:\s+${attr})*\s*\/?>`;

/**
 * A `<script server>` block, up to its closing tag or the end of the template (unclosed).
 * Like HTML, `</script` followed by whitespace or `/` also closes up to the next `>`
 * (`</script >`, `</script\n>`, `</script/>`).
 */
const scriptServerRe = /* @__PURE__ */ new RegExp(
  `(${scriptServerOpen})([\\s\\S]*?)(?:(<\\/script(?:[\\s/][^<>]*)?>)|$)`,
  "gi",
);

/** The `scriptServerOpen` opener (without `g` flag), for `hasTemplateSyntax()`. */
const scriptServerOpenRe = /* @__PURE__ */ new RegExp(scriptServerOpen, "i");

/**
 * A rendu tag opener: `<?=`, `<?js` / `<?js=` (with `js` not part of a longer word) or `<?`
 * followed by whitespace, `=` or `?`. The tag ends at the first `?>` after the opener.
 *
 * `<?` followed by an ASCII letter or `_` starts an HTML processing instruction
 * (`<?marker name="x">`, `<?xml version="1.0"?>`, ...) and is left as text.
 */
const tagOpenRe = /<\?(?:js(?![\w-])|(?=[\s?=]))(=)?/g;

/** A `{{` opener that does not start an empty curly tag (`{{}}` or `{{{}}}`). */
const curlyOpenRe = /\{\{(?!\}\}|\{\}\}\})/;

/**
 * Parse a template string into `text`, `code` and `expr` tokens.
 */
export function parseTemplate(template: string): Token[] {
  if (!template) {
    return [];
  }

  // <script server> ... </script> blocks are code, everything else is tags and text.
  const tokens: Token[] = [];
  let cursor = 0;
  let match;
  scriptServerRe.lastIndex = 0;
  while ((match = scriptServerRe.exec(template))) {
    const [, open, code, close] = match;
    if (!close) {
      // Never render server code as page text.
      throw new SyntaxError("Unclosed <script server> tag: missing </script>");
    }
    if (match.index > cursor) {
      pushTagTokens(tokens, template.slice(cursor, match.index));
    }
    // Keep the line breaks of the tags (`<script\n server>`) so code lines stay aligned.
    tokens.push({ type: "code", contents: lineBreaks(open!) + code + lineBreaks(close) });
    cursor = scriptServerRe.lastIndex;
  }
  if (cursor < template.length) {
    pushTagTokens(tokens, template.slice(cursor));
  }

  return tokens;
}

/** Split a chunk into `code` / `expr` tokens for rendu tags and text tokens in between. */
function pushTagTokens(tokens: Token[], chunk: string): void {
  let cursor = 0;
  let match;
  tagOpenRe.lastIndex = 0;
  while ((match = tagOpenRe.exec(chunk))) {
    const end = chunk.indexOf("?>", tagOpenRe.lastIndex);
    if (end === -1) {
      break; // No later tag can close either (a lazy `[\s\S]*?\?>` regex is quadratic)
    }
    if (match.index > cursor) {
      pushTextTokens(tokens, chunk.slice(cursor, match.index));
    }
    tokens.push({
      // Expression tag: <?= ... ?>, code tag: <? ... ?> or <?js ... ?>
      type: match[1] ? "expr" : "code",
      contents: chunk.slice(tagOpenRe.lastIndex, end),
    });
    cursor = tagOpenRe.lastIndex = end + 2;
  }
  if (cursor < chunk.length) {
    pushTextTokens(tokens, chunk.slice(cursor));
  }
}

/**
 * Split a text chunk into `text` and `expr` tokens by expanding curly tags.
 *
 * `{{{ expr }}}` renders raw and `{{ expr }}` is HTML-escaped. Curly tags are only
 * expanded within text, never inside code (`<? ... ?>`, `<script server>`) tokens.
 *
 * The expression ends at the first closer outside of `{ }` braces and strings (see
 * `scanCurlyExpression()`). Once a scan reaches the end of the text, this and all following
 * tags close at the first closer instead (`{{{` without `}}}` reads as `{{` + `{...`), which
 * keeps parsing linear.
 */
function pushTextTokens(tokens: Token[], text: string): void {
  let cursor = 0; // End of the last tag
  let from = 0; // Where to look for the next opener
  let scan = true; // Until a scan reaches the end of the text
  let rawCloser = true; // Whether a `}}}` may still follow
  for (let open = text.indexOf("{{"); open !== -1; open = text.indexOf("{{", from)) {
    let closer = text[open + 2] === "{" ? "}}}" : "}}";
    let start = open + closer.length;
    let [end, expr] = scan ? scanCurlyExpression(text, start, closer) : [-1, ""];
    if (end === -1) {
      scan = false;
      if (closer === "}}}" && rawCloser) {
        end = text.indexOf(closer, start);
        rawCloser = end !== -1;
      }
      if (end === -1) {
        closer = "}}";
        start = open + 2;
        end = text.indexOf(closer, start);
        if (end === -1) {
          break; // No closer left in this chunk
        }
      }
      expr = text.slice(start, end);
    }
    if (end === start) {
      from = open + 2; // `{{}}` is text
      continue;
    }
    if (open > cursor) {
      tokens.push({ type: "text", contents: text.slice(cursor, open) });
    }
    // Trim surrounding whitespace, keeping its line breaks outside of the expression.
    const trimmed = expr.trim();
    const leading = expr.length - expr.trimStart().length;
    tokens.push({
      type: "expr",
      contents:
        lineBreaks(expr.slice(0, leading)) +
        (closer === "}}" ? `htmlspecialchars(${trimmed})` : trimmed) +
        lineBreaks(expr.slice(leading + trimmed.length)),
    });
    cursor = from = end + closer.length;
  }
  if (cursor < text.length) {
    tokens.push({ type: "text", contents: text.slice(cursor) });
  }
}

/** Only the line breaks of `text` (to keep line numbers when dropping template syntax). */
const lineBreaks = (text: string): string => text.replace(/[^\n\r\u2028\u2029]+/g, "");

/** JS line terminators, which end `//` comments and `"` / `'` strings. */
const lineTerminators = "\n\r\u2028\u2029";

/**
 * Scan a curly tag expression from `start` up to its `closer` (`}}` or `}}}`), skipping `{ }`
 * braces and `"` / `'` (up to a line terminator) / `` ` `` strings, and dropping `//` line
 * comments (not after `\`, as in `/\//`; up to a line terminator or the closer). Block comments
 * and regular expression literals are not scanned, so braces or quotes inside of them can end
 * the expression early. Returns the closer index (`-1` when the text ends first) and the
 * expression.
 */
function scanCurlyExpression(text: string, start: number, closer: string): [number, string] {
  let depth = 0;
  let expr = "";
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (!depth && text.startsWith(closer, i)) {
      return [i, expr + text.slice(start, i)];
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}" && depth) {
      depth--;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      while (++i < text.length && text[i] !== ch) {
        if (text[i] === "\\") {
          i++;
        } else if (ch !== "`" && lineTerminators.includes(text[i]!)) {
          break;
        }
      }
    } else if (ch === "/" && text[i + 1] === "/" && text[i - 1] !== "\\") {
      expr += text.slice(start, i);
      start = i;
      while (
        start < text.length &&
        !lineTerminators.includes(text[start]!) &&
        (depth || !text.startsWith(closer, start))
      ) {
        start++;
      }
      i = start - 1; // Continue at the line terminator or closer
    }
  }
  return [-1, ""];
}

/**
 * Check if a template string contains template syntax.
 */
export function hasTemplateSyntax(template: string): boolean {
  // Without `<script server>` blocks (code, or an unclosed tag error) and tags, the whole
  // template is one text chunk, in which the first `{{` opener that is not an empty tag
  // renders an expression if any `}}` follows it (a lazy `{{[\s\S]*?}}` regex is quadratic).
  // Likewise, only the first rendu tag opener needs a `?>` after it.
  const open = curlyOpenRe.exec(template);
  tagOpenRe.lastIndex = 0;
  return (
    (open !== null && template.indexOf("}}", open.index + 2) !== -1) ||
    scriptServerOpenRe.test(template) ||
    (tagOpenRe.exec(template) !== null && template.includes("?>", tagOpenRe.lastIndex))
  );
}
