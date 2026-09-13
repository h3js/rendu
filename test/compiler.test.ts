import { describe, expect, it } from "vitest";
import { compileTemplate } from "../src/compiler.ts";
import { runtimeHelpers } from "../src/runtime.ts";
import { format } from "oxfmt";

describe("compileTemplater", () => {
  describe("compileTemplate", () => {
    it("compileTemplates to a function", async () => {
      const template = "Hello, <? if(name) ?><?= await name ?><? else ?>Guest";
      const fn = compileTemplate(template, { stream: false });
      expect(await fn({ name: "JS" })).toBe("Hello, JS");
      expect(await fn({ name: "" })).toBe("Hello, Guest");
      await expect((await format("test.js", fn.toString())).code).toMatchFileSnapshot(
        "snapshots/complied.js",
      );
    });

    it("compileTemplates to a function (known keys)", async () => {
      const template = "Hello, <? if(name) ?><?= await name ?><? else ?>Guest";
      const fn = compileTemplate(template, {
        stream: false,
        contextKeys: ["name"],
      });
      expect(await fn({ name: "JS" })).toBe("Hello, JS");
      expect(await fn({ name: "" })).toBe("Hello, Guest");
      await expect((await format("test.js", fn.toString())).code).toMatchFileSnapshot(
        "snapshots/compiled-strict.js",
      );
    });

    it("compileTemplates to a function (stream)", async () => {
      const template = "Hello, <? if(name) ?><?= await name ?><? else ?>Guest";
      const fn = compileTemplate(template, { stream: true });
      expect(await new Response(await fn({ name: "JS" })).text()).toBe("Hello, JS");
      await expect((await format("test.js", fn.toString())).code).toMatchFileSnapshot(
        "snapshots/compiled-stream.js",
      );
    });

    it("compileTemplates to a function (stream, defer)", async () => {
      const template = "Hello, <?= defer(name, '<i>Guest</i>') ?>!";
      const fn = compileTemplate(template, { stream: true });
      expect(await new Response(await fn({ name: Promise.resolve("JS") })).text()).toMatch(
        /^Hello, <\?start name="(d[a-z\d]{6}_0)"><i>Guest<\/i><\?end>!<script>window\.__renduPatch=[\s\S]*<\/script><template for="\1">JS<\/template><script>__renduPatch\(\)<\/script>$/,
      );
      await expect((await format("test.js", fn.toString())).code).toMatchFileSnapshot(
        "snapshots/compiled-stream-defer.js",
      );
    });

    it("separates statements between tags", async () => {
      const cases = {
        "a<? // note ?>": "a",
        "a<? [1, 2].forEach(i => echo(i)) ?>": "a12",
        "<?= 'x' ?><? (() => echo('y'))() ?>": "xy",
        "<? if (ok) ?>yes<? // note ?>": "yes",
      };
      for (const [template, expected] of Object.entries(cases)) {
        for (const opts of [{}, { contextKeys: ["ok"] }, { preserveLines: true }]) {
          for (const stream of [false, true]) {
            const fn = compileTemplate(template, { stream, ...opts });
            expect(await new Response(await fn({ ok: true })).text()).toBe(expected);
          }
        }
      }
    });
  });
});

describe("runtime helpers", () => {
  const usesHelper = (fn: { toString(): string }) =>
    fn.toString().includes(runtimeHelpers.htmlspecialchars);

  it("only inlines htmlspecialchars when used", async () => {
    const plain = compileTemplate("Hello, <?= name ?>", { stream: false });
    expect(usesHelper(plain)).toBe(false);
    expect(await plain({ name: "<b>" })).toBe("Hello, <b>");

    for (const template of ["Hello, {{ name }}", "Hello, <?= htmlspecialchars(name) ?>"]) {
      for (const stream of [false, true]) {
        const fn = compileTemplate(template, { stream });
        expect(usesHelper(fn)).toBe(true);
        const out = await fn({ name: "<b>" });
        expect(await new Response(out).text()).toBe("Hello, &lt;b&gt;");
      }
    }
  });

  it("prefers htmlspecialchars from the context", async () => {
    const custom = (s: string) => `[${s}]`;
    const withMode = compileTemplate("{{ name }}", { stream: false });
    expect(await withMode({ name: "x", htmlspecialchars: custom })).toBe("[x]");

    const strict = compileTemplate("{{ name }}", {
      stream: false,
      contextKeys: ["name", "htmlspecialchars"],
    });
    expect(usesHelper(strict)).toBe(false);
    expect(await strict({ name: "x", htmlspecialchars: custom })).toBe("[x]");
  });
});

describe("preserveLines", () => {
  const mixed = [
    `<? const items = list ?>`,
    `<ul>`,
    `<? for (const item of items) { ?>`,
    `  <li>{{ item }} <?= item.toUpperCase() ?></li>`,
    `<? } ?>`,
    `</ul>`,
  ].join("\n");

  it("renders identically to the default mode", async () => {
    for (const template of [mixed, mixed + "\n", "no tags at all", ""]) {
      const data = { list: ["a", "<b>"] };
      const plain = compileTemplate(template, { stream: false });
      const preserved = compileTemplate(template, { stream: false, preserveLines: true });
      expect(await preserved(data)).toBe(await plain(data));
    }
  });

  it("does not swallow the next part with a line comment", async () => {
    const code = compileTemplate("<? // note ?>TEXT", {
      stream: false,
      preserveLines: true,
    });
    expect(await code({})).toBe("TEXT");

    const expr = compileTemplate("<?= 1 + 1 // note ?>TEXT", {
      stream: false,
      preserveLines: true,
    });
    expect(await expr({})).toBe("2TEXT");
  });

  it("keeps template lines aligned with generated lines", async () => {
    const filename = "align.html";
    const throwLine = async (template: string, opts = {}) => {
      const fn = compileTemplate(template, {
        stream: false,
        preserveLines: true,
        filename,
        ...opts,
      });
      try {
        await fn({ list: ["a", "b"] });
      } catch (error) {
        const match = new RegExp(`${filename}:(\\d+):`).exec((error as Error).stack || "");
        return match ? Number(match[1]) : Number.NaN;
      }
      throw new Error("template did not throw");
    };

    const boom = `<? throw new Error("boom") ?>`;
    const template = `${mixed}\n${boom}\n`; // `boom` is on line 7

    for (const opts of [{}, { contextKeys: ["list"] }]) {
      // Offset of the compiled function preamble, measured from a one line template.
      const offset = (await throwLine(boom, opts)) - 1;
      expect(await throwLine(template, opts)).toBe(offset + 7);
    }
  });
});
