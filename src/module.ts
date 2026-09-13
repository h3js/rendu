import { compileTemplateToString, type CompileTemplateOptions } from "./compiler.ts";
import { parseTemplate } from "./parser.ts";
import { referencesIdentifier } from "./_runtime.ts";
import type { RENDER_CONTEXT_KEYS } from "./render.ts";

export type CompileTemplateToModuleOptions = Omit<
  CompileTemplateOptions,
  "contextKeys" | "filename"
> & {
  /**
   * Additional context keys that the template can access, provided at runtime via the
   * `context` argument of the generated render function.
   *
   * **Note:** Generated modules always use strict mode destructuring (never `with()`), so a
   * `context` value is only accessible when its key is listed here. Render context keys
   * and `providers` keys are provided automatically and ignored here.
   */
  contextKeys?: string[];
  /**
   * Additional (or overridden) context values, imported and created only when the
   * template references them, so unused providers are tree-shaken like built-in helpers.
   *
   * @example
   * ```ts
   * {
   *   // import { serverFetch } from "nitro/app"
   *   serverFetch: { import: { from: "nitro/app" } },
   *   // import { useSession } from "nitro/session"
   *   $SESSION: { import: { from: "nitro/session", name: "useSession" }, value: "useSession(request)" },
   * }
   * ```
   */
  providers?: Record<string, RenderContextProvider>;
  /**
   * Module specifier to import the rendu runtime from.
   *
   * @default "rendu"
   */
  importSource?: string;
  /**
   * Name of the exported render function (`"default"` for a default export).
   *
   * @default "render"
   */
  exportName?: string;
};

/** A context value provider for `compileTemplateToModule`. */
export type RenderContextProvider = {
  /** Named export to import (`name` defaults to the context key). */
  import?: { from: string; name?: string };
  /**
   * JavaScript expression creating the value. It can use the imported name and the
   * `request`, `context` and `$RESPONSE` locals.
   *
   * Defaults to the imported name.
   */
  value?: string;
};

type BuiltinContextKey = Exclude<
  (typeof RENDER_CONTEXT_KEYS)[number],
  "htmlspecialchars" | "$RESPONSE"
>;

/**
 * Built-in render context providers.
 *
 * `htmlspecialchars` is not listed (it is inlined by the compiled template when used) and
 * `$RESPONSE` is always created (it is needed to build the response).
 */
function builtinProviders(from: string): Record<BuiltinContextKey, RenderContextProvider> {
  return {
    $REQUEST: { value: "request" },
    $METHOD: { value: "request?.method" },
    $HEADERS: { value: "request?.headers" },
    $URL: { import: { from, name: "createRenderURL" }, value: "createRenderURL(request)" },
    $COOKIES: {
      import: { from, name: "createRenderCookies" },
      value: "createRenderCookies(request)",
    },
    setCookie: { import: { from, name: "createSetCookie" }, value: "createSetCookie($RESPONSE)" },
    redirect: { import: { from, name: "createRedirect" }, value: "createRedirect($RESPONSE)" },
  };
}

/** Locals of the generated render function that imports cannot shadow. */
const reservedLocals = new Set(["request", "context", "$RESPONSE"]);

const identifierRe = /^[A-Za-z_$][\w$]*$/;

/**
 * Compile a template string into an ES module code string exporting an async
 * `render(request, context)` function that returns a Response.
 *
 * Only the render context helpers and `providers` referenced by the template code are
 * imported, so unused helpers (and their dependencies, such as cookie utils) can be
 * tree-shaken by bundlers.
 *
 * @example
 * ```ts
 * import { compileTemplateToModule } from "rendu";
 *
 * const code = compileTemplateToModule(`<h1>Hello {{ $URL.pathname }}</h1>`);
 * // import { renderContextToResponse as __rendu_render__, ... } from "rendu";
 * // ...
 * // export async function render(request, context) { ... }
 * ```
 */
