# Rendu - Agent Guide

JavaScript Hypertext Preprocessor — a lightweight toolkit for mixing HTML and JavaScript with PHP-style template syntax, supporting streaming and progressive rendering.

## Architecture

```
src/
  parser.ts     # Tokenizer: template string → Token[] (text | code | expr)
  compiler.ts   # Token[] → async function body string → AsyncFunction
  runtime.ts    # Composes the inlined runtime: helper prelude + body + output runtime
  runtime/      # Typed sources of the inlined runtime (see "Runtime" below)
    _generated.ts  # Minified snippets built from runtime/*.ts by `pnpm build:runtime` (checked in)
  render.ts     # Request/response layer: cookies, headers, redirects, HTML escaping
  module.ts     # compileTemplateToModule(): ESM codegen importing only used context helpers
  cli.ts        # CLI entry: serves static files with srvx, renders .html as templates
  index.ts      # Public API re-exports
```

**Data flow:** Template string → `parseTemplate()` → tokens → `compileTemplateToString()` → JS code string → `new AsyncFunction()` → render function

### Parser (`parser.ts`)

Converts template syntax to normalized `<?...?>` tags, then tokenizes:

1. `<script server>...</script>` → `<?js...?>`
2. `{{{ expr }}}` → `<?=expr?>` (raw) / `{{ expr }}` → `<?=htmlspecialchars(expr)?>` (escaped)
3. Regex-based tokenizer extracts `text`, `code`, and `expr` tokens

### Compiler (`compiler.ts`)

- Generates `echo()` calls for text/expr tokens, raw code for code tokens
- Two modes: `stream: true` (returns `ReadableStream`) / `stream: false` (returns `string`)
- `contextKeys` option uses destructuring instead of `with()` for strict mode compatibility
- `transformImports()` rewrites static `import` declarations in code tokens (line start or after `;`, lexical regex) to `const { ... } = await import(...)`, keeping line breaks for `preserveLines`. `import()` in `new Function` code fails under vitest (no vm import callback): test compiled output as a data-URL module

### Runtime (`runtime.ts`, `runtime/`)

The runtime is inlined into every compiled template (not imported). Its source is typed TS in
`src/runtime/`; `scripts/build-runtime.ts` (rolldown) bundles and minifies it into
`src/runtime/_generated.ts`, which is checked in. **After changing a runtime source, run
`pnpm build:runtime`** (`test/generated.test.ts` fails while the output is stale). Never edit
`_generated.ts` by hand. Generated code carries no comments: document the sources instead.

Seven files, grouped by what they inline. The generator builds each snippet from a virtual entry that re-exports only the names it needs, so one module can hold several snippets (tree-shaking keeps them apart; `test/generated.test.ts` checks for leaks). Keep module-level code side-effect free — anything a snippet does not reference but rolldown cannot prove pure ends up in it:

