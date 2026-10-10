import type { Express } from "express";
import type { Middleware } from "./types";

  export function logEndpoints(app: Express, host: string, port: number | undefined): void {
    const appWithRouter = app as Express & {
      _router?: {
        stack?: Middleware[];
      };
    };
    const router = appWithRouter._router;

    if (!router || !Array.isArray(router.stack)) {
      console.warn("⚠️ Express router not initialised yet");
      return;
    }

    router.stack.forEach((middleware: Middleware) => {
      if (middleware.route) {
        console.log(
          `Endpoint: https://${host}:${port}${middleware.route.path}, Method: ${Object.keys(middleware.route.methods).join(", ").toUpperCase()}`
        );
        return;
      }

      if (middleware.name !== "router" || !middleware.handle || !Array.isArray(middleware.handle.stack)) {
        return;
      }

      middleware.handle.stack.forEach((handler: Middleware) => {
        if (!handler.route) {
          return;
        }

        console.log(
          `Endpoint: https://${host}:${port}${handler.route.path}, Method: ${Object.keys(handler.route.methods).join(", ").toUpperCase()}`
        );
      });
    });
  }

