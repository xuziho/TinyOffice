import type { Hono } from "hono";

import { readJsonBody } from "../http.js";
import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";
import type { TasksRunActionId } from "../../work/tasks-run-actions.js";

const tasksRunActionIds = new Set<TasksRunActionId>([
  "retry-dispatch",
  "retry-run",
  "cancel-run",
]);

function requireTasksRunActionId(value: string): TasksRunActionId {
  if (tasksRunActionIds.has(value as TasksRunActionId)) {
    return value as TasksRunActionId;
  }
  const error = new Error(`Tasks Run action not found: ${value}`) as Error & { statusCode: number };
  error.statusCode = 404;
  throw error;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function registerTasksRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const {
    companyIdFromContext,
    currentMemberSession,
    jsonResponse,
    resolveTasksRunActionService,
    resolveTasksViewModelService,
  } = api;

  app.get("/api/companies/:companyId/tasks/view-model", async (c) => {
    const companyId = companyIdFromContext(c);
    const tasksViewModelService = await resolveTasksViewModelService(options, companyId);
    return jsonResponse(c, await tasksViewModelService.loadTasksViewModel(companyId, {
      requestUrl: new URL(c.req.url),
    }));
  });

  app.post("/api/companies/:companyId/tasks/runs/:workRunId/actions/:actionId", async (c) => {
    const companyId = companyIdFromContext(c);
    const workRunId = c.req.param("workRunId").trim();
    if (!workRunId) {
      throw new Error("workRunId is required");
    }
    const actionId = requireTasksRunActionId(c.req.param("actionId"));
    const actor = currentMemberSession(options, c, companyId);
    const rawBody = await readJsonBody(c);
    const body = rawBody && typeof rawBody === "object" ? rawBody as Record<string, unknown> : {};
    const tasksRunActionService = await resolveTasksRunActionService(options, companyId);
    return jsonResponse(c, await tasksRunActionService.executeTasksRunAction(companyId, {
      requestUrl: new URL(c.req.url),
      workRunId,
      actionId,
      actorMemberId: actor.memberId,
      reason: optionalString(body, "reason"),
    }), 202);
  });
}
