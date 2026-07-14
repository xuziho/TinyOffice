import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerSessionRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { currentSessionResponse, currentUserFromRequest, jsonResponse, parseSwitchCurrentCompanyBody, readJsonBody, resolveCompanyLifecycleService } = api;

  app.get("/api/tinyoffice/session/current", async (c) => {
    const currentUser = currentUserFromRequest(c.req.raw);
    const companyLifecycleService = options.companyLifecycleService
      ? resolveCompanyLifecycleService(options)
      : undefined;
    const resolvedSession = companyLifecycleService?.resolveCurrentUserSession
      ? await companyLifecycleService.resolveCurrentUserSession(currentUser)
      : currentUser;
    return jsonResponse(c, currentSessionResponse(resolvedSession));
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