| File            | Snippets                                                                                                                                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prelude.ts`    | `echo()` (+ `__chunks__`, `__sink__`), `htmlspecialchars()`                                                                                                                                                                                                                                                                        |
| `stream.ts`     | `concatStreams()` for a template without `defer()`                                                                                                                                                                                                                                                                                 |
| `defer.ts`      | streaming `defer()` (+ `__deferred__`, `__deferId__`) and `concatStreams()` that flushes it: patch framing (`createPatchGuard()`, a streaming HTML tokenizer-state tracker), marker tracking (`createMarkerScan()`, so a nested `defer()` patch waits for the patch that carries its marker), lazy patch opening, flush and cancel |
| `text.ts`       | `__render__()` and the text `defer()`                                                                                                                                                                                                                                                                                              |
| `_shared.ts`    | `callEchoed()`, `createWrite()` (imported, not a snippet)                                                                                                                                                                                                                                                                          |
| `patch.ts`      | the client fallback (browser code)                                                                                                                                                                                                                                                                                                 |
| `_generated.ts` | the output                                                                                                                                                                                                                                                                                                                         |

- **Prelude helpers** (`echo`, `htmlspecialchars`, `defer`): declarations in the template function scope, minified as a script (top-level names kept). Each is one line: the prelude always spans exactly one line so `preserveLines` offsets stay constant
- **`runtimePrelude(body, exclude, helpers)`**: Always emits `echo`; other helpers are only emitted when the compiled body references them and they are not in `exclude` (the compiler passes `contextKeys`)
- **Output runtimes** (default exports of `stream.ts`, `defer.ts`, `text.ts`): bundled as an IIFE bound to `concatStreams` / `__render__`; the generated code then clears `__sink__` and calls it with `__chunks__`, so everything else is private and mangled
- **`defer`** is mode-specific (streaming: queues a `<template for>` patch; text: a marker replaced in place), inlined only when referenced. Only then does the stream use `defer.ts`'s runtime; a template without `defer()` gets the plain `stream.ts` — keep defer-only code out of it
- **Client fallback** (`patch.ts`): minified into a `<script>` string and injected into `defer.ts` as `__PATCH_SCRIPT__`. The defer runtime is built twice, with `__POLYFILL__` on and off (the `polyfill` compile option picks one)

Two variants:

- **Streaming** (`runtimeStream`): Collects chunks, returns `ReadableStream` with `concatStreams()`, then flushes `defer()`red values out of order as `<template for>` patches (spec transcribed in [`.agents/html-template-for.md`](./.agents/html-template-for.md))
- **Text** (`runtimeText`): Collects chunks, awaits promises, concatenates to string via `__render__()` (`defer()` returns a marker, as in streaming mode, which the `textDefer` runtime replaces with the rendered value)

Handles: strings, functions, Promises, Response objects, ReadableStreams, Uint8Arrays

`echo()` pushes into `__sink__`: `__chunks__` during the body, cleared (`undefined`) once the body ends. Both runtimes call a function chunk with a fresh sink (`callEchoed()`) and write what it echoed synchronously right before its result, so that output lands in place in both modes. Any other late `echo()` (after an `await`, from a timer) throws — never let it append to `__chunks__` or an open patch

### Render (`render.ts`)

- `createRenderContext()`: Builds context with `$REQUEST`, `$URL`, `$COOKIES` (lazy-parsed via Proxy), `setCookie`, `redirect`, `htmlspecialchars`
- `renderToResponse()`: Executes compiled template with context, returns `FastResponse`
- `renderContextToResponse()` + `createRenderResponse/createRenderURL/createRenderCookies/createSetCookie/createRedirect`: individually importable pieces so unused helpers (e.g. `cookie-es`) tree-shake

### Module (`module.ts`)

`compileTemplateToModule()` generates an ES module (build-time, e.g. Nitro) exporting `async render(request, context)`. Built-in context helpers and custom `providers` (`{ import: { from, name }, value }`) are only imported/created when template code (not text) references them. Imports are aliased (`__rendu_N__`), emitted last (constant `preserveLines` offset) and re-bound inside the render function. Generated modules always use `contextKeys` destructuring.

### CLI (`cli.ts`)

Starts srvx dev server with `serveStatic` middleware that intercepts `.html` files, compiles them as templates, and renders with request context + `$GLOBALS`.

## Commands

```bash
pnpm install              # Install deps
pnpm dev                  # Interactive test runner (vitest dev)
pnpm vitest run <path>    # Run specific test file
pnpm test                 # Full: lint + type-check + tests with coverage
pnpm build                # Build with obuild (outputs to dist/)
pnpm build:runtime        # Regenerate src/runtime/_generated.ts from src/runtime/*.ts
pnpm play                 # Start playground server
pnpm fmt             # automd + oxlint --fix + oxfmt
```

## Key Dependencies

- **`srvx`** — HTTP server (FastResponse, serve, serveStatic, log)
- **`cookie-es`** — Cookie parsing/serialization
- **`obuild`** — Build tool
- **`rolldown`** — Bundles and minifies the inlined runtime (`scripts/build-runtime.ts`)
- **`vitest`** — Test runner (with **`happy-dom`** for the client-fallback tests)
- **`oxlint` / `oxfmt`** — Linter and formatter
- **`tsgo`** (`@typescript/native-preview`) — Type checking

## Testing

Tests are in `test/` using vitest:

- `test/parser.test.ts` — Tokenizer tests for all syntax variants
- `test/compiler.test.ts` — End-to-end compile + render tests with snapshot comparisons (formatted via `oxfmt`)
- `test/defer.test.ts` — Out-of-order streaming: marker emission, completion-order flushing, text-mode fallback. Ordering tests hold values back with test-controlled gates (`collectWhen()`), not wall-clock thresholds
- `test/polyfill.test.ts` — The client `<template for>` fallback, against a happy-dom document
- `test/generated.test.ts` — `src/runtime/_generated.ts` is up to date with its sources

Snapshots live in `test/snapshots/`.

## References

- [`.agents/html-template-for.md`](./.agents/html-template-for.md) — the `<template for>` /
  processing instruction spec that `defer()` targets, transcribed from
  [whatwg/html#11818](https://github.com/whatwg/html/pull/11818). Read this before touching
  marker emission in `src/runtime/` or the `<?` handling in `parser.ts`.

## Template Syntax Reference

| Syntax                        | Purpose                  |
| ----------------------------- | ------------------------ |
| `<? code ?>` / `<?js code ?>` | JavaScript control flow  |
| `<?= expr ?>`                 | Raw output expression    |
| `{{ expr }}`                  | HTML-escaped output      |
| `{{{ expr }}}`                | Raw (unescaped) output   |
| `<script server>...</script>` | Server-side script block |

## Context Variables

`$REQUEST`, `$METHOD`, `$URL`, `$HEADERS`, `$COOKIES`, `$RESPONSE`, `htmlspecialchars()`, `setCookie()`, `redirect()`

## Runtime Helpers

`echo()` and `defer()` are **not** context variables — they are declarations in the inlined
prelude (`src/runtime/`), so they are in scope in every compiled template regardless of
the render context. Do not add them to `RENDER_CONTEXT_KEYS`: the `contextKeys` path
compiles to `const { defer } = __context__`, which shadows the prelude declaration
with `undefined` and fails at render time. The compiled output is written with `__echo__`
(`echo` is an alias), so a context `echo` never breaks it; `echo` is dropped from `contextKeys`
and `__echo__` / `__context__` are rejected as `contextKeys` and provider keys (reserved names; do not pass them in a `with()` context either).
