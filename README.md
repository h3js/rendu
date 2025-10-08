# rendu

🏎️ JavaScript Hypertext Preprocessor.

Rendu is a lightweight toolkit for mixing HTML and JavaScript with a focus on simplicity, standards and progressive rendering.

> [!WARNING]
> This is an experimental PoC.

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
  <h1><?= title ?></h1>
  <ul>
  <? for (const item of items) { ?>
    <li><?= item ?></li>
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

Use `<?= expression ?>` to output values:

```html
<h1><?= title ?></h1>
<div>Page visited: <?= visitedPagesCount ?></div>
```

### Control Structures

Use `<? ... ?>` for JavaScript control flow:

```html
<? if (items.length === 0) { ?>
<p>No items found.</p>
<? } ?> <? for (const item of items) { ?>
<li><?= item.name ?></li>
<? } ?>
```

### Streaming Content

Use `echo()` function for streaming content. Accepts: strings, functions, Promises, Response objects, or ReadableStreams:


**Examples:**
```html
<!-- Simple string output -->
<script server>
  echo("Welcome to our site!");
</script>

<!-- Async content from API (non blocking)-->
<script server>
  echo("Hello");
  echo(async () => fetch("https://api.example.com/data"));
  echo(() => "World");
</script>
```

### Global Variables

Access request context and global state:

- `$REQUEST`: The incoming Request object
- `$METHOD`: HTTP method (GET, POST, etc.)
- `$URL`: Request URL object
- `$HEADERS`: Request headers
- `$COOKIES`: Read-only object containing request cookies
- `$RESPONSE`: Response configuration object

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

## Perior Arts

- [jaubourg/jhp](https://github.com/jaubourg/jhp)
- [atinux/pjs](https://github.com/atinux/pjs)
- [mde/ejs](https://github.com/mde/ejs)

## License

Published under the [MIT](https://github.com/unjs/rendu/blob/main/LICENSE) license.
