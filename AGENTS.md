# Rendu - Agent Guide

JavaScript Hypertext Preprocessor — a lightweight toolkit for mixing HTML and JavaScript with PHP-style template syntax, supporting streaming and progressive rendering.

## Architecture

```
src/
  parser.ts     # Tokenizer: template string → Token[] (text | code | expr)
  compiler.ts   # Token[] → async function body string → AsyncFunction
  _runtime.ts   # Inlined JS runtime: helper prelude, echo/stream/text concatenation
  _defer.ts     # defer() snippets, <template for> patch framing/flush/cancel fragments, client fallback
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

### Runtime (`_runtime.ts`)

Inlined JS code (not imported at runtime).

- **`runtimeHelpers`**: Table of single-line helper snippets (`echo`, `htmlspecialchars`)
- **`runtimePrelude(body, exclude, helpers)`**: Always emits `echo`; other helpers are only emitted when the compiled body references them and they are not in `exclude` (the compiler passes `contextKeys`). The prelude is always one line so `preserveLines` offsets stay constant
- **`defer`** is a mode-specific helper (streaming: queues a `<template for>` patch; text: renders in place), inlined like the others only when referenced. It lives in `_defer.ts` together with the `concatStreams()` fragments (`deferConcatStreams()`) that frame (`deferGuard`: a streaming HTML tokenizer-state tracker that escapes a closing `</template` and closes whatever a patch left open), track emitted markers (`deferScan`, so a nested `defer()` patch waits for the patch that carries its marker), write (`deferEnqueue`: opens a patch lazily on its first content, so a value that fails before any content leaves its placeholder alone), flush (`deferFlush`) and cancel (`deferCancel`) deferred values and the client fallback script. They are only spliced in when `defer` is inlined: a template without `defer()` gets the plain `concatStreams()` (`plainConcatStreams` in `_runtime.ts`) — keep defer-only code out of it
- Generated code carries no comments (they would ship in every compiled template and to the browser): explain it in the TS comment, not inside the snippet

Two variants:

- **`runtimeStream`**: Collects chunks, returns `ReadableStream` with `concatStreams()`, then flushes `defer()`red values out of order as `<template for>` patches (spec transcribed in [`.agents/html-template-for.md`](./.agents/html-template-for.md))
- **`runtimeText`**: Collects chunks, awaits promises, concatenates to string via `__render__()` (`defer()` renders in place, as a function chunk so it matches the streamed output)

Handles: strings, functions, Promises, Response objects, ReadableStreams, Uint8Arrays

`echo()` pushes into `__sink__`: `__chunks__` during the body, cleared (`undefined`) once the body ends. Both runtimes call a function chunk with a fresh sink (`echoCall()`) and write what it echoed synchronously right before its result, so that output lands in place in both modes. Any other late `echo()` (after an `await`, from a timer) throws — never let it append to `__chunks__` or an open patch

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
pnpm play                 # Start playground server
pnpm fmt             # automd + oxlint --fix + oxfmt
```

## Key Dependencies

- **`srvx`** — HTTP server (FastResponse, serve, serveStatic, log)
- **`cookie-es`** — Cookie parsing/serialization
- **`obuild`** — Build tool
- **`vitest`** — Test runner (with **`happy-dom`** for the client-fallback tests)
- **`oxlint` / `oxfmt`** — Linter and formatter
- **`tsgo`** (`@typescript/native-preview`) — Type checking

## Testing

Tests are in `test/` using vitest:

- `test/parser.test.ts` — Tokenizer tests for all syntax variants
- `test/compiler.test.ts` — End-to-end compile + render tests with snapshot comparisons (formatted via `oxfmt`)
- `test/defer.test.ts` — Out-of-order streaming: marker emission, completion-order flushing, text-mode fallback. Ordering tests hold values back with test-controlled gates (`collectWhen()`), not wall-clock thresholds
- `test/polyfill.test.ts` — The client `<template for>` fallback, against a happy-dom document

Snapshots live in `test/snapshots/`.

## References

- [`.agents/html-template-for.md`](./.agents/html-template-for.md) — the `<template for>` /
  processing instruction spec that `defer()` targets, transcribed from
  [whatwg/html#11818](https://github.com/whatwg/html/pull/11818). Read this before touching
  marker emission in `_defer.ts` or the `<?` handling in `parser.ts`.

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
prelude (`src/_runtime.ts`), so they are in scope in every compiled template regardless of
the render context. Do not add them to `RENDER_CONTEXT_KEYS`: the `contextKeys` path
compiles to `const { echo, defer } = __context__`, which shadows the prelude declarations
with `undefined` and fails at render time.
