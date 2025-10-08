import { parseTemplate } from "./parser.ts";
import { runtimeStream, runtimeText } from "./_runtime.ts";

export type CompileTemplateOptions = {
  stream?: boolean;
  filename?: string;
  preserveLines?: boolean;
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
 *   <h1><?= title ?></h1>
 *   <ul>
 *   <? for (const item of items) { ?>
 *     <li><?= item ?></li>
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
    const fn = new AsyncFunction("data", body + sourcemaps);
    return fn as CompiledTemplate<any>;
  } catch (error) {
    throw new SyntaxError(
      `Template syntax error: ${(error as Error).message}`,
      {
        // cause: inner,
      },
    );
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
  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        if (opts.preserveLines) {
          for (const line of token.contents.split("\n")) {
            parts.push(`echo(${JSON.stringify(line + "\n")})\n`);
          }
        } else {
          parts.push(`echo(${JSON.stringify(token.contents)})`);
        }
        break;
      }
      case "expr": {
        parts.push(`echo(${token.contents})`);
        break;
      }
      case "code": {
        parts.push(token.contents);
        break;
      }
      // No default
    }
  }
  const inner = /*js*/ `with(data){${parts.join(opts.preserveLines ? ";" : "\n")}}`;
  const body =
    opts.stream === false ? runtimeText(inner) : runtimeStream(inner);

  return asyncWrapper === false ? body : `(async (data) => {${body}})`;
}
