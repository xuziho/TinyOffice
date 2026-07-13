import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerCompanyRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const {
    companyIdFromContext,
    currentUserFromRequest,
    jsonResponse,
    parseCreateCompanyBody,
    parseDeleteCompanyBody,
    parseSaveCompanySystemAiSettingsBody,
    readJsonBody,
    resolveCompanyLifecycleService,
  } = api;

  app.get("/api/companies", async (c) => {
    const companyLifecycleService = resolveCompanyLifecycleService(options);
    return jsonResponse(c, await companyLifecycleService.loadCompanies());
  });

  app.post("/api/companies", async (c) => {
    const companyLifecycleService = resolveCompanyLifecycleService(options);
    const currentUser = currentUserFromRequest(c.req.raw, options.auth);
    const input = parseCreateCompanyBody(await readJsonBody(c));
    return jsonResponse(c, await companyLifecycleService.createCompany({
      ...input,
      ownerMemberId: currentUser.userId,
      ownerDisplayName: currentUser.displayName ?? currentUser.userId,
    }), 201);
  });

  app.delete("/api/companies/:companyId", async (c) => {
    const companyId = companyIdFromContext(c);
    const companyLifecycleService = resolveCompanyLifecycleService(options);
    return jsonResponse(
      c,
      await companyLifecycleService.deleteCompany(
        parseDeleteCompanyBody(await readJsonBody(c), companyId),
        companyLifecycleService.deletionGuard,
      ),
    );
  });

  app.patch("/api/companies/:companyId/system-ai", async (c) => {
    const companyId = companyIdFromContext(c);
    const companyLifecycleService = resolveCompanyLifecycleService(options);
    if (!companyLifecycleService.saveSystemAiSettings) {
      throw new Error("Company lifecycle service does not support System AI settings.");
    }
    return jsonResponse(
      c,
      await companyLifecycleService.saveSystemAiSettings(
        parseSaveCompanySystemAiSettingsBody(await readJsonBody(c), companyId),
      ),
    );
  });
}
