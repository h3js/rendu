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

    it("decodes bytes across values, streams and echoes in output order, like streaming", async () => {
      const cases: [string, () => Record<string, any>][] = [
        [
          "<?= a ?><?= b ?>",
          () => ({ a: new Uint8Array([0xe2, 0x82]), b: new Uint8Array([0xac]) }),
        ],
        [
          "<?= a ?><?= b ?>",
          () => ({ a: new Uint8Array([0xe2]), b: streamOf([new Uint8Array([0x82, 0xac])]) }),
        ],
        [
          "<?= a ?><? const b = () => { echo(new Uint8Array([0x82])); return new Uint8Array([0xac]) } ?><?= b ?>",
          () => ({ a: new Uint8Array([0xe2]) }),
        ],
        // A string flushes the pending bytes ahead of it.
        [
          "<?= a ?>",
          () => ({ a: streamOf([new Uint8Array([0x61, 0xe2]), "x", new Uint8Array([0x62])]) }),
        ],
        ["<?= a ?>x", () => ({ a: new Uint8Array([0xe2]) })],
        // Other stream chunks are rendered via String().
        ["<?= a ?>", () => ({ a: streamOf([1, "x", true, null]) })],
        // An empty string does not split a character.
        [
          "<?= a ?><?= b ?><?= c ?><?= a ?><?= d ?><?= c ?>",
          () => ({
            a: new Uint8Array([0xe2, 0x82]),
            b: "",
            c: new Uint8Array([0xac]),
            d: Promise.resolve(""),
          }),
        ],
        [
          "<?= a ?>",
          () => ({ a: streamOf([new Uint8Array([0xe2, 0x82]), "", new Uint8Array([0xac])]) }),
        ],
      ];
      for (const [template, context] of cases) {
        const text = await renderText(template, context());
        expect(text).toBe(await renderStream(template, context()));
      }
      expect(await renderText(cases[0]![0], cases[0]![1]())).toBe("€");
      expect(await renderText(cases[3]![0], cases[3]![1]())).toBe("a�xb");
      expect(await renderText(cases[5]![0], cases[5]![1]())).toBe("1xtruenull");
      expect(await renderText(cases[6]![0], cases[6]![1]())).toBe("€€");
      expect(await renderText(cases[7]![0], cases[7]![1]())).toBe("€");
    });

    it("decodes bytes in a defer() patch like streaming", async () => {
      const template = "<?= defer(a) ?>|<?= defer(b) ?>";
      const context = () => ({
        a: streamOf([new Uint8Array([0xe2, 0x82]), "", new Uint8Array([0xac])]),
        b: streamOf([new Uint8Array([0x61, 0xe2]), "x", new Uint8Array([0x82, 0xac])]),
      });
      expect(await renderText(template, context())).toBe("€|a�x��");
      const stream = await renderStream(template, context());
      expect(stream).toMatch(/<template for="\w+0">€<\/template>/);
      expect(stream).toMatch(/<template for="\w+1">a�x��<\/template>/);
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

    /** A stream that records its reads (beyond the initial fill) and its cancellation. */
    const tracked = (name: string, log: string[]) => {
      let started = false;
      return new ReadableStream({
        pull(controller) {
          if (started) log.push(`${name} read`);
          started = true;
          controller.enqueue("x");
        },
        cancel(reason) {
          log.push(`${name} cancelled: ${reason}`);
        },
      });
    };

    it.each([
      ["", ""],
      ["defer", "<?= defer('d') ?>"],
    ])(
      "cancels chunks not read yet, even once a promise resolves to one (%s)",
      async (_, prefix) => {
        const log: string[] = [];
        const late = Promise.withResolvers<ReadableStream>();
        const stream = await compileTemplate(
          `${prefix}<?= first ?><?= later ?><?= late.promise ?><?= fn ?>`,
          { stream: true },
        )({
          first: tracked("first", log),
          later: tracked("later", log),
          late,
          fn: () => log.push("fn called"),
        });
        const reader = stream.getReader();
        await reader.read();
        await reader.cancel("gone");
        late.resolve(tracked("late", log));
        await new Promise((resolve) => setTimeout(resolve, 10));
        // `first` is being read when the output is cancelled: only the others must not be.
        expect(log.filter((entry) => entry !== "first read").toSorted()).toEqual([
          "first cancelled: gone",
          "late cancelled: gone",
          "later cancelled: gone",
        ]);
      },
    );

    it.each([true, false])(
      "cancels the chunks left unread when a chunk fails the render (stream: %s)",
      async (stream) => {
        const log: string[] = [];
        const result = compileTemplate(`<?= () => fn(echo) ?><?= later ?>`, { stream })({
          fn: (echo: (chunk: unknown) => void) => {
            echo(Promise.reject(new Error("boom")));
            return tracked("result", log);
          },
          later: tracked("later", log),
        });
        const render = async () => {
          const value = await result;
          if (stream) await new Response(value as ReadableStream).text();
        };
        await expect(render()).rejects.toThrow("boom");
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(log.toSorted()).toEqual([
          "later cancelled: Error: boom",
          "result cancelled: Error: boom",
        ]);
      },
    );

    it.each([
      [true, ""],
      [false, ""],
      [true, "<?= defer('d') ?>"],
      [false, "<?= defer('d') ?>"],
    ])(
      "cancels what a function chunk echoed before throwing (stream: %s) %s",
      async (stream, prefix) => {
        const log: string[] = [];
        const render = async () => {
          const value = await compileTemplate(`${prefix}<?= () => fn(echo) ?><?= later ?>`, {
            stream,
          })({
            fn: (echo: (chunk: unknown) => void) => {
              echo(tracked("echoed", log));
              throw new Error("sync");
            },
            later: tracked("later", log),
          });
          if (stream) await new Response(value as ReadableStream).text();
        };
        await expect(render()).rejects.toThrow("sync");
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(log.toSorted()).toEqual([
          "echoed cancelled: Error: sync",
          "later cancelled: Error: sync",
        ]);
      },
    );
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

    it("does not leave an echoed promise's early rejection unhandled", async () => {
      // A promise is only awaited once the chunks before it are written (or never, when the
      // body throws), so Node's default --unhandled-rejections=throw would terminate the process.
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const context = {
          slow: () => new Promise((r) => setTimeout(() => r("slow"), 20)),
          after: (ms: number) => new Promise((r) => setTimeout(r, ms)),
        };
        const template = `A<?= slow() ?>B<?= Promise.reject(new Error("boom")) ?>`;
        await expect(renderText(template, context)).rejects.toThrow("boom");
        await expect(renderStream(template, context)).rejects.toThrow("boom");
        await expect(
          renderText(
            `<?js const d = defer(Promise.reject(new Error("boom"))); await after(20) ?><?= d ?>`,
            context,
          ),
        ).rejects.toThrow("boom");
        const throwing = `<?= Promise.reject(new Error("boom")) ?><?js throw new Error("body") ?>`;
        await expect(renderText(throwing, context)).rejects.toThrow("body");
        await expect(renderStream(throwing, context)).rejects.toThrow("body");
        await new Promise((r) => setTimeout(r, 10));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
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

    it("escapes the values <?= ?> would write", async () => {
      // null/undefined are empty, functions are called and promises awaited, then escaped.
      const context = { promise: Promise.resolve("<p>"), empty: Promise.resolve(null) };
      const template =
        `<?js const fn = () => { echo("<raw>"); return Promise.resolve("<fn>") } ?>` +
        `[{{ null }}][{{ undefined }}][{{ 0 }}][{{ fn }}][{{ promise }}][{{ empty }}]`;
      const expected = "[][][0][<raw>&lt;fn&gt;][&lt;p&gt;][]";
      expect(await renderText(template, context)).toBe(expected);
      expect(await renderStream(template, context)).toBe(expected);
    });

    it("does not leave an escaped promise's early rejection unhandled", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const context = { slow: () => new Promise((r) => setTimeout(() => r("slow"), 20)) };
        const template = `A{{ slow() }}B{{ Promise.reject(new Error("boom")) }}`;
        await expect(renderText(template, context)).rejects.toThrow("boom");
        await expect(renderStream(template, context)).rejects.toThrow("boom");
        await new Promise((r) => setTimeout(r, 10));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
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
