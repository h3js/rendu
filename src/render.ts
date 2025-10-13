import { parse as parseCookies, serialize as serializeCookie } from "cookie-es";
import type { CookieSerializeOptions } from "cookie-es";
import type { CompiledTemplate } from "./compiler.ts";
import { FastResponse } from "srvx";

export interface RenderOptions {
  request?: Request;
  context?: Record<string, unknown>;
}

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
  const ctx = createRenderContext(opts);
  const body = await htmlTemplate(ctx);
  if (body instanceof Response) {
    return body;
  }
  return new FastResponse(body, {
    status: ctx.$RESPONSE.status,
    statusText: ctx.$RESPONSE.statusText,
    headers: ctx.$RESPONSE.headers,
  });
}

export type RenderContext = {
  htmlspecialchars: (s: string) => string;
  setCookie: (
    name: string,
    value: string,
    options?: CookieSerializeOptions,
  ) => void;
  redirect?: (url: string, status?: number) => void;
  $REQUEST?: Request;
  $METHOD?: string;
  $URL?: URL;
  $HEADERS?: Headers;
  $COOKIES: Readonly<Record<string, string>>;
  $RESPONSE: {
    status: number;
    statusText: string;
    headers: Headers;
  };
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
  // URL
  const url = new URL(options.request?.url || "http://_");

  // Prepared response
  const response = {
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "text/html ; charset=utf-8" }),
  };

  // Cookies
  const $COOKIES = lazyCookies(options.request!);
  const setCookie = (
    name: string,
    value: string,
    sOpts: CookieSerializeOptions = {},
  ) => {
    response.headers.append("Set-Cookie", serializeCookie(name, value, sOpts));
  };

  // Redirect
  const redirect = (to: string, status = 302) => {
    response.status = status;
    response.headers.set("Location", to);
  };

  return {
    ...options.context,
    htmlspecialchars,
    setCookie,
    redirect,
    $REQUEST: options.request,
    $METHOD: options.request?.method,
    $URL: url,
    $HEADERS: options.request?.headers,
    $COOKIES,
    $RESPONSE: response,
  };
}

function lazyCookies(req: Request | undefined) {
  if (!req) {
    return {};
  }
  let parsed: Record<string, string> | undefined;
  return new Proxy(Object.freeze(Object.create(null)), {
    get(_, prop: string) {
      if (typeof prop !== "string") return undefined;
      parsed ??= parseCookies(req.headers.get("cookie") || "");
      return parsed[prop];
    },
  });
}

function htmlspecialchars(s: string): string {
  // prettier-ignore
  const htmlSpecialCharsMap: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s).replace(/[&<>"']/g, (c) => htmlSpecialCharsMap[c] || c);
}
