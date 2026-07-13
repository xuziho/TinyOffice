import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerRecruitmentRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { companyIdFromContext, jsonResponse, parseRecruitEmployeeBody, readJsonBody, resolveRecruitmentService } = api;

  app.post("/api/companies/:companyId/employees", async (c) => {
    const companyId = companyIdFromContext(c);
    const recruitmentService = await resolveRecruitmentService(options, companyId);
    const result = await recruitmentService.recruitEmployee(
      companyId,
      parseRecruitEmployeeBody(await readJsonBody(c), companyId),
    );
    options.realtimePublisher?.publish({
      type: "company.directory.changed",
      companyId,
    });
    return jsonResponse(c, result);
  });
}
