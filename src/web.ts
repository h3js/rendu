import type { CompiledTemplate } from "./compiler.ts";

export type RenderToResponseOptions = {
  context?: Record<string, unknown>;
  request?: Request;
};

export const RENDER_TO_RESPONSE_KEYS = [
  "$REQUEST",
  "$METHOD",
  "$URL",
  "$HEADERS",
  "$RESPONSE",
];

/**
 * Renders an HTML template to a Response object.
 *
 * The template can access the following variables:
 *   - `globalThis`: The global object.
 *   - `$REQUEST`: The incoming Request object (if provided).
 *   - `$METHOD`: The HTTP method of the request (if provided).
 *   - `$URL`: The URL of the request as a URL object (if provided).
 *   - `$HEADERS`: The headers of the request (if provided).
 *   - `$RESPONSE`: An object to customize the response, with properties: status, statusText, and headers.
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
  opts: RenderToResponseOptions = {},
): Promise<Response> {
  const ctx = {
    ...opts.context,
    globalThis,
    $REQUEST: opts.request,
    $METHOD: opts.request?.method,
    $URL: opts.request ? new URL(opts.request.url) : undefined,
    $HEADERS: opts.request?.headers,
    $RESPONSE: {
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "Content-Type": "text/html",
        "Content-Encoding": "utf8",
      }),
    },

    // utils
    htmlspecialchars: (s: string) =>
      String(s).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c] || c,
      ),
  };
  const body = await htmlTemplate(ctx);
  if (body instanceof Response) {
    return body;
  }
  return new Response(body, {
    status: ctx.$RESPONSE.status,
    statusText: ctx.$RESPONSE.statusText,
    headers: ctx.$RESPONSE.headers,
  });
}
