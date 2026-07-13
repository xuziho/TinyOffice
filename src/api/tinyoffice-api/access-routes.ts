import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerAccessRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { accessApiViewModel, companyIdFromContext, jsonResponse, parseAccessPolicySaveBody, parseAccessPreviewBody, parseAccessToolCallDecisionBody, parseResolveAccessRequestBody, readJsonBody, resolveAccessService } = api;

  app.get("/api/companies/:companyId/access", async (c) => {
    const companyId = companyIdFromContext(c);
    const accessService = await resolveAccessService(options, companyId);
    return jsonResponse(c, accessApiViewModel(companyId, await accessService.loadAccess(companyId)));
  });

  app.post("/api/companies/:companyId/access", async (c) => {
    const companyId = companyIdFromContext(c);
    const accessService = await resolveAccessService(options, companyId);
    return jsonResponse(
      c,
      accessApiViewModel(
        companyId,
        await accessService.saveAccessPolicy(companyId, parseAccessPolicySaveBody(await readJsonBody(c), companyId)),
      ),
    );
  });

  app.post("/api/companies/:companyId/access/preview", async (c) => {
    const companyId = companyIdFromContext(c);
    const accessService = await resolveAccessService(options, companyId);
    return jsonResponse(
      c,
      await accessService.previewAccessDecision(companyId, parseAccessPreviewBody(await readJsonBody(c), companyId)),
    );
  });

  app.get("/api/companies/:companyId/access/requests", async (c) => {
    const companyId = companyIdFromContext(c);
    const accessService = await resolveAccessService(options, companyId);
    if (!accessService.listAccessRequests) {
      throw new Error("Access request service is not configured");
    }
    return jsonResponse(c, await accessService.listAccessRequests(companyId));
  });

  app.post("/api/companies/:companyId/access/requests/:approvalId/resolve", async (c) => {
    const companyId = companyIdFromContext(c);
    const accessService = await resolveAccessService(options, companyId);
    if (!accessService.resolveAccessRequest) {
      throw new Error("Access request resolution service is not configured");
    }
    return jsonResponse(
      c,
      await accessService.resolveAccessRequest(
        companyId,
        c.req.param("approvalId"),
        parseResolveAccessRequestBody(await readJsonBody(c), companyId),
      ),
    );
  });

  app.post("/api/companies/:companyId/access/tool-call", async (c) => {
    const companyId = companyIdFromContext(c);
    const accessService = await resolveAccessService(options, companyId);
    if (!accessService.decideAccessToolCall) {
      throw new Error("Access tool-call decision service is not configured");
    }
    return jsonResponse(
      c,
      await accessService.decideAccessToolCall(
        companyId,
        parseAccessToolCallDecisionBody(await readJsonBody(c), companyId),
      ),
    );
  });
}
