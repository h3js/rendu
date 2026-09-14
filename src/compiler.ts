import { parseTemplate } from "./parser.ts";
import { runtimeStream, runtimeText } from "./runtime.ts";

export type CompileTemplateOptions = {
  stream?: boolean;
  filename?: string;
  /**
   * Keep template line N on a constant line of the generated code, so stack traces (with
   * `filename`) point at the template line: reported line = template line + 3 for
   * `compileTemplate` (2 lines of `Function` wrapper and the runtime prelude) and + 1 in
   * `compileTemplateToModule` output.
   *
   * **Note:** a code tag that does not end on a fresh line borrows a newline, paid back by the
   * next line break. With several such tags on one line (`<? if (a) { ?>yes<? } ?>`), the code
   * that follows is shifted by the extra tags until as many line breaks have followed.
   */
  preserveLines?: boolean;
  /**
   * Context keys to bind with (strict mode compatible) destructuring instead of `with()`.
   *
   * Keys must be valid binding names (`__echo__` and `__context__` are reserved). `echo` is
   * ignored: the template always uses the runtime `echo()` (with `with()`, a context `echo` only
   * shadows it in template code, like any other name; the compiled output is not affected).
   */
  contextKeys?: string[];
  /**
   * Emit a small client-side fallback for `defer()` patches so they also apply in
   * browsers without native `<template for>` support. Streaming mode only.
   *
   * @default true
   */
  polyfill?: boolean;
};

export type CompiledTemplate<T> = (data: Record<string, any>) => Promise<T>;

/**
 * Compile a template string into a render function.
 *
 * @example
 * ```ts
 * import { compileTemplate } from "rendu";
 *
 * const template = `
 *   <h1>{{ title }}</h1>
 *   <ul>
 *   <? for (const item of items) { ?>
 *     <li>{{ item }}</li>
 *   <? } ?>
 *   </ul>
 * `;
 *
 * const render = compileTemplate(template, { stream: false });
 *
 * const html = await render({ title: "My List", items: ["Item 1", "Item 2", "Item 3"] });
 * console.log(html);
 * // Output:
 * // <h1>My List</h1>
 * // <ul>
 * //   <li>Item 1</li>
 * //   <li>Item 2</li>
 * //   <li>Item 3</li>
 * // </ul>
 * ```
 */
