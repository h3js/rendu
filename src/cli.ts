#! /usr/bin/env node
import { resolve } from "node:path";

import { log } from "srvx/log";
import { serve } from "srvx";
import { compileTemplate } from "./compiler.ts";
import { renderToResponse } from "./render.ts";
import { serveStatic } from "srvx/static";

const entry = resolve(process.argv[2] || ".");

console.log(entry);

const $GLOBALS = Object.create(null);

serve({
  middleware: [
    log(),
    serveStatic({
      dir: entry,
      methods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
      renderHTML({ request, html, filename }) {
        let htmlTemplate: (
          data: Record<string, any>,
        ) => Promise<ReadableStream>;
        try {
          htmlTemplate = compileTemplate(html, { filename });
        } catch (error) {
          console.error(error);
          const errMessage = String((error as Error).stack || error);
          return new Response(errMessage, { status: 500 });
        }
        return renderToResponse(htmlTemplate, {
          request,
          context: {
            $GLOBALS,
          },
        });
      },
    }),
  ],
  fetch: () => {
    return new Response("Not Found", { status: 404 });
  },
});
