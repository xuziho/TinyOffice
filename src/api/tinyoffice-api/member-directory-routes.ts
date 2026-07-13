import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerMemberDirectoryRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { companyIdFromContext, jsonResponse, resolveCompanyMemberDirectory } = api;

  app.get("/api/companies/:companyId/member-directory", async (c) => {
    const companyId = companyIdFromContext(c);
    return jsonResponse(c, await resolveCompanyMemberDirectory(options, companyId));
  });
}
