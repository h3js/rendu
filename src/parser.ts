export type Token = {
  type: "text" | "code" | "expr";
  contents: string;
};

/**
 * A `<script ...>` opening tag whose attribute list contains a standalone `server`
 * attribute (`<script server>`, `<script server type="module">`,
 * `<script type="module" server>`, `<script server="true">`).
 */
const scriptServerOpen = String.raw`<script(?=[^>]*\sserver(?![\w-]))[^>]*>`;

const scriptServerRe = new RegExp(`${scriptServerOpen}([\\s\\S]*?)<\\/script>`, "gi");

/**
 * A rendu tag: `<?= expr ?>`, `<?js code ?>` / `<?js= expr ?>` (with `js` not part of a
 * longer word) or `<? code ?>` where `<?` is followed by whitespace, `=` or `?`.
 *
 * `<?` followed by an ASCII letter or `_` starts an HTML processing instruction
 * (`<?marker name="x">`, `<?xml version="1.0"?>`, ...) and is left as text.
 */
const tagRe = /<\?(?:js(?![\w-])|(?=[\s?=]))(?<equals>=)?(?<value>[\s\S]*?)\?>/g;

/** `{{{ raw }}}` and `{{ escaped }}` output tags, only expanded within text. */
const curlyRe = /{{{\s*([\s\S]+?)\s*}}}|{{\s*([\s\S]+?)\s*}}/g;

const templateSyntaxRe = new RegExp(
  `(?:${scriptServerOpen}[\\s\\S]*?<\\/script>)|(?:${tagRe.source})|(?:\\{\\{[\\s\\S]*?\\}\\})`,
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
 */
function pushTextTokens(tokens: Token[], text: string): void {
  if (!text) {
    return;
  }
  let cursor = 0;
  let match;
  curlyRe.lastIndex = 0;
  while ((match = curlyRe.exec(text))) {
    const raw: string | undefined = match[1];
    const escaped: string | undefined = match[2];
    if (match.index > cursor) {
      tokens.push({ type: "text", contents: text.slice(cursor, match.index) });
    }
    tokens.push({
      type: "expr",
      contents: raw === undefined ? `htmlspecialchars(${(escaped || "").trim()})` : raw.trim(),
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    tokens.push({ type: "text", contents: text.slice(cursor) });
  }
}

/**
 * Check if a template string contains template syntax.
 */
export function hasTemplateSyntax(template: string): boolean {
  return templateSyntaxRe.test(template);
}
