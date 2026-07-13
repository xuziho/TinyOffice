import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerSessionsRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { companyIdFromContext, jsonResponse, resolveSessionExplorerService, stringFrom } = api;

  app.get("/api/companies/:companyId/sessions/view-model", async (c) => {
    const companyId = companyIdFromContext(c);
    const requestUrl = new URL(c.req.url);
    const sessionExplorerService = await resolveSessionExplorerService(options, companyId);
    return jsonResponse(c, await sessionExplorerService.loadSessionExplorerViewModel(companyId, {
      requestUrl,
      employeeId: stringFrom(requestUrl.searchParams.get("employeeId")),
      sessionId: stringFrom(requestUrl.searchParams.get("sessionId")),
      query: stringFrom(requestUrl.searchParams.get("q")),
      employeeIdFilter: stringFrom(requestUrl.searchParams.get("employeeIdFilter")),
    }));
  });
}
