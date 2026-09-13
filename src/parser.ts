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
 * A `</script>` closing tag. Like HTML, `</script` followed by whitespace or `/` also
 * closes up to the next `>` (`</script >`, `</script\n>`, `</script/>`).
 */
const scriptClose = String.raw`<\/script(?:[\s/][^<>]*)?>`;

/** A `<script server>` block, up to its closing tag or the end of the template (unclosed). */
const scriptServerRe = /* @__PURE__ */ new RegExp(
  `${scriptServerOpen}([\\s\\S]*?)(?:(${scriptClose})|$)`,
  "gi",
);

/**
 * A rendu tag: `<?= expr ?>`, `<?js code ?>` / `<?js= expr ?>` (with `js` not part of a
 * longer word) or `<? code ?>` where `<?` is followed by whitespace, `=` or `?`.
 *
 * `<?` followed by an ASCII letter or `_` starts an HTML processing instruction
 * (`<?marker name="x">`, `<?xml version="1.0"?>`, ...) and is left as text.
 */
const tagRe = /<\?(?:js(?![\w-])|(?=[\s?=]))(?<equals>=)?(?<value>[\s\S]*?)\?>/g;

const templateSyntaxRe = /* @__PURE__ */ new RegExp(
  `(?:${scriptServerOpen})|(?:${tagRe.source})`,
  "i",
);

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
    if (!match[2]) {
      // Never render server code as page text.
      throw new SyntaxError("Unclosed <script server> tag: missing </script>");
    }
    if (match.index > cursor) {
      pushTagTokens(tokens, template.slice(cursor, match.index));
    }
    tokens.push({ type: "code", contents: match[1] || "" });
    cursor = match.index + match[0].length;
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
  tagRe.lastIndex = 0;
  while ((match = tagRe.exec(chunk))) {
    const { equals, value } = match.groups || {};
    if (match.index > cursor) {
      pushTextTokens(tokens, chunk.slice(cursor, match.index));
    }
    if (equals) {
      // Expression tag: <?= ... ?>
      tokens.push({ type: "expr", contents: value || "" });
    } else {
      // Code tag: <? ... ?> or <?js ... ?>
      tokens.push({ type: "code", contents: value || "" });
    }
    cursor = match.index + match[0].length;
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

    // Trim surrounding whitespace and drop `//` line comments (keeping their newlines).
    const inner = text.slice(start, end);
    const exprEnd = start + inner.trimEnd().length;
    let pos = end - inner.trimStart().length;
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
      contents: closer === "}}" ? `htmlspecialchars(${contents})` : contents,
    });
    cursor = from = end + closer.length;
  }
  if (cursor < text.length) {
    tokens.push({ type: "text", contents: text.slice(cursor) });
  }
}

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
  // `{{ ... }}`: found with `indexOf()`, a lazy `{{[\s\S]*?}}` regex is quadratic.
  const open = template.indexOf("{{");
  return (
    (open !== -1 && template.indexOf("}}", open + 2) !== -1) || templateSyntaxRe.test(template)
  );
}
