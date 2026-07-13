import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerSessionRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { authMode, currentSessionResponse, currentUserFromRequest, jsonResponse, parseSwitchCurrentCompanyBody, readJsonBody, resolveCompanyLifecycleService } = api;

  app.get("/api/tinyoffice/session/current", async (c) => {
    const mode = authMode(options);
    const currentUser = currentUserFromRequest(c.req.raw, options.auth);
    const companyLifecycleService = options.companyLifecycleService
      ? resolveCompanyLifecycleService(options)
      : undefined;
    const resolvedSession = companyLifecycleService?.resolveCurrentUserSession
      ? await companyLifecycleService.resolveCurrentUserSession(currentUser)
      : currentUser;
    return jsonResponse(c, currentSessionResponse(resolvedSession, mode));
  });

  app.put("/api/tinyoffice/session/current-company", async (c) => {
    const mode = authMode(options);
    const currentUser = currentUserFromRequest(c.req.raw, options.auth);
    const companyLifecycleService = resolveCompanyLifecycleService(options);
    if (!companyLifecycleService.switchCurrentCompany) {
      throw new Error("Current Company switching is not available.");
    }
    const switchedSession = await companyLifecycleService.switchCurrentCompany(
      currentUser,
      parseSwitchCurrentCompanyBody(await readJsonBody(c)),
    );
    return jsonResponse(c, currentSessionResponse(switchedSession, mode));
  });
}
