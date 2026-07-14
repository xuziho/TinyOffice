import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerUpdateRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  app.get("/api/tinyoffice/updates", async (c) => {
    api.currentUserFromRequest(c.req.raw);
    if (!options.updateService) throw new Error("TinyOffice update service is not configured.");
    return api.jsonResponse(c, await options.updateService.loadStatus());
  });

  app.post("/api/tinyoffice/updates", async (c) => {
    api.currentUserFromRequest(c.req.raw);
    if (!options.updateService) throw new Error("TinyOffice update service is not configured.");
    return api.jsonResponse(c, await options.updateService.startApprovedUpdate(), 202);
  });
}