export function compileTemplate<O extends CompileTemplateOptions>(
  template: string,
  opts: O = {} as O,
): CompiledTemplate<O extends { stream: false } ? string : ReadableStream> {
  const body = compileTemplateToString(template, opts, false);
  const sourcemaps = opts.filename ? `\n//# sourceURL=${opts.filename}` : "";
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const fn = new AsyncFunction("__context__", body + sourcemaps);
    return fn as CompiledTemplate<any>;
  } catch (error) {
    throw new SyntaxError(`Template syntax error: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

/**
 * Compile a template string into a render function code string.
 *
 * **Note:** This function is for advanced use cases where you need the generated code as a string.
 */
export function compileTemplateToString(
  template: string,
  opts: CompileTemplateOptions,
  asyncWrapper?: boolean,
): string {
  const parts: string[] = [];
  const tokens = parseTemplate(template);
  const preserveLines = !!opts.preserveLines;

  // In `preserveLines` mode every part is self-terminated and parts are concatenated
  // as-is, so the generated code has a line break exactly where the template has one and
  // template line N maps to generated line N (+ a constant prelude offset).
  //
  // Code and expression tags that do not already end on a fresh line need a trailing
  // newline: it terminates a trailing `//` line comment and lets ASI terminate the
  // statement (a `;` cannot be used, it would break `<? if (x) ?>` without braces).
  // Such a newline is "borrowed" and paid back by skipping the next line break a text
  // token would have emitted, or a line break in the leading whitespace of the next tag
  // (the borrowed newline already separates it from the code before), which keeps the
  // alignment of any code that follows intact. Several such tags on one line borrow several
  // newlines, so code stays shifted until as many line breaks have followed.
  let borrowed = 0;
  const repayLeadingLineBreaks = (contents: string) =>
    borrowed > 0
      ? contents.replace(/^\s+/, (whitespace) =>
          whitespace.replace(lineBreakRe, (lineBreak) => {
            if (borrowed > 0) {
              borrowed--;
              return "";
            }
            return lineBreak;
          }),
        )
      : contents;

  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        if (preserveLines) {
          // [line, line break, line, ..., line] (U+2028 / U+2029 are escaped, not line breaks)
          const lines = token.contents.split(/(\r\n?|\n)/);
          let code = "";
          for (let i = 0; i < lines.length; i += 2) {
            const isLast = i === lines.length - 1;
            const chunk = isLast ? lines[i] : lines[i]! + lines[i + 1];
            if (chunk) {
              code += `__echo__(${toJSString(chunk)});`;
            }
            if (!isLast) {
              if (borrowed > 0) {
                borrowed--;
              } else {
                code += "\n";
              }
            }
          }
          parts.push(code);
        } else {
          parts.push(`__echo__(${toJSString(token.contents)});`);
        }
        break;
      }
      case "expr": {
        if (preserveLines) {
          const contents = repayLeadingLineBreaks(token.contents);
          // A newline before the closing parens is only needed when the expression may
          // end inside a line comment (`//` may also be a false positive from a string
          // literal, which only costs a borrowed line).
          const needsNewline = !endsOnFreshLine(contents) && contents.includes("//");
          if (needsNewline) {
            borrowed++;
          }
          parts.push(`__echo__((${contents}${needsNewline ? "\n" : ""}));`);
        } else {
          // Wrapped in parens + newlines so trailing line comments and
          // multi-line expressions do not break the generated code.
          parts.push(`__echo__((\n${token.contents}\n));`);
        }
        break;
      }
      case "code": {
        if (!preserveLines) {
          // Trailing newline terminates a trailing `//` line comment.
          parts.push(`${token.contents}\n`);
        } else if (endsOnFreshLine(token.contents)) {
          parts.push(repayLeadingLineBreaks(token.contents));
        } else {
          const contents = repayLeadingLineBreaks(token.contents);
          borrowed++;
          parts.push(`${contents}\n`);
        }
        break;
      }
      // No default
    }
  }

  let body: string = parts.join(preserveLines ? "" : "\n");

  const contextKeys = opts.contextKeys && validateContextKeys(opts.contextKeys);

  // Note: the body is always wrapped in a block so context bindings shadow
  // (instead of colliding with) the runtime prelude declarations. With `contextKeys`, the
  // body gets its own nested block so template declarations shadow the context bindings.
  body = contextKeys
    ? `{const {${contextKeys.join(",")}}=__context__;{${body}}}`
    : `with(__context__){${body}}`;

  // Runtime helpers are only inlined when the body references them. Helpers that are
  // explicitly provided by the context (`contextKeys`) are never inlined.
  body =
    opts.stream === false ? runtimeText(body, contextKeys) : runtimeStream(body, contextKeys, opts);

  return asyncWrapper === false ? body : `(async (__context__) => {${body}})`;
}

/** JS line breaks (`\r\n`, `\n`, `\r`, U+2028, U+2029). */
const lineBreakRe = /\r\n?|[\n\u2028\u2029]/g;

/** Whether the code already ends on a fresh line (nothing but whitespace after the last line break). */
function endsOnFreshLine(code: string): boolean {
  return /[\n\r\u2028\u2029]\s*$/.test(code);
}

/** A JS string literal. U+2028 / U+2029 are escaped: they would be line breaks in the generated code. */
function toJSString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16)}`,
  );
}

const identifierRe = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u;

/** Whether `name` is an identifier (reserved words included). */
export const isIdentifier = (name: string): boolean => identifierRe.test(name);

/** Reserved words that cannot be used as binding names in (strict mode) module code. */
const reservedWords = new Set(
  "arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(
    " ",
  ),
);

/** Whether `name` can be used as a binding name (in strict mode code too). */
export const isBindingName = (name: string): boolean =>
  identifierRe.test(name) && !reservedWords.has(name);

/** Names of the compiled template that context keys cannot bind (see `compileTemplateToString`). */
export const reservedContextKeys: ReadonlySet<string> = new Set(["__echo__", "__context__"]);

/**
 * Validate and dedupe `contextKeys` (they are emitted as a destructuring pattern). `echo` is
 * dropped: the template always uses the runtime `echo()`.
 */
function validateContextKeys(keys: string[]): string[] {
  for (const key of keys) {
    if (!isBindingName(key) || reservedContextKeys.has(key)) {
      throw new TypeError(`Invalid context key: ${JSON.stringify(key)}`);
    }
  }
  return [...new Set(keys)].filter((key) => key !== "echo");
}
