import { describe, expect, it } from "vitest";
import { compileTemplate } from "../src/compiler.ts";
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
      ).toMatchFileSnapshot("snapshots/complied.js");
    });

    it("compileTemplates to a function (known keys)", async () => {
      const template = "Hello, <? if(name) ?><?= await name ?><? else ?>Guest";
      const fn = compileTemplate(template, {
        stream: false,
        contextKeys: ["name"],
      });
      expect(await fn({ name: "JS" })).toBe("Hello, JS");
      expect(await fn({ name: "" })).toBe("Hello, Guest");
      await expect(
        await format(fn.toString(), { parser: "acorn" }),
      ).toMatchFileSnapshot("snapshots/compiled-strict.js");
    });

    it("compileTemplates to a function (stream)", async () => {
      const template = "Hello, <? if(name) ?><?= await name ?><? else ?>Guest";
      const fn = compileTemplate(template, { stream: true });
      expect(await new Response(await fn({ name: "JS" })).text()).toBe(
        "Hello, JS",
      );
      await expect(
        await format(fn.toString(), { parser: "acorn" }),
      ).toMatchFileSnapshot("snapshots/compiled-stream.js");
    });
  });
});
