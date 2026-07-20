import type { McpAdminView } from "tinyoffice/frontend-api-contracts";
import { companyMcpPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export function getMcpState(input: { companyId?: string }): Promise<McpAdminView> {
  return requestJson<McpAdminView>(companyMcpPath(required(input.companyId, "companyId")));
}
