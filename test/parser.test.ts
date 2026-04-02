import { describe, expect, it } from "vitest";
import { hasTemplateSyntax, parseTemplate } from "../src/parser.ts";

describe("parser", () => {
  describe("hasTemplateSyntax", () => {
    it("no syntax", () => {
      expect(hasTemplateSyntax("Hello, World!")).toBe(false);
      expect(hasTemplateSyntax("Just some text.")).toBe(false);
    });

    it("with syntax", () => {
      expect(hasTemplateSyntax("Hello, <?= name ?>!")).toBe(true);
      expect(hasTemplateSyntax("{{ name }}")).toBe(true);
      expect(hasTemplateSyntax("{{{ name }}}")).toBe(true);
      expect(hasTemplateSyntax("<?js if (true) { ?>Yes<?js } ?>")).toBe(true);
      expect(hasTemplateSyntax("<script server>console.log('hi');</script>")).toBe(true);
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
      expect(tokens).toMatchObject([
        { type: "expr", contents: "htmlspecialchars(a ?\n  b : c)" },
      ]);
    });

    it("multiline curly unescaped expression", () => {
      const tokens = parseTemplate("{{{ a ?\n  b : c }}}");
      expect(tokens).toMatchObject([
        { type: "expr", contents: "a ?\n  b : c" },
      ]);
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
      const tokens = parseTemplate(
        "<script server>const x = 1;</script><p><?= x ?></p>",
      );
      expect(tokens).toMatchObject([
        { type: "code", contents: "const x = 1;" },
        { type: "text", contents: "<p>" },
        { type: "expr", contents: " x " },
        { type: "text", contents: "</p>" },
      ]);
    });

    it("empty expression", () => {
      const tokens = parseTemplate("<?= ?>");
      expect(tokens).toMatchObject([{ type: "expr", contents: " " }]);
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
