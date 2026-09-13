import { describe, expect, it } from "vitest";
import { compileTemplate } from "../src/compiler.ts";

const renderText = (template: string, context: Record<string, any> = {}) =>
  compileTemplate(template, { stream: false })(context);

const renderStream = async (template: string, context: Record<string, any> = {}) =>
  new Response(await compileTemplate(template, { stream: true })(context)).text();

function streamOf(values: unknown[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const value of values) {
        controller.enqueue(value);
      }
      controller.close();
    },
  });
}

describe("runtime", () => {
  describe("value coercion (text)", () => {
    it("renders numbers and booleans", async () => {
      expect(await renderText("<?= 42 ?>|<?= 0 ?>|<?= false ?>")).toBe("42|0|false");
    });

    it("renders null and undefined as empty string", async () => {
      expect(await renderText("[<?= null ?>][<?= undefined ?>]")).toBe("[][]");
    });

    it("renders objects via String()", async () => {
      expect(await renderText("<?= [1,2] ?>")).toBe("1,2");
    });

    it("decodes Uint8Array chunks", async () => {
      expect(await renderText("<?= bytes ?>", { bytes: new TextEncoder().encode("héllo") })).toBe(
        "héllo",
      );
    });
  });

  describe("value coercion (stream)", () => {
    it("renders numbers and booleans", async () => {
      expect(await renderStream("<?= 42 ?>|<?= 0 ?>|<?= false ?>")).toBe("42|0|false");
    });

    it("renders null and undefined as empty string", async () => {
      expect(await renderStream("[<?= null ?>][<?= undefined ?>]")).toBe("[][]");
    });

    it("renders promises resolving to falsy values", async () => {
      expect(
        await renderStream("[<?= zero ?>][<?= empty ?>][<?= nil ?>]", {
          zero: Promise.resolve(0),
          empty: Promise.resolve(""),
          nil: Promise.resolve(null),
        }),
      ).toBe("[0][][]");
    });
  });

  describe("multi-byte utf-8", () => {
    it("does not corrupt characters split across chunks (text)", async () => {
      const bytes = new TextEncoder().encode("héllo 世界");
      const chunks = [bytes.slice(0, 2), bytes.slice(2, 9), bytes.slice(9)];
      expect(await renderText("<?= stream ?>", { stream: streamOf(chunks) })).toBe("héllo 世界");
    });

    it("does not corrupt characters split across chunks (stream)", async () => {
      const bytes = new TextEncoder().encode("héllo 世界");
      const chunks = [bytes.slice(0, 2), bytes.slice(2, 9), bytes.slice(9)];
      expect(await renderStream("<?= stream ?>", { stream: streamOf(chunks) })).toBe("héllo 世界");
    });
  });

  describe("Response values", () => {
    it("unwraps a sync Response (stream)", async () => {
      expect(await renderStream("<?= res ?>", { res: new Response("hello") })).toBe("hello");
    });

    it("unwraps a sync Response (text)", async () => {
      expect(await renderText("<?= res ?>", { res: new Response("hello") })).toBe("hello");
    });

    it("unwraps an awaited Response (stream)", async () => {
      expect(
        await renderStream("<?= res ?>", { res: Promise.resolve(new Response("hello")) }),
      ).toBe("hello");
    });

    it("handles a Response with a null body", async () => {
      expect(await renderText("[<?= res ?>]", { res: new Response(null) })).toBe("[]");
    });
  });

  describe("inner streams", () => {
    it("encodes string chunks (stream)", async () => {
      expect(await renderStream("<?= stream ?>", { stream: streamOf(["a", "b"]) })).toBe("ab");
    });

    it("accepts string chunks (text)", async () => {
      expect(await renderText("<?= stream ?>", { stream: streamOf(["a", "b"]) })).toBe("ab");
    });

    it("cancels the active inner reader when the consumer cancels", async () => {
      let cancelled: unknown;
      const inner = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("chunk"));
        },
        cancel(reason) {
          cancelled = reason;
        },
      });
      const stream = await compileTemplate("<?= stream ?>", { stream: true })({ stream: inner });
      const reader = stream.getReader();
      await reader.read();
      await reader.cancel("client gone");
      expect(cancelled).toBe("client gone");
    });
  });

  describe("functions and thenables", () => {
    it("calls functions and awaits thenables", async () => {
      // oxlint-disable-next-line no-thenable -- intentionally testing thenable support
      const thenable = { then: (resolve: (v: string) => void) => resolve("then") };
      expect(await renderText("<?= fn ?><?= thenable ?>", { fn: () => "fn", thenable })).toBe(
        "fnthen",
      );
      expect(await renderStream("<?= fn ?><?= thenable ?>", { fn: () => "fn", thenable })).toBe(
        "fnthen",
      );
    });
  });

  describe("echo() timing", () => {
    const lateEcho = /echo\(\) must be called synchronously/;

    it("writes a function chunk's synchronous echoes in place, in both modes", async () => {
      // The output loop calls `h` after the body has ended: what it echoes goes right before
      // its result, not to the end of the output.
      const template =
        `<?js const h = () => { echo("x"); echo(() => { echo("n"); return "m" }); return "y" } ?>` +
        `<p><?= h ?></p><end>`;
      expect(await renderText(template)).toBe("<p>xnmy</p><end>");
      expect(await renderStream(template)).toBe("<p>xnmy</p><end>");
    });

    it("writes the synchronous echoes of an async function chunk before its result", async () => {
      const template = `<p><?= async () => { echo("a"); await null; return "b" } ?></p><end>`;
      expect(await renderText(template)).toBe("<p>ab</p><end>");
      expect(await renderStream(template)).toBe("<p>ab</p><end>");
    });

    it("rejects with a function chunk's rejection after its echoes are written", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        // The slow echoed value keeps the rejected result waiting to be written.
        const template = `<?js const fn = () => { echo(slow()); return Promise.reject(new Error("boom")) } ?><?= fn ?>`;
        const slow = () => new Promise((r) => setTimeout(() => r("a"), 20));
        await expect(renderText(template, { slow })).rejects.toThrow("boom");
        await expect(renderStream(template, { slow })).rejects.toThrow("boom");
        await new Promise((r) => setTimeout(r, 10));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });

    it("throws when echo() is called after the body has ended", async () => {
      // A timer (or anything after an await) cannot be tied to a position in the output.
      for (const render of [renderText, renderStream]) {
        const errors: unknown[] = [];
        const later = (fn: () => void) =>
          setTimeout(() => {
            try {
              fn();
            } catch (error) {
              errors.push(error);
            }
          }, 0);
        expect(await render(`<a><?js later(() => echo("late")) ?></a>`, { later })).toBe("<a></a>");
        await new Promise((r) => setTimeout(r, 10));
        expect(errors).toEqual([
          expect.objectContaining({ message: expect.stringMatching(lateEcho) }),
        ]);
      }
    });

    it("throws when an async function chunk echoes after an await", async () => {
      const template = `<p><?= async () => { await null; echo("late"); return "b" } ?></p>`;
      await expect(renderText(template)).rejects.toThrow(lateEcho);
      await expect(renderStream(template)).rejects.toThrow(lateEcho);
    });
  });

  describe("htmlspecialchars", () => {
    it("is available without a render context", async () => {
      expect(await renderText("{{ title }}", { title: `<b>"x" & 'y'</b>` })).toBe(
        "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;",
      );
      expect(await renderStream("{{ title }}", { title: "<b>" })).toBe("&lt;b&gt;");
    });

    it("is available in contextKeys mode", async () => {
      const fn = compileTemplate("{{ name }}", { stream: false, contextKeys: ["name"] });
      expect(await fn({ name: "<b>" })).toBe("&lt;b&gt;");
    });

    it("can be overridden via contextKeys", async () => {
      const fn = compileTemplate("{{ name }}", {
        stream: false,
        contextKeys: ["htmlspecialchars", "name"],
      });
      expect(await fn({ name: "<b>", htmlspecialchars: (s: string) => `[${s}]` })).toBe("[<b>]");
    });

    it("can be overridden via the context in with-mode", async () => {
      const fn = compileTemplate("{{ name }}", { stream: false });
      expect(await fn({ name: "<b>", htmlspecialchars: (s: string) => `[${s}]` })).toBe("[<b>]");
    });
  });

  describe("expressions", () => {
    it("supports trailing line comments", async () => {
      expect(await renderText("<?= 1 // one ?>")).toBe("1");
    });

    it("supports multi-line expressions", async () => {
      expect(await renderText("<?= [1, 2]\n  .join('-') ?>")).toBe("1-2");
    });
  });

  it("reports syntax errors with a cause", () => {
    try {
      compileTemplate("<?= ) ?>", { stream: false });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SyntaxError);
      expect((error as SyntaxError).cause).toBeInstanceOf(Error);
    }
  });
});
