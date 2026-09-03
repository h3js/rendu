import { describe, expect, it } from "vitest";
import { hasTemplateSyntax, parseTemplate } from "../src/parser.ts";

describe("parser", () => {
  describe("hasTemplateSyntax", () => {
    it("no syntax", () => {
      expect(hasTemplateSyntax("Hello, World!")).toBe(false);
      expect(hasTemplateSyntax("Just some text.")).toBe(false);
    });

    it("processing instructions are not template syntax", () => {
      expect(hasTemplateSyntax('<div><?marker name="x"?></div>')).toBe(false);
      expect(hasTemplateSyntax('<?xml version="1.0"?>')).toBe(false);
      expect(hasTemplateSyntax('<?start name="rec"><p>hi</p><?end>')).toBe(false);
      expect(hasTemplateSyntax('<?json {"a":1} ?>')).toBe(false);
    });

    it("with syntax", () => {
      expect(hasTemplateSyntax("Hello, <?= name ?>!")).toBe(true);
      expect(hasTemplateSyntax("{{ name }}")).toBe(true);
      expect(hasTemplateSyntax("{{{ name }}}")).toBe(true);
      expect(hasTemplateSyntax("<?js if (true) { ?>Yes<?js } ?>")).toBe(true);
      expect(hasTemplateSyntax("<script server>console.log('hi');</script>")).toBe(true);
      expect(hasTemplateSyntax('<script server type="module">const x = 1;</script>')).toBe(true);
      expect(hasTemplateSyntax('<script type="module" server>const x = 1;</script>')).toBe(true);
      expect(hasTemplateSyntax('<script type="module">const x = 1;</script>')).toBe(false);
      expect(hasTemplateSyntax("<?js x ?>")).toBe(true);
      expect(hasTemplateSyntax("<?js= x ?>")).toBe(true);
      expect(hasTemplateSyntax("<? x ?>")).toBe(true);
      expect(hasTemplateSyntax("<?=htmlspecialchars(x)?>")).toBe(true);
    });
  });

  describe("parseTemplate", () => {
    it("plain text", () => {
      const tokens = parseTemplate("Hello, World!");
      expect(tokens).toMatchObject([{ type: "text", contents: "Hello, World!" }]);
    });

    it("expression", () => {
      const tokens = parseTemplate("<?js= name ?>");
      expect(tokens).toMatchObject([{ type: "expr", contents: " name " }]);
    });

    it("expression (short)", () => {
      const tokens = parseTemplate("<?= name ?>");
      expect(tokens).toMatchObject([{ type: "expr", contents: " name " }]);
    });

    it("expression (curly)", () => {
      const tokens = parseTemplate("{{ name }}");
      expect(tokens).toMatchObject([{ type: "expr", contents: "htmlspecialchars(name)" }]);
    });

    it("multiple curly expressions on same line", () => {
      const tokens = parseTemplate('<a href="{{ url }}" target="_blank">{{ label }}</a>');
      expect(tokens).toMatchObject([
        { type: "text", contents: '<a href="' },
        { type: "expr", contents: "htmlspecialchars(url)" },
        { type: "text", contents: '" target="_blank">' },
        { type: "expr", contents: "htmlspecialchars(label)" },
        { type: "text", contents: "</a>" },
      ]);
    });

    it("multiple curly unescaped expressions on same line", () => {
      const tokens = parseTemplate("{{{ a }}} and {{{ b }}}");
      expect(tokens).toMatchObject([
        { type: "expr", contents: "a" },
        { type: "text", contents: " and " },
        { type: "expr", contents: "b" },
      ]);
    });

    it("expression (curly unescaped)", () => {
      const tokens = parseTemplate("{{{ name }}}");
      expect(tokens).toMatchObject([{ type: "expr", contents: "name" }]);
    });

    it("multiline curly expression", () => {
      const tokens = parseTemplate("{{ a ?\n  b : c }}");
      expect(tokens).toMatchObject([{ type: "expr", contents: "htmlspecialchars(a ?\n  b : c)" }]);
    });

    it("multiline curly unescaped expression", () => {
      const tokens = parseTemplate("{{{ a ?\n  b : c }}}");
      expect(tokens).toMatchObject([{ type: "expr", contents: "a ?\n  b : c" }]);
    });

    it("code", () => {
      const tokens = parseTemplate("<?js if (true) { ?>123<?js } ?>");
      expect(tokens).toMatchObject([
        { type: "code", contents: " if (true) { " },
        { type: "text", contents: "123" },
        { type: "code", contents: " } " },
      ]);
    });

    it("code (short)", () => {
      const tokens = parseTemplate("<? if (true) { ?>123<? } ?>");
      expect(tokens).toMatchObject([
        { type: "code", contents: " if (true) { " },
        { type: "text", contents: "123" },
        { type: "code", contents: " } " },
      ]);
    });

    it("script server", () => {
      const tokens = parseTemplate("<script server>const x = 1;</script><p><?= x ?></p>");
      expect(tokens).toMatchObject([
        { type: "code", contents: "const x = 1;" },
        { type: "text", contents: "<p>" },
        { type: "expr", contents: " x " },
        { type: "text", contents: "</p>" },
      ]);
    });

    it("script server with extra attributes", () => {
      expect(
        parseTemplate('<script server type="module">const x = 1;</script><?= x ?>'),
      ).toMatchObject([
        { type: "code", contents: "const x = 1;" },
        { type: "expr", contents: " x " },
      ]);
      expect(
        parseTemplate('<script type="module" server>const x = 1;</script><?= x ?>'),
      ).toMatchObject([
        { type: "code", contents: "const x = 1;" },
        { type: "expr", contents: " x " },
      ]);
    });

    it("script without server attribute is text", () => {
      const tokens = parseTemplate('<script type="module">const x = 1;</script>');
      expect(tokens).toMatchObject([
        { type: "text", contents: '<script type="module">const x = 1;</script>' },
      ]);
    });

    it("curly tags inside script server are left as code", () => {
      const tokens = parseTemplate('<script server>const t = "{{name}}";</script><?= t ?>');
      expect(tokens).toMatchObject([
        { type: "code", contents: 'const t = "{{name}}";' },
        { type: "expr", contents: " t " },
      ]);
    });

    it("curly braces inside code tags are left as code", () => {
      const tokens = parseTemplate("<? if (x) {{ y }} ?>ok");
      expect(tokens).toMatchObject([
        { type: "code", contents: " if (x) {{ y }} " },
        { type: "text", contents: "ok" },
      ]);
    });

    it("mixed escaped and unescaped curly expressions", () => {
      const tokens = parseTemplate("a {{ b }} c {{{ d }}} e");
      expect(tokens).toMatchObject([
        { type: "text", contents: "a " },
        { type: "expr", contents: "htmlspecialchars(b)" },
        { type: "text", contents: " c " },
        { type: "expr", contents: "d" },
        { type: "text", contents: " e" },
      ]);
    });

    it("empty expression", () => {
      const tokens = parseTemplate("<?= ?>");
      expect(tokens).toMatchObject([{ type: "expr", contents: " " }]);
    });

    it("html processing instructions stay as text", () => {
      expect(parseTemplate('<div><?marker name="x"?></div>')).toMatchObject([
        { type: "text", contents: '<div><?marker name="x"?></div>' },
      ]);
      expect(parseTemplate('<?start name="rec"><p>hi</p><?end>')).toMatchObject([
        { type: "text", contents: '<?start name="rec"><p>hi</p><?end>' },
      ]);
      expect(parseTemplate('<?xml version="1.0"?>')).toMatchObject([
        { type: "text", contents: '<?xml version="1.0"?>' },
      ]);
    });

    it("processing instruction does not swallow following markup", () => {
      const tokens = parseTemplate('<?start name="rec"><p>a</p><?= x ?>');
      expect(tokens).toMatchObject([
        { type: "text", contents: '<?start name="rec"><p>a</p>' },
        { type: "expr", contents: " x " },
      ]);
    });

    it("js prefix requires a word boundary", () => {
      expect(parseTemplate('<?json {"a":1} ?>')).toMatchObject([
        { type: "text", contents: '<?json {"a":1} ?>' },
      ]);
    });

    it("tag forms", () => {
      expect(parseTemplate("<?=htmlspecialchars(x)?>")).toMatchObject([
        { type: "expr", contents: "htmlspecialchars(x)" },
      ]);
      expect(parseTemplate("<?js= x ?>")).toMatchObject([{ type: "expr", contents: " x " }]);
      expect(parseTemplate("<?js x ?>")).toMatchObject([{ type: "code", contents: " x " }]);
      expect(parseTemplate("<? for (const x of y) { ?>a<? } ?>")).toMatchObject([
        { type: "code", contents: " for (const x of y) { " },
        { type: "text", contents: "a" },
        { type: "code", contents: " } " },
      ]);
      expect(parseTemplate("<?\n x\n?>")).toMatchObject([{ type: "code", contents: "\n x\n" }]);
      expect(parseTemplate("<??>")).toMatchObject([{ type: "code", contents: "" }]);
    });

    it("mixed", () => {
      const template = [
        "",
        "Hello, <?= name ?>!",
        "<?js if (age >= 18) { ?>",
        "  You are an adult.",
        "<?js } else { ?>",
        "  You are a minor.",
        "<?js } ?>",
        "",
      ].join("\n");
      const tokens = parseTemplate(template);
      // console.log(tokens);
      expect(tokens).toMatchObject([
        { type: "text", contents: "\nHello, " },
        { type: "expr", contents: " name " },
        { type: "text", contents: "!\n" },
        { type: "code", contents: " if (age >= 18) { " },
        { type: "text", contents: "\n  You are an adult.\n" },
        { type: "code", contents: " } else { " },
        { type: "text", contents: "\n  You are a minor.\n" },
        { type: "code", contents: " } " },
        { type: "text", contents: "\n" },
      ]);
    });
  });
});
