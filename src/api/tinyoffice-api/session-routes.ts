import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerSessionRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { currentSessionResponse, currentUserFromRequest, jsonResponse, parseSwitchCurrentCompanyBody, readJsonBody, resolveCompanyLifecycleService } = api;

  app.get("/api/tinyoffice/session/current", async (c) => {
    return jsonResponse(c, currentSessionResponse(currentUserFromRequest(c.req.raw)));
  });

  app.put("/api/tinyoffice/session/current-company", async (c) => {
    const currentUser = currentUserFromRequest(c.req.raw);
    const companyLifecycleService = resolveCompanyLifecycleService(options);
    const switchedSession = await companyLifecycleService.switchCurrentCompany(
      currentUser,
      parseSwitchCurrentCompanyBody(await readJsonBody(c)),
    );
    return jsonResponse(c, currentSessionResponse(switchedSession));
  });
}
