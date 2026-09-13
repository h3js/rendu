/**
 * Prelude helpers, inlined before the compiled template body. Each export is a declaration in
 * the template function scope; the generator builds one single-line snippet per helper.
 */

/**
 * `echo()`, always inlined.
 *
 * `echo` pushes into `__sink__`, the chunk list that owns the output at the current point
 * of the render. During the body that is `__chunks__`, the main chunk list. The generated code clears
 * `__sink__` when the body ends and only sets it (to a fresh list) for the synchronous call of a
 * function chunk, so echoed chunks are written in place, right before that function's result
 * (`callEchoed()` in `_shared.ts`). Any other call (after an `await`, from a timer) can no longer
 * be tied to a position in the output, so it throws instead of landing wherever the output
 * happens to be. (Without AsyncContext, a call from another async function while the body itself
 * is suspended in an `await` cannot be told apart from the body's own calls, so it is written at
 * the body's current position.)
 */

const __chunks__: unknown[] = [];

let __sink__: unknown[] | undefined = __chunks__;

const echo = (chunk: unknown): void => {
  if (!__sink__) {
    throw new Error(
      "echo() was called after the template body finished rendering. echo() must be called synchronously; after an await, return the content from the (deferred) value instead.",
    );
  }
  __sink__.push(chunk);
};

export { __chunks__, __sink__, echo };

/**
 * `htmlspecialchars()`, inlined when the body references it.
 *
 * Declared as a function declaration (function scoped) so a `const { htmlspecialchars } =
 * __context__` inside the (block scoped) body shadows it instead of colliding with it.
 */

const __htmlEscapes__: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function htmlspecialchars(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => __htmlEscapes__[c] || c);
}

export { htmlspecialchars };
