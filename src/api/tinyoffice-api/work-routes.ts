import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerWorkRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const {
    companyIdFromContext,
    currentMemberSession,
    jsonResponse,
    parseWorkTaskLifecycleBody,
    readJsonBody,
    requireParam,
    resolveWorkCreationService,
  } = api;

  app.post("/api/companies/:companyId/work/:workTaskId/cancel", async (c) => {
    const companyId = companyIdFromContext(c);
    const workTaskId = requireParam(c, "workTaskId");
    const actor = currentMemberSession(options, c, companyId);
    const workCreationService = await resolveWorkCreationService(options, companyId);
    return jsonResponse(c, await workCreationService.cancelWorkTask(
      companyId,
      parseWorkTaskLifecycleBody(await readJsonBody(c), companyId, actor.memberId, workTaskId, "CANCEL"),
    ));
  });

  app.post("/api/companies/:companyId/work/:workTaskId/archive", async (c) => {
    const companyId = companyIdFromContext(c);
    const workTaskId = requireParam(c, "workTaskId");
    const actor = currentMemberSession(options, c, companyId);
    const workCreationService = await resolveWorkCreationService(options, companyId);
    return jsonResponse(c, await workCreationService.archiveWorkTask(
      companyId,
      parseWorkTaskLifecycleBody(await readJsonBody(c), companyId, actor.memberId, workTaskId, "ARCHIVE"),
    ));
  });

  app.post("/api/companies/:companyId/work/:workTaskId/restore", async (c) => {
    const companyId = companyIdFromContext(c);
    const workTaskId = requireParam(c, "workTaskId");
    const actor = currentMemberSession(options, c, companyId);
    const workCreationService = await resolveWorkCreationService(options, companyId);
    return jsonResponse(c, await workCreationService.restoreWorkTask(
      companyId,
      parseWorkTaskLifecycleBody(await readJsonBody(c), companyId, actor.memberId, workTaskId, "RESTORE"),
    ));
  });
}
