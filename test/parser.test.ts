import { describe, expect, it } from "vitest";
import { parseTemplate } from "../src/_parser.ts";

describe("parser", () => {
  describe("parseTemplate", () => {
    it("plain text", () => {
      const tokens = parseTemplate("Hello, World!");
      expect(tokens).toMatchObject([
        { type: "text", contents: "Hello, World!" },
      ]);
    });

    it("expression", () => {
      const tokens = parseTemplate("<?js= name ?>");
      expect(tokens).toMatchObject([{ type: "expr", contents: " name " }]);
    });

    it("expression (short)", () => {
      const tokens = parseTemplate("<?= name ?>");
      expect(tokens).toMatchObject([{ type: "expr", contents: " name " }]);
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
