import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./contracts.js";

export function registerAuthenticationRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  app.on(["GET", "POST"], "/api/auth/*", (c) => options.auth.handle(c.req.raw));
  app.get("/api/tinyoffice/auth/status", async (c) => c.json(await options.auth.status(c.req.raw)));
}
