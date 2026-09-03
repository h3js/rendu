# rendu

🏎️ JavaScript Hypertext Preprocessor.

Rendu is a lightweight toolkit for mixing HTML and JavaScript with a focus on simplicity, standards and progressive rendering.

> [!NOTE]
> See [playground](./playground/) ([online playground](https://stackblitz.com/github/h3js/rendu/tree/main/playground?file=index.html)) for demos and [syntax](#syntax) section for usage.

## CLI

Using the `rendu` CLI, you can start a local web server to serve static files and render `.html` files as templates (powered by [srvx](https://srvx.h3.dev)).

```sh
npx rendu
```

## Programmatic API

<!-- automd:jsdocs src="./src/index.ts" -->

### `compileTemplate(template, opts)`

Compile a template string into a render function.

**Example:**

```ts
import { compileTemplate } from "rendu";

const template = `
  <h1>{{ title }}</h1>
  <ul>
  <? for (const item of items) { ?>
    <li>{{ item }}</li>
  <? } ?>
  </ul>
`;

const render = compileTemplate(template, { stream: false });

const html = await render({ title: "My List", items: ["Item 1", "Item 2", "Item 3"] });
console.log(html);
// Output:
// <h1>My List</h1>
// <ul>
//   <li>Item 1</li>
//   <li>Item 2</li>
//   <li>Item 3</li>
// </ul>
```

### `compileTemplateToString(template, opts, asyncWrapper?)`

Compile a template string into a render function code string.

**Note:** This function is for advanced use cases where you need the generated code as a string.

### `createRenderContext(options)`

### `hasTemplateSyntax(template)`

Check if a template string contains template syntax.

### `parseTemplate(template)`

Parse a template string into `text`, `code` and `expr` tokens.

### `RENDER_CONTEXT_KEYS`

- **Type**: `array`
- **Default**: `["htmlspecialchars","setCookie","redirect","$REQUEST","$METHOD","$URL","$HEADERS","$COOKIES","$RESPONSE"]`

### `renderToResponse(htmlTemplate, opts)`

Renders an HTML template to a Response object.

**Example:**

```ts
import { compileTemplate, renderToResponse } from "rendu";

const render = compileTemplate(template, { stream: true });

const response = await renderToResponse(render, { request });
```

<!-- /automd -->

## Syntax

Rendu uses PHP-style tags to embed JavaScript within HTML templates:

### Server Scripts

Use `<script server>` to execute JavaScript on the server where it appears:

```html
<script server>
  globalThis.visitedPagesCount ??= 0;
  globalThis.visitedPagesCount++;
</script>
```

### Output Expressions

Use `{{ expression }}` for HTML-escaped output, or `{{{ expression }}}` or `<?= expression ?>` for unescaped (raw) output:

```html
<h1><?= title ?></h1>
<div>Page visited: {{ visitedPagesCount }}</div>
```

### Control Structures

Use `<? ... ?>` for JavaScript control flow:

```html
<? if (items.length === 0) { ?>
<p>No items found.</p>
<? } ?> <? for (const item of items) { ?>
<li>{{ item.name }}</li>
<? } ?>
```

### Streaming Content

Use the `echo()` function for streaming content. Accepts: strings, functions, Promises, Response objects, or ReadableStreams:

**Examples:**

```html
<!-- Simple string output -->
<script server>
  echo("Welcome to our site!");
</script>

<!-- Async content from API (non-blocking)-->
<script server>
  echo("Hello");
  echo(async () => fetch("https://api.example.com/data"));
  echo(() => "World");
</script>
```

### Deferred (Out-of-Order) Streaming

`echo()` streams strictly in source order, so one slow value holds up everything after it. Use `defer()` to stream that value **out of order**: a marker is written in place immediately, the rest of the document keeps streaming, and the content is patched in when it resolves.

```html
<script server>
  const skeleton = '<ul class="skeleton"><li></li><li></li></ul>';
</script>

<aside><?= defer(getRecommendations(), skeleton) ?></aside>
```

`defer(value, placeholder?)` accepts the same values as `echo()` (strings, functions, Promises, `Response` objects, `ReadableStream`s). A function is called immediately, so its work starts as soon as `defer()` is reached rather than when the patch is flushed. The optional `placeholder` is shown until the value arrives; any falsy placeholder means "no placeholder".

Use `<?= ?>` (or `echo()`), not `{{ }}` — `defer()` returns raw marker markup, which `{{ }}` would escape into visible text.

> [!WARNING]
> Both the value and the `placeholder` are **raw, unescaped HTML**, exactly like `{{{ }}}`. Run anything request-derived through `htmlspecialchars()` first — `defer(search(q), '<p>Searching for ' + htmlspecialchars(q) + '…</p>')`. The placeholder must also be balanced markup: an unclosed tag makes the browser nest the range's end marker inside it, and the patch is then dropped.

Deferred values are flushed in **completion order**, not source order, so a fast panel is never held up by a slow one. On the wire (marker names carry a per-render prefix so two renders composed into one document cannot patch each other):

```html
<aside>
  <?start name="dk3p9x_0">
  <ul class="skeleton">
    …
  </ul>
  <?end>
</aside>
… rest of the document, streamed immediately …
<template for="dk3p9x_0"
  ><ul>
    …the real content…
  </ul></template
>
```

This is the standard [`<template for>`](https://github.com/whatwg/html/pull/11818) mechanism: the browser replaces the marked region as the patch arrives, with no client-side framework involved. A small (~1KB) inline script is emitted once as a fallback for browsers without native support.

> [!IMPORTANT]
> No browser ships `<template for>` on by default yet (Chrome has it behind _Experimental Web Platform Features_; Gecko and WebKit are still open). The inline fallback is therefore what actually applies the patches today, so `compileTemplate(html, { polyfill: false })` means deferred content **never appears at all** — not "appears late". The same is true with JavaScript disabled, or for crawlers that do not execute scripts: they see the placeholder and the real content stays inside an inert `<template>`. Under a `script-src` policy that forbids inline scripts, prefer relaxing the policy for these scripts over turning the fallback off.

Failure is per-panel, not per-page. If a deferred value rejects, its patch is skipped, the error is logged server-side, the placeholder stays in place, and the rest of the document — including every other panel — keeps streaming. That matches `<template for>`, where a failed patch is silent by design; there is no status code left to fail with once the head and shell are on the wire.

For the same reason, `setCookie()` and `redirect()` throw if they are called from inside a deferred value: the response head has already been sent.

Two limitations worth knowing:

- A deferred value must not contain an unbalanced `</template>`; rendu escapes those so a value cannot break out of its own patch, which means a **nested `<template>` element inside a deferred value is not supported**.
- Do not embed one `defer()`'s return value inside another `defer()`'s value. The inner marker only reaches the document when the outer patch is applied, by which time the inner patch has already gone out; rendu logs an error when it detects this. Call `defer()` from _inside_ the deferred value instead.

In non-streaming mode (`{ stream: false }`) there is no stream to reorder, so `defer()` renders the value in place and the placeholder is dropped.

### Global Variables

Access request context and global state:

- `$REQUEST`: The incoming Request object
- `$METHOD`: HTTP method (GET, POST, etc.)
- `$URL`: Request URL object
- `$HEADERS`: Request headers
- `$RESPONSE`: Response configuration object
- `$COOKIES`: Read-only object containing request cookies

### Cookie Management

Use `setCookie()` function to set cookies in the response:

```html
<script server>
  setCookie("user", "RenduUser");
  setCookie("session", "abc123", { maxAge: 3600, httpOnly: true });
</script>
```

Access cookies from the request using `$COOKIES`:

```html
<div>Welcome, <?= $COOKIES["user"] || "Guest" ?>!</div>
```

### Response Control

Use `redirect()` function to redirect the user:

```html
<script server>
  if (!$COOKIES["auth"]) {
    redirect("/login");
  }
</script>
```

### HTML Escaping

The `htmlspecialchars()` function is available for escaping HTML content:

> [!TIP]
> When using curly `{{ }}` syntax, `htmlspecialchars` will be automatically applied.

```html
<div><?= htmlspecialchars(userInput) ?></div>
```

## Development

<details>

<summary>local development</summary>

- Clone this repository
- Install the latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

</details>

## Prior Art

- [jaubourg/jhp](https://github.com/jaubourg/jhp)
- [atinux/pjs](https://github.com/atinux/pjs)
- [mde/ejs](https://github.com/mde/ejs)

## License

Published under the [MIT](https://github.com/unjs/rendu/blob/main/LICENSE) license.
