/**
 * Builds the inlined runtime snippets (`src/runtime/_generated.ts`) from the typed sources in
 * `src/runtime/`. The output is checked in, so run this after changing a source:
 *
 *   pnpm build:runtime
 *
 * (`test/generated.test.ts` fails while the checked-in output is stale.)
 *
 * Each snippet is built from a virtual entry that re-exports only what it needs from a source
 * module, so one module can hold several snippets (tree-shaking drops the rest):
 *
 * - Prelude helpers (`echo`, `htmlspecialchars`, both `defer`s) declare bindings in the template
 *   function scope, so they are minified as a script: top-level names (the re-exported ones) are
 *   kept, and each snippet is a single line (the prelude must span exactly one line).
 * - Runtimes (the default exports of `stream.ts`, `defer.ts`, `text.ts`) are bundled as an IIFE
 *   bound to a name. The body has ended by then, so the generated code clears `__sink__` (a late
 *   `echo()` throws) and calls it with the prelude's chunk list. Everything else stays private
 *   and mangled.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format } from "oxfmt";
import { build, type InputOptions, type OutputOptions } from "rolldown";
import { minifySync } from "rolldown/utils";

const srcDir = new URL("../src/runtime/", import.meta.url);

export const generatedFile = fileURLToPath(new URL("_generated.ts", srcDir));

const virtualEntry = "\0rendu-runtime-entry";

/**
 * Bundle `names` re-exported from `module` (`["default"]` for its default export), or `module`
 * itself as the entry when `names` is omitted.
 */
async function bundle(
  module: string,
  names: string[] | undefined,
  input: InputOptions,
  output: OutputOptions,
): Promise<string> {
  const entry = names ? `${module} { ${names.join(", ")} }` : module;
  const path = fileURLToPath(new URL(module, srcDir));
  const result = await build({
    ...input,
    input: names ? virtualEntry : path,
    plugins: [
      {
        name: "rendu-runtime-entry",
        resolveId: (id) => (id === virtualEntry ? id : undefined),
        load: (id) =>
          id === virtualEntry
            ? `export { ${names!.join(", ")} } from ${JSON.stringify(path)};`
            : undefined,
      },
    ],
    platform: "neutral",
    write: false,
    onLog(level, log) {
      throw new Error(`[${entry}] ${level}: ${log.message}`);
    },
    output: { ...output, comments: false },
  });
  if (result.output.length !== 1) {
    throw new Error(`[${entry}] expected a single chunk`);
  }
  return result.output[0].code;
}

function minifyScript(entry: string, code: string): string {
  const result = minifySync(entry.replace(/\.ts$/, ".js"), code, {
    module: false,
    mangle: { toplevel: false },
  });
  if (result.errors.length > 0) {
    throw new Error(`[${entry}] ${result.errors.map((error) => error.message).join("\n")}`);
  }
  return result.code.trim();
}

/** A prelude helper: `names` become declarations in the template function scope. */
async function prelude(module: string, names: string[]): Promise<string> {
  const code = await bundle(module, names, {}, { format: "esm" });
  const script = code.replace(/^export \{[^}]*\};\s*$/m, "");
  const min = minifyScript(module, script);
  if (min.includes("\n")) {
    throw new Error(`[${module}] a prelude snippet must be a single line:\n${min}`);
  }
  return min.endsWith(";") ? min : min + ";";
}

/** A runtime: the default export of `module`, bound to `name` and called with `args` after the body. */
async function runtime(
  module: string,
  name: string,
  args: string,
  define: Record<string, string> = {},
): Promise<string> {
  const code = await bundle(
    module,
    ["default"],
    { transform: { define } },
    { format: "iife", name, minify: true },
  );
  return `${code.trim()}__sink__=void 0;return ${name}(${args});`;
}

/** The client fallback (`patch.ts`), as a classic `<script>`. */
async function patchScript(): Promise<string> {
  const code = await bundle(
    "patch.ts",
    undefined,
    { transform: { target: "es2017" } },
    { format: "esm" },
  );
  const script = minifyScript("patch.ts", code);
  if (!script.startsWith("window.__renduPatch=")) {
    throw new Error(`[patch.ts] unexpected output:\n${script}`);
  }
  return `<script>${script}</script>`;
}

/** The contents of `src/runtime/_generated.ts`. */
export async function generateRuntime(): Promise<string> {
  const patch = JSON.stringify(await patchScript());
  const deferArgs = "__chunks__,__deferred__,__deferId__";
  const snippets: Record<string, [doc: string, code: string]> = {
    echo: [
      "`echo()` from `prelude.ts` (always inlined)",
      await prelude("prelude.ts", ["__chunks__", "__sink__", "echo"]),
    ],
    htmlspecialchars: [
      "`htmlspecialchars()` from `prelude.ts`",
      await prelude("prelude.ts", ["htmlspecialchars"]),
    ],
    deferStream: [
      "`defer()` from `defer.ts`",
      await prelude("defer.ts", ["__deferred__", "__deferSeq__", "__deferId__", "defer"]),
    ],
    deferText: ["`defer()` from `text.ts`", await prelude("text.ts", ["defer"])],
    stream: ["`stream.ts`", await runtime("stream.ts", "concatStreams", "__chunks__")],
    streamDefer: [
      "`defer.ts` without the client fallback",
      await runtime("defer.ts", "concatStreams", deferArgs, {
        __POLYFILL__: "false",
        __PATCH_SCRIPT__: '""',
      }),
    ],
    streamDeferPolyfill: [
      "`defer.ts` with the client fallback (`patch.ts`)",
      await runtime("defer.ts", "concatStreams", deferArgs, {
        __POLYFILL__: "true",
        __PATCH_SCRIPT__: patch,
      }),
    ],
    text: ["`text.ts`", await runtime("text.ts", "__render__", "__chunks__")],
  };

  let out =
    "// Generated by `pnpm build:runtime` (scripts/build-runtime.ts) from the sources in this\n" +
    "// directory. Do not edit.\n";
  for (const [name, [doc, code]] of Object.entries(snippets)) {
    // Generated code is embedded in `compileTemplateToString()` output, which is documented as
    // embeddable in a `<script>` element.
    if (/<\/script/i.test(code)) {
      throw new Error(`[${name}] generated code must not contain a literal </script>`);
    }
    out += `\n/** ${doc} */\nexport const ${name} = ${JSON.stringify(code)};\n`;
  }
  const formatted = await format(generatedFile, out);
  if (formatted.errors.length > 0) {
    throw new Error(formatted.errors.map((error) => error.message).join("\n"));
  }
  return formatted.code;
}

/** Regenerate `src/runtime/_generated.ts` (also run by the `start` hook in `build.config.mjs`). */
export async function writeRuntime(): Promise<void> {
  await writeFile(generatedFile, await generateRuntime());
}

if (import.meta.main) {
  await writeRuntime();
  console.log(`Generated ${generatedFile}`);
}
