import { describe, expect, it } from "vitest";
import { compileTemplate } from "../src/compiler.ts";
import { createRenderContext, renderToResponse, type RenderContext } from "../src/render.ts";

const request = (init?: RequestInit) => new Request("http://localhost/page", init);

describe("render", () => {
  describe("createRenderContext", () => {
    it("prepares an html content-type", () => {
      const ctx = createRenderContext({});
      expect(ctx.$RESPONSE.headers.get("content-type")).toBe("text/html; charset=utf-8");
    });

    describe("$COOKIES", () => {
      const withCookies = () =>
        createRenderContext({
          request: request({ headers: { cookie: "a=1; b=two" } }),
        }).$COOKIES;

      it("reads cookie values", () => {
        const cookies = withCookies();
        expect(cookies.a).toBe("1");
        expect(cookies.b).toBe("two");
        expect(cookies.missing).toBeUndefined();
      });

      it("supports the `in` operator", () => {
        const cookies = withCookies();
        expect("a" in cookies).toBe(true);
        expect("missing" in cookies).toBe(false);
      });

      it("supports keys, spread and JSON.stringify", () => {
        const cookies = withCookies();
        expect(Object.keys(cookies)).toEqual(["a", "b"]);
        expect(Object.entries(cookies)).toEqual([
          ["a", "1"],
          ["b", "two"],
        ]);
        expect({ ...cookies }).toEqual({ a: "1", b: "two" });
        expect(JSON.stringify(cookies)).toBe('{"a":"1","b":"two"}');
      });

      it("is empty without a request", () => {
        const cookies = createRenderContext({}).$COOKIES;
        expect(cookies.a).toBeUndefined();
        expect("a" in cookies).toBe(false);
        expect(Object.keys(cookies)).toEqual([]);
        expect({ ...cookies }).toEqual({});
        expect(JSON.stringify(cookies)).toBe("{}");
      });
    });

    it("appends Set-Cookie headers", () => {
      const ctx = createRenderContext({ request: request() });
      ctx.setCookie("a", "1");
      ctx.setCookie("b", "two", { path: "/", httpOnly: true });
      expect(ctx.$RESPONSE.headers.getSetCookie()).toEqual(["a=1", "b=two; Path=/; HttpOnly"]);
    });

    it("redirects with a status and location", () => {
      const ctx = createRenderContext({ request: request() });
      ctx.redirect("/login");
      expect(ctx.$RESPONSE.status).toBe(302);
      expect(ctx.$RESPONSE.headers.get("location")).toBe("/login");

      ctx.redirect("/other", 301);
      expect(ctx.$RESPONSE.status).toBe(301);
      expect(ctx.$RESPONSE.headers.get("location")).toBe("/other");
    });

    it("resets the status text and percent-encodes the location", () => {
      const ctx = createRenderContext({ request: request() });
      ctx.$RESPONSE.statusText = "Custom";
      ctx.redirect(" /search?q=ü&r=%C3%BC 100%25#€\n");
      expect(ctx.$RESPONSE.statusText).toBe("");
      expect(ctx.$RESPONSE.headers.get("location")).toBe(
        "/search?q=%C3%BC&r=%C3%BC%20100%25#%E2%82%AC",
      );
    });
  });

  describe("renderToResponse", () => {
    it("escapes non-string values with the context htmlspecialchars", async () => {
      // The context helper shadows the inlined one, so it must resolve values the same way.
      const template = compileTemplate(`[{{ nothing }}][{{ promise }}]`, { stream: false });
      const response = await renderToResponse(template, {
        context: { nothing: null, promise: Promise.resolve("<b>") },
      });
      expect(await response.text()).toBe("[][&lt;b&gt;]");
    });

    it("returns the rendered body with the prepared headers", async () => {
      const template = compileTemplate(
        `Hello, <?= $COOKIES["user"] ?> (<?= $METHOD ?> <?= $URL.pathname ?>)`,
        { stream: false },
      );
      const response = await renderToResponse(template, {
        request: request({ headers: { cookie: "user=JS" } }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toBe("Hello, JS (GET /page)");
    });

    it("applies setCookie and redirect from the template", async () => {
      const template = compileTemplate(`<? setCookie("session", "1"); redirect("/login", 307) ?>`, {
        stream: false,
      });
      const response = await renderToResponse(template, { request: request() });
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("/login");
      expect(response.headers.getSetCookie()).toEqual(["session=1"]);
    });

    it("does not pair a changed status with an OK status text", async () => {
      const template = compileTemplate(`<? $RESPONSE.status = 404 ?>`, { stream: false });
      const response = await renderToResponse(template, { request: request() });
      expect(response.status).toBe(404);
      expect(response.statusText).toBe("");
    });

    it("rejects setCookie and redirect once the response head is sent", async () => {
      // defer() makes running request work after the shell routine, but the prepared
      // headers have already been serialized by then — so fail loudly instead of appending
      // to a Headers object nobody will read again.
      let capturedSetCookie: RenderContext["setCookie"] | undefined;
      let capturedRedirect: RenderContext["redirect"] | undefined;
      const template = compileTemplate(
        `<? capture(setCookie, redirect) ?><a><?= defer(null) ?></a>`,
        { stream: true },
      );
      const response = await renderToResponse(template, {
        request: request(),
        context: {
          capture: (s: RenderContext["setCookie"], r: RenderContext["redirect"]) => {
            capturedSetCookie = s;
            capturedRedirect = r;
          },
        },
      });
      await response.text();
      expect(() => capturedSetCookie!("session", "1")).toThrow(/after the response head was sent/);
      expect(() => capturedRedirect!("/login")).toThrow(/after the response head was sent/);
    });

    it.each([
      [`<p>hi</p><?= getUser().then((u) => { if (!u) redirect("/login") }) ?>`],
      [`<?= "a" ?><?= "b" ?><?= () => { redirect("/login"); return "x" } ?>`],
    ])("explains the late head error without blaming defer(): %s", async (html) => {
      const template = compileTemplate(html, { stream: true });
      const response = await renderToResponse(template, {
        request: request(),
        context: { getUser: () => new Promise((r) => setTimeout(() => r(null), 5)) },
      });
      expect(response.status).toBe(200);
      const error = await response.text().then(
        () => undefined,
        (error: Error) => error,
      );
      expect(error?.message).toMatch(/after the response head was sent/);
      expect(error?.message).toMatch(/echoed functions, promises/);
      expect(error?.message).not.toMatch(/defer\(\)/);
    });

    it("passes a Response returned by the template through", async () => {
      const template = compileTemplate(`<? return new Response("raw", { status: 418 }) ?>`, {
        stream: false,
      });
      const response = await renderToResponse(template, { request: request() });
      expect(response.status).toBe(418);
      expect(await response.text()).toBe("raw");
    });
  });
});
