export type Token = {
  type: "text" | "code" | "expr";
  contents: string;
};

/** `<script` (the start of a `<script server>` opening tag, see `scriptServerOpenEnd()`). */
const scriptOpenRe = /<script/gi;

/** An attribute name (sticky, after its leading whitespace). */
const attrNameRe = /[^\s"'>/=]+/y;

/**
 * An attribute value (sticky, after the name): quoted, or unquoted (no whitespace, quotes,
 * `=`, `<` or `>`).
 */
const attrValueRe = /\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>]+)/y;

/** Other `<script server>` opening tag parts (sticky, except the whole-name `server` test). */
const spaceRe = /\s+/y;
const serverAttrRe = /^server$/i;
const serverAttrEndRe = /[\s/>]/y;
const scriptOpenEndRe = /\s*\/?>/y;

/**
 * The body of a `<script server>` block (sticky, after the opening tag), up to its closing
 * tag or the end of the template (unclosed). Like HTML, `</script` followed by whitespace or
 * `/` also closes up to the next `>` (`</script >`, `</script\n>`, `</script/>`).
 */
const scriptBodyRe = /([\s\S]*?)(?:(<\/script(?:[\s/][^<>]*)?>)|$)/iy;

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
  const memo = new Map<number, number>();
  let cursor = 0;
  let open;
  while ((open = findScriptServerOpen(template, cursor, memo))) {
    scriptBodyRe.lastIndex = open.end;
    const [, code = "", close] = scriptBodyRe.exec(template)!;
    if (!close) {
      // Never render server code as page text.
      throw new SyntaxError("Unclosed <script server> tag: missing </script>");
    }
    if (open.start > cursor) {
      pushTagTokens(tokens, template.slice(cursor, open.start));
    }
    // Keep the line breaks of the tags (`<script\n server>`) so code lines stay aligned.
    tokens.push({
      type: "code",
      contents: lineBreaks(template.slice(open.start, open.end)) + code + lineBreaks(close),
    });
    cursor = scriptBodyRe.lastIndex;
  }
  if (cursor < template.length) {
    pushTagTokens(tokens, template.slice(cursor));
  }

  return tokens;
}

/**
 * Find the first `<script ...>` opening tag from `from` whose attribute list contains a
 * standalone `server` attribute (`<script server>`, `<script server type="module">`,
 * `<script type="module" server>`, `<script server="true">`).
 *
 * Attributes are matched one by one, so `server` only counts as an attribute name: not
 * as part of a longer tag name (`<scriptural server>`), a longer attribute name
 * (`data-server`, `server-side`) or an attribute value (`title=" server"`).
 */
function findScriptServerOpen(
  template: string,
  from: number,
  memo: Map<number, number>,
): { start: number; end: number } | undefined {
  scriptOpenRe.lastIndex = from;
  let match;
  while ((match = scriptOpenRe.exec(template))) {
    const end = scriptServerOpenEnd(template, match.index + match[0].length, memo);
    if (end !== -1) {
      return { start: match.index, end };
    }
  }
}

/**
 * Match the attributes of a `<script` opening tag from `pos` up to its `>` and return the
 * end of the tag, or `-1` when it is not a `<script server>` opening tag.
 *
 * Every step between attributes only depends on the position and on whether `server` was
 * seen, so results are memoized by both: an unterminated tag (`<script <script server ...`)
 * is scanned once instead of once for every `<script` inside of it, keeping this linear.
 */
function scriptServerOpenEnd(template: string, pos: number, memo: Map<number, number>): number {
  const keys: number[] = [];
  let server = 0;
  let end = -1;
  for (;;) {
    const key = pos * 2 + server;
    const cached = memo.get(key);
    if (cached !== undefined) {
      end = cached;
      break;
    }
    keys.push(key);
    spaceRe.lastIndex = pos;
    if (spaceRe.test(template)) {
      attrNameRe.lastIndex = spaceRe.lastIndex;
      const name = attrNameRe.exec(template);
      if (name) {
        pos = attrValueRe.lastIndex = attrNameRe.lastIndex;
        if (attrValueRe.test(template)) {
          pos = attrValueRe.lastIndex;
        }
        if (!server && serverAttrRe.test(name[0])) {
          // (`server="x"` must be followed by whitespace, `/` or `>`)
          serverAttrEndRe.lastIndex = pos;
          if (!serverAttrEndRe.test(template)) {
            break;
          }
          server = 1;
        }
        continue;
      }
    }
    // No more attributes: the tag ends here (with `/>` or `>`) or this is not a server tag.
    scriptOpenEndRe.lastIndex = pos;
    if (server && scriptOpenEndRe.test(template)) {
      end = scriptOpenEndRe.lastIndex;
    }
    break;
  }
  for (const key of keys) {
    memo.set(key, end);
  }
  return end;
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
    findScriptServerOpen(template, 0, new Map()) !== undefined ||
    (tagOpenRe.exec(template) !== null && template.includes("?>", tagOpenRe.lastIndex))
  );
}
