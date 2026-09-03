# Rendu - Agent Guide

JavaScript Hypertext Preprocessor — a lightweight toolkit for mixing HTML and JavaScript with PHP-style template syntax, supporting streaming and progressive rendering.

## Architecture

```
src/
  parser.ts     # Tokenizer: template string → Token[] (text | code | expr)
  compiler.ts   # Token[] → async function body string → AsyncFunction
  _runtime.ts   # Inlined JS runtime for echo/stream/text concatenation
  render.ts     # Request/response layer: cookies, headers, redirects, HTML escaping
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

Inlined JS code (not imported at runtime). Two variants:

- **`runtimeStream`**: Collects chunks, returns `ReadableStream` with `concatStreams()`, then flushes `defer()`red values out of order as `<template for>` patches (spec transcribed in [`.agents/html-template-for.md`](./.agents/html-template-for.md))
- **`runtimeText`**: Collects chunks, awaits promises, concatenates to string (`defer()` renders in place)

Handles: strings, functions, Promises, Response objects, ReadableStreams, Uint8Arrays

### Render (`render.ts`)

- `createRenderContext()`: Builds context with `$REQUEST`, `$URL`, `$COOKIES` (lazy-parsed via Proxy), `setCookie`, `redirect`, `htmlspecialchars`
- `renderToResponse()`: Executes compiled template with context, returns `FastResponse`

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
- **`vitest`** — Test runner
- **`oxlint` / `oxfmt`** — Linter and formatter
- **`tsgo`** (`@typescript/native-preview`) — Type checking

## Testing

Tests are in `test/` using vitest:

- `test/parser.test.ts` — Tokenizer tests for all syntax variants
- `test/compiler.test.ts` — End-to-end compile + render tests with snapshot comparisons (formatted via `oxfmt`)
- `test/defer.test.ts` — Out-of-order streaming: marker emission, completion-order flushing, text-mode fallback
- `test/polyfill.test.ts` — The client `<template for>` fallback, against a happy-dom document

Snapshots live in `test/snapshots/`.

## References

- [`.agents/html-template-for.md`](./.agents/html-template-for.md) — the `<template for>` /
  processing instruction spec that `defer()` targets, transcribed from
  [whatwg/html#11818](https://github.com/whatwg/html/pull/11818). Read this before touching
  marker emission in `_runtime.ts` or the `<?` handling in `parser.ts`.

## Template Syntax Reference

| Syntax                        | Purpose                  |
| ----------------------------- | ------------------------ |
| `<? code ?>` / `<?js code ?>` | JavaScript control flow  |
| `<?= expr ?>`                 | Raw output expression    |
| `{{ expr }}`                  | HTML-escaped output      |
| `{{{ expr }}}`                | Raw (unescaped) output   |
| `<script server>...</script>` | Server-side script block |

## Context Variables

`$REQUEST`, `$METHOD`, `$URL`, `$HEADERS`, `$COOKIES`, `$RESPONSE`, `htmlspecialchars()`, `setCookie()`, `redirect()`, `echo()`, `defer()`
