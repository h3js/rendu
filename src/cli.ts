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
          return await renderToResponse(htmlTemplate, {
            request,
            context: {
              $GLOBALS,
            },
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
