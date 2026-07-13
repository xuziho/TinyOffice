import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerDirectoryRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { companyIdFromContext, jsonResponse, resolveDirectory } = api;

  app.get("/api/companies/:companyId/directory", async (c) => {
    const companyId = companyIdFromContext(c);
    return jsonResponse(c, await resolveDirectory(options, companyId));
  });
}
