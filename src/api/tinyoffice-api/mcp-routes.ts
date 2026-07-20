import type { Context, Hono } from "hono";

import { McpAdminService } from "../../mcp/mcp-admin-service.js";
import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

function service(options: TinyOfficeApiOptions): McpAdminService {
  if (!options.repoRoot) throw new Error("MCP administration requires repoRoot.");
  return new McpAdminService(options.repoRoot);
}

async function body(c: Context): Promise<Record<string, unknown>> {
  const value = await c.req.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

export function registerMcpRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  app.get("/api/companies/:companyId/mcp", async (c) => {
    const companyId = api.companyIdFromContext(c);
    return api.jsonResponse(c, await service(options).loadState(companyId));
  });
  app.post("/api/companies/:companyId/mcp/check", async (c) => {
    const companyId = api.companyIdFromContext(c);
    const input = await body(c);
    if (typeof input.memberId !== "string" || !input.memberId.trim()) throw new Error("memberId is required.");
    return api.jsonResponse(c, await service(options).checkConnection(companyId, input.memberId.trim()));
  });
}