export function compileTemplateToModule(
  template: string,
  opts: CompileTemplateToModuleOptions = {},
): string {
  const {
    importSource = "rendu",
    exportName = "render",
    providers: customProviders,
    contextKeys: extraKeys = [],
    ...compileOpts
  } = opts;

  if (exportName !== "default" && !identifierRe.test(exportName)) {
    throw new TypeError(`Invalid export name: ${JSON.stringify(exportName)}`);
  }

  const providers: Record<string, RenderContextProvider> = {
    ...builtinProviders(importSource),
    ...customProviders,
  };

  // Only template code can reference context values (text is never evaluated).
  const code = parseTemplate(template)
    .filter((token) => token.type !== "text")
    .map((token) => token.contents)
    .join("\n");

  // Module level imports are aliased (so they neither collide with the host module nor
  // are visible to the template) and re-bound to their name inside the render function.
  const imports = new Map<string, Map<string, string>>(); // from -> name -> alias
  const addImport = (from: string, name: string) => {
    const names = imports.get(from) || new Map<string, string>();
    imports.set(from, names);
    let alias = names.get(name);
    if (!alias) {
      alias = `__rendu_${[...imports.values()].reduce((n, m) => n + m.size, 0)}__`;
      names.set(name, alias);
    }
    return alias;
  };
  const renderAlias = addImport(importSource, "renderContextToResponse");
  const responseAlias = addImport(importSource, "createRenderResponse");

  const bindings = new Map<string, string>(); // local name -> alias
  const values: string[] = [];
  const usedKeys: string[] = [];
  for (const [key, provider] of Object.entries(providers)) {
    if (!referencesIdentifier(code, key)) {
      continue;
    }
    if (!identifierRe.test(key) || reservedLocals.has(key)) {
      throw new TypeError(`Invalid context provider key: ${JSON.stringify(key)}`);
    }
    usedKeys.push(key);
    let value = provider.value;
    if (provider.import) {
      const name = provider.import.name || key;
      if (!identifierRe.test(name) || reservedLocals.has(name)) {
        throw new TypeError(`Invalid import name for context provider ${JSON.stringify(key)}`);
      }
      const alias = addImport(provider.import.from, name);
      if (bindings.has(name) && bindings.get(name) !== alias) {
        throw new TypeError(`Conflicting imports named ${JSON.stringify(name)}`);
      }
      bindings.set(name, alias);
      value ??= name;
    }
    if (!value) {
      throw new TypeError(`Context provider ${JSON.stringify(key)} needs an import or a value`);
    }
    values.push(`${key}: ${value},`);
  }

  if (referencesIdentifier(code, "$RESPONSE")) {
    usedKeys.push("$RESPONSE");
  }

  const ignoredKeys = new Set([...usedKeys, ...Object.keys(providers), "$RESPONSE"]);
  // `htmlspecialchars` is inlined unless explicitly provided.
  if (!providers.htmlspecialchars) {
    ignoredKeys.add("htmlspecialchars");
  }
  const contextKeys = [...new Set([...usedKeys, ...extraKeys.filter((k) => !ignoredKeys.has(k))])];

  const compiled = compileTemplateToString(template, { ...compileOpts, contextKeys });

  const importLines = [...imports].map(
    ([from, names]) =>
      `import { ${[...names].map(([name, alias]) => `${name} as ${alias}`).join(", ")} } from ${JSON.stringify(from)};`,
  );

  const localBindings = [...bindings].map(([name, alias]) => `\n  const ${name} = ${alias};`);

  // Note: imports are hoisted, emitting them last keeps the template code on a constant
  // line offset (template line N is module line N + 1 with `preserveLines`).
  return /* js */ `const __rendu_template__ = ${compiled};
export ${exportName === "default" ? "default async function" : `async function ${exportName}`}(request, context) {${localBindings.join("")}
  const $RESPONSE = ${responseAlias}();
  return ${renderAlias}(__rendu_template__, {
    ...context,
    ${values.join("\n    ")}
    $RESPONSE,
  });
}
${importLines.join("\n")}
`;
}
