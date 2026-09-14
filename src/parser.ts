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
 * `{{{` always opens a raw tag. The expression ends at the first closer (`}}}` / `}}`)
 * outside of any `{ }` braces, strings, template literals, regular expressions and
 * block comments (see `scanCurlyExpression()`), so `{{ fn({ a: { b: 1 } }) }}` and
 * `{{ "}}" }}` work. A `//` line comment ends at the end of its line or at the closer
 * (`{{ x // note }}`) and is dropped from the expression.
 *
 * When that scan reaches the end of the text without a closer (an unbalanced or stray
 * `{{`), this and all following tags of the chunk fall back to closing at the first
 * closer after the opener (`{{{` without any `}}}` then reads as `{{` + `{...`), and a
 * `{{` without any closer is text. This keeps parsing linear for any input.
 */
function pushTextTokens(tokens: Token[], text: string): void {
  if (!text) {
    return;
  }
  let cursor = 0; // End of the last tag
  let from = 0; // Where to look for the next opener
  let lexical = true;
  let noRawCloser = false;
  for (let open = text.indexOf("{{"); open !== -1; open = text.indexOf("{{", from)) {
    let closer = text[open + 2] === "{" ? "}}}" : "}}";
    let start = open + closer.length;
    let end = -1;
    let comments: number[] = [];
    if (lexical) {
      const scan = scanCurlyExpression(text, start, closer);
      if (scan) {
        ({ end, comments } = scan);
      } else {
        lexical = false;
      }
    }
    if (!lexical) {
      if (closer === "}}}" && !noRawCloser) {
        end = text.indexOf(closer, start);
        noRawCloser = end === -1;
      }
      if (end === -1) {
        closer = "}}";
        start = open + 2;
        end = text.indexOf(closer, start);
        if (end === -1) {
          break; // No closer left in this chunk
        }
      }
    }
    if (end === start) {
      // `{{}}` is text
      from = open + 2;
      continue;
    }

    // Trim surrounding whitespace (keeping its line breaks, outside of the expression) and
    // drop `//` line comments (keeping their line breaks).
    const inner = text.slice(start, end);
    const exprEnd = start + inner.trimEnd().length;
    const exprStart = end - inner.trimStart().length;
    let pos = exprStart;
    let contents = "";
    for (let i = 0; i < comments.length && comments[i]! < exprEnd; i += 2) {
      contents += text.slice(pos, comments[i]);
      pos = comments[i + 1]!;
    }
    contents += text.slice(pos, exprEnd);

    if (open > cursor) {
      tokens.push({ type: "text", contents: text.slice(cursor, open) });
    }
    tokens.push({
      type: "expr",
      contents:
        lineBreaks(text.slice(start, exprStart)) +
        (closer === "}}" ? `htmlspecialchars(${contents})` : contents) +
        // (A whitespace-only expression has no trailing whitespace of its own.)
        lineBreaks(text.slice(Math.max(exprStart, exprEnd), end)),
    });
    cursor = from = end + closer.length;
  }
  if (cursor < text.length) {
    tokens.push({ type: "text", contents: text.slice(cursor) });
  }
}

/** Only the line breaks of `text` (to keep line numbers when dropping template syntax). */
const lineBreaks = (text: string): string => text.replace(/[^\n\r\u2028\u2029]+/g, "");

/** Characters after which a `/` starts a regular expression literal instead of a division. */
const regexPrecedingChars = "(,=:[!&|?;+-*%<>~^{";

/** JS line terminators (`\n`, `\r`, U+2028, U+2029), which end line comments and literals. */
const lineTerminators = "\n\r\u2028\u2029";

/**
 * Scan a curly tag expression from `start` up to its `closer` (`}}` or `}}}`), skipping
 * `{ }` braces, `"` / `'` strings (which also end at a line terminator), template literals with
 * `${ }` substitutions, regular expression literals (a `/` after an operator or opening
 * punctuation, but not after postfix `++` / `--`) and block comments. `//` line comments
 * end at a line terminator or the closer.
 *
 * Returns the index of the closer and `[start, end]` index pairs of line comments, or
 * `undefined` when the text ends first.
 */
function scanCurlyExpression(
  text: string,
  start: number,
  closer: string,
): { end: number; comments: number[] } | undefined {
  const braces: boolean[] = []; // `true` for a template literal `${`
  const comments: number[] = [];
  let regexAllowed = true;
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    if (braces.length === 0 && text.startsWith(closer, i)) {
      return { end: i, comments };
    }
    if (ch === "{") {
      braces.push(false);
      i++;
    } else if (ch === "}") {
      i = braces.pop() ? skipTemplateLiteral(text, i + 1, braces) : i + 1;
    } else if (ch === "`") {
      i = skipTemplateLiteral(text, i + 1, braces);
    } else if (ch === '"' || ch === "'") {
      i = skipQuoted(text, i);
    } else if (ch === "/" && text[i + 1] === "/") {
      const commentStart = i;
      i += 2;
      while (
        i < text.length &&
        !lineTerminators.includes(text[i]!) &&
        !(braces.length === 0 && text.startsWith(closer, i))
      ) {
        i++;
      }
      comments.push(commentStart, i);
      continue;
    } else if (ch === "/" && text[i + 1] === "*") {
      const commentEnd = text.indexOf("*/", i + 2);
      i = commentEnd === -1 ? text.length : commentEnd + 2;
      continue;
    } else if (ch === "/" && regexAllowed) {
      i = skipQuoted(text, i);
    } else {
      i++;
      if (/\s/.test(ch)) {
        continue;
      }
    }
    // `a++ / b` is a division
    regexAllowed =
      regexPrecedingChars.includes(ch) && !(ch === text[i - 2] && (ch === "+" || ch === "-"));
  }
  return undefined;
}

/**
 * Skip a template literal body from `i` (after the opening backtick or a substitution's
 * closing `}`) up to its closing backtick or next `${` (pushed onto `braces`).
 */
function skipTemplateLiteral(text: string, i: number, braces: boolean[]): number {
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
    } else if (ch === "`") {
      return i + 1;
    } else if (ch === "$" && text[i + 1] === "{") {
      braces.push(true);
      return i + 2;
    }
  }
  return i;
}

/**
 * Skip a string (`"` / `'`) or regular expression (`/`, with `[...]` classes) literal
 * starting at `i`. Unterminated literals end at a line terminator.
 */
function skipQuoted(text: string, i: number): number {
  const quote = text[i];
  let inClass = false;
  for (i++; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
    } else if (lineTerminators.includes(ch!)) {
      return i;
    } else if (quote === "/" && (ch === "[" || (inClass && ch === "]"))) {
      inClass = ch === "[";
    } else if (ch === quote && !inClass) {
      return i + 1;
    }
  }
  return i;
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
