import { parseTemplate } from "./parser.ts";
import { runtimeStream, runtimeText } from "./_runtime.ts";

export type CompileTemplateOptions = {
  stream?: boolean;
  filename?: string;
  preserveLines?: boolean;
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
  // as-is, so the generated code has a newline exactly where the template has one and
  // template line N maps to generated line N (+ a constant prelude offset).
  //
  // Code and expression tags that do not already end on a fresh line need a trailing
  // newline: it terminates a trailing `//` line comment and lets ASI terminate the
  // statement (a `;` cannot be used, it would break `<? if (x) ?>` without braces).
  // Such a newline is "borrowed" and paid back by skipping the next newline a text
  // token would have emitted, which keeps the total line count (and the alignment of
  // any code that follows) intact.
  let borrowed = 0;

  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        if (preserveLines) {
          const lines = token.contents.split("\n");
          let code = "";
          for (let i = 0; i < lines.length; i++) {
            const isLast = i === lines.length - 1;
            const chunk = isLast ? lines[i] : lines[i] + "\n";
            if (chunk) {
              code += `echo(${JSON.stringify(chunk)});`;
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
          parts.push(`echo(${JSON.stringify(token.contents)})`);
        }
        break;
      }
      case "expr": {
        if (preserveLines) {
          // A newline before the closing parens is only needed when the expression may
          // end inside a line comment (`//` may also be a false positive from a string
          // literal, which only costs a borrowed line).
          const needsNewline = !endsOnFreshLine(token.contents) && token.contents.includes("//");
          if (needsNewline) {
            borrowed++;
          }
          parts.push(`echo((${token.contents}${needsNewline ? "\n" : ""}));`);
        } else {
          // Wrapped in parens + newlines so trailing line comments and
          // multi-line expressions do not break the generated code.
          parts.push(`echo((\n${token.contents}\n))`);
        }
        break;
      }
      case "code": {
        if (preserveLines && !endsOnFreshLine(token.contents)) {
          borrowed++;
          parts.push(`${token.contents}\n`);
        } else {
          parts.push(token.contents);
        }
        break;
      }
      // No default
    }
  }

  let body: string = parts.join(preserveLines ? "" : "\n");

  // Note: the body is always wrapped in a block so context bindings shadow
  // (instead of colliding with) the runtime prelude declarations.
  body = opts.contextKeys
    ? `{const {${opts.contextKeys.join(",")}}=__context__;${body}}`
    : `with(__context__){${body}}`;

  body = opts.stream === false ? runtimeText(body) : runtimeStream(body, opts);

  return asyncWrapper === false ? body : `(async (__context__) => {${body}})`;
}

/** Whether the code already ends on a fresh line (nothing but whitespace after the last newline). */
function endsOnFreshLine(code: string): boolean {
  return /\n[^\S\n]*$/.test(code);
}
