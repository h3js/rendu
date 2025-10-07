import { describe, expect, it } from "vitest";
import { compileTemplate, tokenize } from "../src/compiler.ts";
import { format } from "prettier";

describe("compileTemplater", () => {
  describe("compileTemplate", () => {
    it("compileTemplates to a function", async () => {
      const template = "Hello, <? if(name) ?><?= await name ?><? else ?>Guest";
      const fn = compileTemplate(template, { stream: false });
      expect(await fn({ name: "JS" })).toBe("Hello, JS");
      expect(await fn({ name: "" })).toBe("Hello, Guest");
      await expect(
        await format(fn.toString(), { parser: "acorn" }),
      ).toMatchFileSnapshot("snapshots/compileTemplated.js");
    });

    it("compileTemplates to a function (stream)", async () => {
      const template = "Hello, <? if(name) ?><?= await name ?><? else ?>Guest";
      const fn = compileTemplate(template, { stream: true });
      expect(await new Response(await fn({ name: "JS" })).text()).toBe(
        "Hello, JS",
      );
      await expect(
        await format(fn.toString(), { parser: "acorn" }),
      ).toMatchFileSnapshot("snapshots/compileTemplated-stream.js");
    });
  });

  describe("tokenize", () => {
    it("plain text", () => {
      const tokens = tokenize("Hello, World!");
      expect(tokens).toMatchObject([
        { type: "text", contents: "Hello, World!" },
      ]);
    });

    it("expression", () => {
      const tokens = tokenize("<?js= name ?>");
      expect(tokens).toMatchObject([{ type: "expr", contents: " name " }]);
    });

    it("expression (short)", () => {
      const tokens = tokenize("<?= name ?>");
      expect(tokens).toMatchObject([{ type: "expr", contents: " name " }]);
    });

    it("code", () => {
      const tokens = tokenize("<?js if (true) { ?>123<?js } ?>");
      expect(tokens).toMatchObject([
        { type: "code", contents: " if (true) { " },
        { type: "text", contents: "123" },
        { type: "code", contents: " } " },
      ]);
    });

    it("code (short)", () => {
      const tokens = tokenize("<? if (true) { ?>123<? } ?>");
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
      const tokens = tokenize(template);
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
