import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

function optionalTrimmed(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function registerEmployeeRuntimeSummaryRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { companyIdFromContext, jsonResponse, resolveEmployeeRuntimeSummaryService } = api;

  app.get("/api/companies/:companyId/employees/runtime-summary", async (c) => {
    const companyId = companyIdFromContext(c);
    const requestUrl = new URL(c.req.url);
    const employeeRuntimeSummaryService = await resolveEmployeeRuntimeSummaryService(options, companyId);
    return jsonResponse(c, await employeeRuntimeSummaryService.loadEmployeeRuntimeSummary(companyId, {
      requestUrl,
      employeeId: optionalTrimmed(requestUrl.searchParams.get("employeeId")),
    }));
  });
}
