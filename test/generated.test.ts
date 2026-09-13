import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { generatedFile, generateRuntime } from "../scripts/build-runtime.ts";
import * as generated from "../src/runtime/_generated.ts";

describe("generated runtime", () => {
  it("is up to date with src/runtime (run `pnpm build:runtime`)", async () => {
    expect(await readFile(generatedFile, "utf8")).toBe(await generateRuntime());
  });

  it("does not leak code between snippets built from the same module", () => {
    // `defer.ts` and `text.ts` hold a prelude helper and a runtime each; tree-shaking must keep
    // them apart.
    for (const prelude of [generated.echo, generated.htmlspecialchars]) {
      expect(prelude).not.toMatch(/ReadableStream|__deferred__|function defer/);
    }
    for (const prelude of [generated.deferStream, generated.deferText]) {
      expect(prelude).not.toMatch(/ReadableStream|TextDecoder|__renduPatch/);
    }
    for (const runtime of [generated.streamDefer, generated.streamDeferPolyfill, generated.text]) {
      expect(runtime).not.toMatch(/Math\.random|__deferSeq__|function defer/);
    }
  });
});
