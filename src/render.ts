import { parse as parseCookies, serialize as serializeCookie } from "cookie-es";
import type { CookieSerializeOptions } from "cookie-es";
import type { CompiledTemplate } from "./compiler.ts";
import { FastResponse } from "srvx";
import { htmlspecialchars } from "./runtime/prelude.ts";

export interface RenderOptions {
  request?: Request;
  context?: Record<string, unknown>;
}

const DEFAULT_CONTENT_TYPE = "text/html; charset=utf-8";

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
    committed.add(ctx.$RESPONSE);
    return mergeResponseHeaders(body, ctx.$RESPONSE.headers);
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

/**
 * Apply headers prepared via the context (`setCookie()`, `redirect()`, `$RESPONSE.headers`) to a
 * Response returned by the template. Its own status and headers win (so `redirect()` only adds
 * `Location`), except `Set-Cookie`, which is appended. The untouched default `Content-Type` is
 * skipped since it does not describe the returned body.
 */
function mergeResponseHeaders(response: Response, prepared: Headers): Response {
  const extra: [string, string][] = [];
  for (const [name, value] of prepared) {
    if (name === "set-cookie" || !response.headers.has(name)) {
      if (name !== "content-type" || value !== DEFAULT_CONTENT_TYPE) extra.push([name, value]);
    }
  }
  // Nothing to add, or a status a new Response cannot be created with (`Response.error()`, 101).
  if (extra.length === 0 || response.status < 200 || response.status > 599) {
    return response;
  }
  // Never mutate the returned Response: it may be immutable (`fetch()`, `Response.redirect()`) or
  // shared across requests. Re-wrap it without reading the body instead.
  const headers = new Headers(response.headers);
  for (const [name, value] of extra) headers.append(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A prepared render context, as accepted by `renderContextToResponse`. */
export type RenderContextInput = { $RESPONSE: RenderResponse } & Record<string, unknown>;

export type RenderResponse = {
  status: number;
  statusText: string;
  headers: Headers;
};

export type RenderContext = {
  htmlspecialchars: typeof htmlspecialchars;
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
    // Empty (like `new Response()`) so a changed `status` never goes out as e.g. `404 OK`.
    statusText: "",
    headers: new Headers({ "Content-Type": DEFAULT_CONTENT_TYPE }),
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
    response.statusText = "";
    // Percent-encode what cannot go on the wire (non-ASCII, spaces, controls) but keep existing
    // `%XX` escapes as they are.
    response.headers.set("Location", to.trim().replace(/[^\x21-\x7E]+/g, encodeURI));
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
 * It converts to a string like a plain object (`"[object Object]"`) and `util.inspect()` /
 * `console.log()` show the cookies.
 */
export function createRenderCookies(req: Request | undefined): Readonly<Record<string, string>> {
  let parsed: Record<string, string> | undefined;
  const cookies = (): Record<string, string> => {
    parsed ??= req ? (parseCookies(req.headers.get("cookie") || "") as Record<string, string>) : {};
    return parsed;
  };
  // Note: the target is an extensible null-prototype object (so inherited properties such as
  // `toString` are never reported as cookies) with only non-enumerable, configurable symbol
  // keys, so that the traps below are free to report whatever the parsed cookies contain.
  const target = Object.create(null, {
    [Symbol.toPrimitive]: {
      value: (hint: string) => (hint === "number" ? Number.NaN : "[object Object]"),
      configurable: true,
    },
    [Symbol.for("nodejs.util.inspect.custom")]: {
      value: () => ({ ...cookies() }),
      configurable: true,
    },
  }) as Record<string, string>;
  return new Proxy(target, {
    get(target, prop) {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      const all = cookies();
      return Object.hasOwn(all, prop) ? all[prop] : undefined;
    },
    has(target, prop) {
      if (typeof prop !== "string") return Reflect.has(target, prop);
      return Object.hasOwn(cookies(), prop);
    },
    ownKeys(target) {
      return [...Object.keys(cookies()), ...Object.getOwnPropertySymbols(target)];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== "string") return Reflect.getOwnPropertyDescriptor(target, prop);
      const all = cookies();
      if (!Object.hasOwn(all, prop)) return undefined;
      return { value: all[prop], enumerable: true, configurable: true, writable: false };
    },
  });
}
