import { parse as parseCookies, serialize as serializeCookie } from "cookie-es";
import type { CookieSerializeOptions } from "cookie-es";
import type { CompiledTemplate } from "./compiler.ts";
import { FastResponse } from "srvx";

export interface RenderOptions {
  request?: Request;
  context?: Record<string, unknown>;
}

/** Prepared responses whose head has already been handed to the server. */
const committed = new WeakSet<object>();

/**
 * Renders an HTML template to a Response object.
 *
 * @example
 * ```ts
 * import { compileTemplate, renderToResponse } from "rendu";
 *
 * const render = compileTemplate(template, { stream: true });
 *
 * const response = await renderToResponse(render, { request });
 * ```
 * @param htmlTemplate The compiled HTML template.
 * @param opts Options for rendering.
 * @returns A Response object.
 */
export async function renderToResponse(
  htmlTemplate: CompiledTemplate<any>,
  opts: RenderOptions,
): Promise<Response> {
  return renderContextToResponse(htmlTemplate, createRenderContext(opts));
}

/**
 * Renders an HTML template with a prepared context (that must contain `$RESPONSE`) to a
 * Response object.
 *
 * Unlike `renderToResponse`, it does not create the render context, so only the context
 * helpers that are actually imported end up in the bundle (see `compileTemplateToModule`).
 */
export async function renderContextToResponse(
  htmlTemplate: CompiledTemplate<any>,
  ctx: RenderContextInput,
): Promise<Response> {
  const body = await htmlTemplate(ctx);
  if (body instanceof Response) {
    return body;
  }
  const response = new FastResponse(body, {
    status: ctx.$RESPONSE.status,
    statusText: ctx.$RESPONSE.statusText,
    headers: ctx.$RESPONSE.headers,
  });
  // The head is on the wire from here on, so `setCookie()` / `redirect()` can no longer
  // take effect. In stream mode, echoed functions, promises, streams and deferred values still
  // run request work after this point, so say so loudly instead of mutating an already-serialized
  // Headers object. (Holding the head back until they settle would delay the first byte of every
  // stream.)
  committed.add(ctx.$RESPONSE);
  return response;
}

/** A prepared render context, as accepted by `renderContextToResponse`. */
export type RenderContextInput = { $RESPONSE: RenderResponse } & Record<string, unknown>;

export type RenderResponse = {
  status: number;
  statusText: string;
  headers: Headers;
};

export type RenderContext = {
  htmlspecialchars: (s: string) => string;
  setCookie: (name: string, value: string, options?: CookieSerializeOptions) => void;
  redirect: (url: string, status?: number) => void;
  $REQUEST?: Request;
  $METHOD?: string;
  $URL?: URL;
  $HEADERS?: Headers;
  $COOKIES: Readonly<Record<string, string>>;
  $RESPONSE: RenderResponse;
};

export const RENDER_CONTEXT_KEYS = [
  "htmlspecialchars",
  "setCookie",
  "redirect",
  "$REQUEST",
  "$METHOD",
  "$URL",
  "$HEADERS",
  "$COOKIES",
  "$RESPONSE",
] as const;

export function createRenderContext(options: RenderOptions): RenderContext {
  const response = createRenderResponse();
  return {
    ...options.context,
    htmlspecialchars,
    setCookie: createSetCookie(response),
    redirect: createRedirect(response),
    $REQUEST: options.request,
    $METHOD: options.request?.method,
    $URL: createRenderURL(options.request),
    $HEADERS: options.request?.headers,
    $COOKIES: createRenderCookies(options.request),
    $RESPONSE: response,
  };
}

/**
 * Create the prepared response state (`$RESPONSE`).
 *
 * **Note:** Low-level building block for generated code (see `compileTemplateToModule`).
 */
export function createRenderResponse(): RenderResponse {
  return {
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
  };
}

/**
 * Create the `$URL` context value.
 *
 * **Note:** Low-level building block for generated code (see `compileTemplateToModule`).
 */
export function createRenderURL(request: Request | undefined): URL {
  return new URL(request?.url || "http://_");
}

/**
 * Create the `setCookie()` context helper.
 *
 * **Note:** Low-level building block for generated code (see `compileTemplateToModule`).
 */
export function createSetCookie(response: RenderResponse): RenderContext["setCookie"] {
  return (name, value, options = {}) => {
    assertOpen(response, "setCookie");
    response.headers.append("Set-Cookie", serializeCookie(name, value, options));
  };
}

/**
 * Create the `redirect()` context helper.
 *
 * **Note:** Low-level building block for generated code (see `compileTemplateToModule`).
 */
export function createRedirect(response: RenderResponse): RenderContext["redirect"] {
  return (to, status = 302) => {
    assertOpen(response, "redirect");
    response.status = status;
    response.headers.set("Location", to);
  };
}

function assertOpen(response: RenderResponse, what: string): void {
  if (committed.has(response)) {
    throw new Error(
      `${what}() was called after the response head was sent. When streaming, the status and ` +
        `headers are sent once the template code has run, before echoed functions, promises, ` +
        `streams and deferred values are written: \`await\` the value in template code first ` +
        `(\`<? const value = await ... ?>\`) and call ${what}() there.`,
    );
  }
}

/**
 * Create the `$COOKIES` context value: a lazily parsed, read-only view of the request cookies.
 *
 * **Note:** Low-level building block for generated code (see `compileTemplateToModule`).
 *
 * The cookie header is only parsed on first access. All traps are backed by the parsed
 * map so `get`, `in`, `Object.keys()`, spread and `JSON.stringify()` are consistent.
 */
export function createRenderCookies(req: Request | undefined): Readonly<Record<string, string>> {
  let parsed: Record<string, string> | undefined;
  const cookies = (): Record<string, string> => {
    parsed ??= req ? (parseCookies(req.headers.get("cookie") || "") as Record<string, string>) : {};
    return parsed;
  };
  // Note: the target is an empty, extensible null-prototype object so that the traps
  // below are free to report whatever the parsed cookies contain.
  return new Proxy(Object.create(null) as Record<string, string>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const all = cookies();
      return Object.hasOwn(all, prop) ? all[prop] : undefined;
    },
    has(_target, prop) {
      return typeof prop === "string" && Object.hasOwn(cookies(), prop);
    },
    ownKeys() {
      return Object.keys(cookies());
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const all = cookies();
      if (!Object.hasOwn(all, prop)) return undefined;
      return { value: all[prop], enumerable: true, configurable: true, writable: false };
    },
  });
}

function htmlspecialchars(s: string): string {
  // oxfmt-ignore
  const htmlSpecialCharsMap: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s).replace(/[&<>"']/g, (c) => htmlSpecialCharsMap[c] || c);
}
