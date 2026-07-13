import type { Hono } from "hono";

import { readJsonBody } from "../http.js";
import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerIntakeRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { companyIdFromContext, jsonResponse, resolveIntakeEventService } = api;

  app.post("/api/companies/:companyId/intake/events", async (c) => {
    const companyId = companyIdFromContext(c);
    const body = await readJsonBody(c);
    const service = await resolveIntakeEventService(options, companyId);
    return jsonResponse(c, await service.ingestIntakeEvent(companyId, body), 202);
  });
}
