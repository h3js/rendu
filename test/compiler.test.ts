import { describe, expect, it } from "vitest";
import { compileTemplate, type CompileTemplateOptions } from "../src/compiler.ts";
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

    it("lets template declarations shadow context keys", async () => {
      const template =
        "<? const name = 'local' ?><? function greet() { return 'hi' } ?>{{ greet() }} {{ name }}";
      for (const stream of [false, true]) {
        const fn = compileTemplate(template, { stream, contextKeys: ["name", "greet"] });
        expect(await new Response(await fn({ name: "ctx", greet: () => "ctx" })).text()).toBe(
          "hi local",
        );
      }
    });

    it("validates and dedupes contextKeys", async () => {
      const invalid = [
        "foo-bar",
        "let",
        "__echo__",
        "__context__",
        "a}=__context__;globalThis.x=1;const{b",
      ];
      for (const key of invalid) {
        expect(() => compileTemplate("", { contextKeys: [key] })).toThrow(/Invalid context key/);
      }
      const fn = compileTemplate("{{ a }} {{ café }}", {
        stream: false,
        contextKeys: ["a", "café", "a"],
      });
      expect(await fn({ a: 1, café: 2 })).toBe("1 2");
    });

    it("writes the output with the runtime echo over a context echo", async () => {
      for (const stream of [false, true]) {
        const withMode = compileTemplate("a{{ b }}<?= 'c' ?>", { stream });
        const context = { echo: "nope", b: "b", __chunks__: 1, __sink__: 1, concatStreams: 1 };
        expect(await new Response(await withMode(context)).text()).toBe("abc");

        const strict = compileTemplate("a{{ b }}<? echo('c') ?>", {
          stream,
          contextKeys: ["echo", "b"],
        });
        expect(await new Response(await strict({ echo: "nope", b: "b" })).text()).toBe("abc");
      }
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

  it("renders curly expressions with nested braces and line comments", async () => {
    const template =
      "{{ JSON.stringify({ a: { b: x } }) // note }}|{{{ x // raw }}}\n<p>{{ x }}</p>";
    for (const preserveLines of [false, true]) {
      const fn = compileTemplate(template, { stream: false, preserveLines });
      expect(await fn({ x: "<" })).toBe(
        "{&quot;a&quot;:{&quot;b&quot;:&quot;&lt;&quot;}}|<\n<p>&lt;</p>",
      );
    }
  });

  it("keeps template lines aligned with generated lines", async () => {
    const filename = "align.html";
    const throwLine = async (template: string, opts: CompileTemplateOptions) => {
      const fn = compileTemplate(template, { preserveLines: true, filename, ...opts });
      try {
        const output = await fn({ list: ["a", "b"] });
        await new Response(output).text();
      } catch (error) {
        const match = new RegExp(`${filename}:(\\d+):`).exec((error as Error).stack || "");
        return match ? Number(match[1]) : Number.NaN;
      }
      throw new Error("template did not throw");
    };

    const boom = `<? throw new Error("boom") ?>`;
    const expr = `(() => { throw new Error("boom") })()`;
    // [template, line that throws]
    const cases: [string, number][] = [
      [boom, 1],
      [`${mixed}\n${boom}\n`, 7],
      [`a\r\nb\rc\n${boom}`, 4],
      [`a\u2028b\u2029c\n${boom}`, 2],
      [`{{\n  list\n}}\n${boom}`, 4],
      [`{{{\n  list\n}}}\n${boom}`, 4],
      [`{{ list // note\n}}\n${boom}`, 3],
      [`{{ \n }}\n${boom}`, 3],
      [`<? if (list) { ?>yes<? } ?>\n\n${boom}`, 3],
      [`a\n{{\n  ${expr}\n}}`, 3],
      [`{{{ list }}}{{\n\n ${expr} }}`, 3],
      [`<script\n  server\n>\n</script\n>\n${boom}`, 6],
      [`<script\n  server>\nthrow new Error("boom")\n</script>`, 3],
      [`<script server>const x = 1</script>\n${boom}`, 2],
      [`<? const a = 1 ?><?\nthrow new Error("boom")\n?>`, 2],
      [`<? const a = 1 ?><?= \n ${expr} ?>`, 2],
      [`<?= list // note ?><? const a = 1 ?>\n\n${boom}`, 3],
      [`<? const a = 1 ?><? const b = 2 ?>\n<?\n throw new Error("boom") ?>`, 3],
      [`<? for (const item of list) { ?>\n  <li>{{ item }}</li>\n<? } ?>\n${boom}`, 4],
      [`<? if (list) { // note ?>\n<p>\n</p>\n<? } ?><?\n\n${expr} ?>`, 6],
    ];

    for (const opts of [
      { stream: false },
      { stream: false, contextKeys: ["list"] },
      { stream: true },
      { stream: true, contextKeys: ["list"] },
    ]) {
      // Offset of the compiled function preamble, measured from a one line template.
      const offset = (await throwLine(boom, opts)) - 1;
      expect(offset).toBe(3); // Documented on `preserveLines`
      for (const [template, line] of cases) {
        expect([template, await throwLine(template, opts)]).toEqual([template, offset + line]);
      }
    }
  });
});
