import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerDoctorRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { companyIdFromContext, jsonResponse, resolveDoctorService } = api;

  app.get("/api/companies/:companyId/doctor", async (c) => {
    const companyId = companyIdFromContext(c);
    const doctorService = await resolveDoctorService(options, companyId);
    return jsonResponse(c, await doctorService.loadDoctorReport(companyId));
  });
}
