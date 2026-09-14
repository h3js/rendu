import { pathToFileURL } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  compileTemplateToModule,
  type CompileTemplateToModuleOptions,
  type RenderContextProvider,
} from "../src/index.ts";
import { referencesIdentifier } from "../src/runtime.ts";

const importSource = pathToFileURL(new URL("../src/index.ts", import.meta.url).pathname).href;

const toDataURL = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;

const load = async (template: string, opts: CompileTemplateToModuleOptions = {}) => {
  const code = compileTemplateToModule(template, { importSource, ...opts });
  const mod = await import(/* @vite-ignore */ toDataURL(code));
  return { code, render: mod[opts.exportName || "render"] };
};

const request = (url = "http://localhost/", init?: RequestInit) => new Request(url, init);

describe("compileTemplateToModule", () => {
  it("only imports used render context helpers", async () => {
    const { code, render } = await load("<h1>{{ title }}</h1>", { contextKeys: ["title"] });
    expect(code).toMatch(
      /import \{ renderContextToResponse as \w+, createRenderResponse as \w+ \}/,
    );
    expect(code).not.toMatch(/createRenderCookies|createSetCookie|createRedirect|createRenderURL/);
    const res: Response = await render(request(), { title: "<Hi>" });
    expect(await res.text()).toBe("<h1>&lt;Hi&gt;</h1>");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("provides referenced render context helpers", async () => {
    const template = [
      `<? setCookie("visited", $COOKIES.visited ? "2" : "1") ?>`,
      `<? if ($URL.pathname === "/old") redirect("/new", 301) ?>`,
      `{{ $METHOD }} {{ $HEADERS.get("x-test") }} {{ $REQUEST.url }} {{ $RESPONSE.status }}`,
    ].join("");
    const { code, render } = await load(template, { exportName: "renderPage", stream: false });
    for (const name of [
      "createRenderCookies",
      "createSetCookie",
      "createRedirect",
      "createRenderURL",
    ]) {
      expect(code).toContain(name);
    }
    expect(code.match(/\$RESPONSE,/g)).toHaveLength(1);
    const res: Response = await render(
      request("http://localhost/old", { headers: { cookie: "visited=1", "x-test": "yes" } }),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/new");
    expect(res.headers.get("set-cookie")).toBe("visited=2");
    expect(await res.text()).toBe("GET yes http://localhost/old 301");
  });

  it("detects usage in server scripts but not in text", async () => {
    const text = compileTemplateToModule(`<p>We redirect using $COOKIES and $URL {{ 1 }}</p>`);
    expect(text).not.toMatch(/createRenderCookies|createRenderURL|createRedirect/);

    const { code, render } = await load(
      `<script server>const visited = $COOKIES.visited</script>{{ visited }}`,
    );
    expect(code).toContain("createRenderCookies");
    const res: Response = await render(request("http://_", { headers: { cookie: "visited=yes" } }));
    expect(await res.text()).toBe("yes");
  });

  it("ignores render context keys in contextKeys", async () => {
    const { render } = await load("{{ title }}", {
      contextKeys: ["title", "htmlspecialchars", "$COOKIES", "$RESPONSE"],
    });
    const res: Response = await render(request(), { title: "<b>", $COOKIES: "ignored" });
    expect(await res.text()).toBe("&lt;b&gt;");
  });

  it("supports unicode context keys", async () => {
    const { render } = await load("{{ café }} {{ ünï }}", {
      contextKeys: ["café"],
      providers: { ünï: { value: `"code"` } },
    });
    expect(await (await render(request(), { café: "au lait" })).text()).toBe("au lait code");
  });

  it("keeps the runtime echo with an echo context key", async () => {
    const { render } = await load("a<? echo('b') ?>{{ c }}", { contextKeys: ["echo", "c"] });
    expect(await (await render(request(), { echo: "nope", c: "c" })).text()).toBe("abc");
  });

  it("supports a default export", async () => {
    const { render } = await load("ok", { exportName: "default" });
    expect(await (await render(request())).text()).toBe("ok");
  });

  it("lets template declarations shadow context helpers", async () => {
    const { render } = await load(
      `<? const redirect = 1 ?><? function setCookie() { return 2 } ?>{{ redirect }} {{ setCookie() }}`,
    );
    expect(await (await render(request())).text()).toBe("1 2");
  });

  it("exports the provider type", () => {
    // Type-level: checked by `pnpm test:types`.
    expectTypeOf<
      NonNullable<CompileTemplateToModuleOptions["providers"]>[string]
    >().toEqualTypeOf<RenderContextProvider>();
  });

  it("validates names", () => {
    expect(() => compileTemplateToModule("", { exportName: "a b" })).toThrow(/Invalid export name/);
    expect(() =>
      compileTemplateToModule("<?= request ?>", { providers: { request: { value: "1" } } }),
    ).toThrow(/Invalid context provider key/);
    expect(() =>
      compileTemplateToModule("<?= a ?>", {
        providers: { a: { import: { from: "x", name: "context" } } },
      }),
    ).toThrow(/Invalid import name/);
    expect(() => compileTemplateToModule("<?= a ?>", { providers: { a: {} } })).toThrow(
      /needs an import or a value/,
    );
    expect(() => compileTemplateToModule("", { exportName: "class" })).toThrow(
      /Invalid export name/,
    );
    expect(() => compileTemplateToModule("", { providers: { default: { value: "1" } } })).toThrow(
      /Invalid context provider key/,
    );
    expect(() => compileTemplateToModule("", { contextKeys: ["let"] })).toThrow(
      /Invalid context key/,
    );
    expect(() => compileTemplateToModule("", { contextKeys: ["__echo__"] })).toThrow(
      /Invalid context key/,
    );
    expect(() => compileTemplateToModule("", { providers: { __echo__: { value: "1" } } })).toThrow(
      /Invalid context provider key/,
    );
    // Generated names
    for (const exportName of ["__rendu_template__", "__rendu_0__"]) {
      expect(() => compileTemplateToModule("", { exportName })).toThrow(/Invalid export name/);
    }
    expect(() =>
      compileTemplateToModule("<?= a ?>", {
        providers: { a: { import: { from: "x", name: "__rendu_0__" } } },
      }),
    ).toThrow(/Invalid import name/);
    expect(() =>
      compileTemplateToModule("<?= __rendu_1__ ?>", {
        providers: { __rendu_1__: { import: { from: "x", name: "default" } } },
      }),
    ).toThrow(/Invalid import name/);
  });

  describe("providers", () => {
    const app = toDataURL(`export const serverFetch = (p) => "fetched:" + p;`);
    const session = toDataURL(
      `export const useSession = (req) => ({ user: new URL(req.url).searchParams.get("user") });`,
    );
    const providers = {
      serverFetch: { import: { from: app } },
      $SESSION: { import: { from: session, name: "useSession" }, value: "useSession(request)" },
      unused: { import: { from: "does-not-exist" } },
    };

    it("imports and creates only used providers", async () => {
      const { code, render } = await load(`{{ serverFetch("/api") }} {{ $SESSION.user }}`, {
        providers,
      });
      expect(code).not.toContain("does-not-exist");
      const res: Response = await render(request("http://_/?user=pooya"));
      expect(await res.text()).toBe("fetched:/api pooya");
    });

    it("keeps imports hidden from the template and the host module", async () => {
      const { render } = await load(`{{ typeof useSession }} {{ typeof createRenderResponse }}`, {
        providers,
      });
      expect(await (await render(request())).text()).toBe("undefined undefined");
    });

    it("binds default imports to the context key", async () => {
      const lib = toDataURL(`export default (p) => "lib:" + p;`);
      const { render } = await load(`{{ lib("a") }} {{ $LIB }}`, {
        providers: {
          lib: { import: { from: lib, name: "default" } },
          $LIB: { import: { from: lib, name: "default" }, value: `$LIB("b")` },
        },
      });
      expect(await (await render(request())).text()).toBe("lib:a lib:b");
    });

    it("can override built-in providers", async () => {
      const { code, render } = await load(`{{ $COOKIES.a }}`, {
        providers: { $COOKIES: { value: `{ a: "custom" }` } },
      });
      expect(code).not.toContain("createRenderCookies");
      expect(await (await render(request())).text()).toBe("custom");
    });

    it("can provide htmlspecialchars", async () => {
      const { code, render } = await load(`{{ "x" }}`, {
        providers: { htmlspecialchars: { value: "(s) => `[${s}]`" } },
      });
      expect(code).not.toContain("__htmlEscapes__");
      expect(await (await render(request())).text()).toBe("[x]");
    });
  });

  it("keeps a constant line offset with preserveLines", () => {
    const templateLine = (template: string) =>
      compileTemplateToModule(template, { preserveLines: true })
        .split("\n")
        .findIndex((line) => line.includes("MARK")) + 1;
    expect(templateLine(`a\nb\n<? MARK ?>`)).toBe(3 + 1);
    expect(templateLine(`<? setCookie("a", $URL) ?>\n{{ $COOKIES.a }}\n<? MARK ?>`)).toBe(3 + 1);
  });

  it("reports template line N as module line N + 1 in stack traces", async () => {
    const boom = `throw new Error("boom")`;
    // [template, line that throws]
    const cases: [string, number][] = [
      [`<? ${boom} ?>`, 1],
      [`<? setCookie("a", $URL) ?>\n{{\n  $COOKIES.a\n}}\n<? ${boom} ?>`, 5],
      [`<script\n  server>\n${boom}\n</script>`, 3],
      [`<? const a = 1 ?><?\n${boom}\n?>`, 2],
    ];
    for (const stream of [false, true]) {
      for (const [template, line] of cases) {
        const { render } = await load(template, { preserveLines: true, stream });
        const error = await render(request()).then(
          (res: Response) => res.text(),
          (error: Error) => error,
        );
        const match = /data:text\/javascript,\S*:(\d+):\d+\)/.exec(error?.stack || "");
        expect([template, Number(match?.[1])]).toEqual([template, line + 1]);
      }
    }
  });

  it("matches snapshot", () => {
    const code = compileTemplateToModule(`<? if ($COOKIES.user) redirect("/home") ?>{{ title }}`, {
      contextKeys: ["title"],
      providers: { serverFetch: { import: { from: "nitro/app" } } },
    });
    // Only the module wrapper (the compiled template is covered by compiler snapshots).
    expect(code.slice(code.indexOf("export async function"))).toMatchSnapshot();
  });
});

describe("referencesIdentifier", () => {
  it("matches standalone identifiers", () => {
    expect(referencesIdentifier("$URL.pathname", "$URL")).toBe(true);
    expect(referencesIdentifier("`${$URL}`", "$URL")).toBe(true);
    expect(referencesIdentifier("obj.$URL", "$URL")).toBe(false);
    expect(referencesIdentifier("obj?.$URL", "$URL")).toBe(false);
    expect(referencesIdentifier("{ ...$URL }", "$URL")).toBe(true);
    expect(referencesIdentifier("$URLx", "$URL")).toBe(false);
    expect(referencesIdentifier("a$URL", "$URL")).toBe(false);
    expect(referencesIdentifier("redirects()", "redirect")).toBe(false);
  });
});
