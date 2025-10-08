export type Token = {
  type: "text" | "code" | "expr";
  contents: string;
};

export function parseTemplate(template: string): Token[] {
  if (!template) {
    return [];
  }

  // convert <script server> ... </script> to <?js ... ?>
  template = template.replace(
    /<script\s+server\s*>([\s\S]*?)<\/script>/gi,
    (_m, code) => `<?js${code}?>`,
  );

  // Convert curly tags to PHP-style tags
  const curlyRe = /{{\s*(.+)\s*}}|{{{\s*(.+)\s*}}}/g;
  template = template.replace(curlyRe, (_m, code) => {
    if (code[0] === "{") {
      return `<?=${code.slice(1, -1).trim()}?>`;
    }
    return `<?=htmlspecialchars(${code.trim()})?>`;
  });

  const tokens: Token[] = [];
  const re = /<\?(?:js)?(?<equals>=)?(?<value>[\s\S]*?)\?>/g;
  let cursor = 0;
  let match;
  while ((match = re.exec(template))) {
    const { equals, value } = match.groups || {};
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (matchStart > cursor) {
      const textContent = template.slice(cursor, matchStart);
      if (textContent) {
        tokens.push({ type: "text", contents: textContent });
      }
    }
    if (equals) {
      // Expression tag: <?= ... ?>
      tokens.push({ type: "expr", contents: value || "" });
    } else {
      // Code tag: <? ... ?> or <?js ... ?>
      tokens.push({ type: "code", contents: value || "" });
    }
    cursor = matchEnd;
  }

  if (cursor < template.length) {
    const remainingText = template.slice(cursor);
    if (remainingText) {
      tokens.push({ type: "text", contents: remainingText });
    }
  }

  return tokens;
}

/**
 * Check if a template string contains template syntax.
 */
export function hasTemplateSyntax(template: string): boolean {
  return /(?:<script\s+server\s*>[\s\S]*?<\/script>)|(?:<\?(?:js)?=?[\s\S]*?\?>)|(?:\{\{[\s\S]*?\}\})/i.test(
    template,
  );
}
