#! /usr/bin/env node
import { resolve } from "node:path";

import { loggerMiddleware } from "srvx/log";
import { FastResponse, serve } from "srvx";
import { compileTemplate } from "./compiler.ts";
import { renderToResponse } from "./render.ts";
import { staticMiddleware } from "srvx/static";

const entry = resolve(process.argv[2] || ".");

console.log(`Serving ${entry}`);

const $GLOBALS = Object.create(null);

serve({
  middleware: [
    loggerMiddleware(),
    staticMiddleware({
      dir: entry,
      methods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
      async renderHTML({ request, html, filename }) {
        try {
          const htmlTemplate = compileTemplate(html, { filename });
          const response = await renderToResponse(htmlTemplate, {
            request,
            context: {
              $GLOBALS,
            },
          });
          if (!response.body) {
            return response;
          }
          return new FastResponse(logStreamErrors(response.body), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (error) {
          console.error(error);
          const errMessage = String((error as Error).stack || error);
          return new FastResponse(errMessage, { status: 500 });
        }
      },
    }),
  ],
  fetch: () => {
    return new FastResponse("Not Found", { status: 404 });
  },
});

/**
 * Once the body is streaming, the status is already sent and a template error can only cut the
 * response short: log it, or it would go unnoticed.
 */
function logStreamErrors(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        console.error(error);
        controller.error(error);
        return;
      }
      if (result.done) {
        controller.close();
      } else {
        controller.enqueue(result.value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
