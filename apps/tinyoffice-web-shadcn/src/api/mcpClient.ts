import type { McpAdminView } from "tinyoffice/frontend-api-contracts";
import { companyMcpPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

const jsonHeaders = { "content-type": "application/json" };

export function getMcpState(input: { companyId?: string }): Promise<McpAdminView> {
  return requestJson<McpAdminView>(companyMcpPath(required(input.companyId, "companyId")));
}

export function saveMcpServer(input: { companyId?: string; body: Record<string, unknown> }): Promise<McpAdminView> {
  return requestJson<McpAdminView>(`${companyMcpPath(required(input.companyId, "companyId"))}/servers`, {
    method: "PUT", headers: jsonHeaders, body: JSON.stringify(input.body),
  });
}

export function saveMcpConnection(input: { companyId?: string; body: Record<string, unknown> }): Promise<McpAdminView> {
  return requestJson<McpAdminView>(`${companyMcpPath(required(input.companyId, "companyId"))}/connections`, {
    method: "PUT", headers: jsonHeaders, body: JSON.stringify(input.body),
  });
}

export function saveMcpAssignment(input: { companyId?: string; body: Record<string, unknown> }): Promise<McpAdminView> {
  return requestJson<McpAdminView>(`${companyMcpPath(required(input.companyId, "companyId"))}/assignments`, {
    method: "PUT", headers: jsonHeaders, body: JSON.stringify(input.body),
  });
}

export function deleteMcpAssignment(input: { companyId?: string; assignmentId: string }): Promise<McpAdminView> {
  return requestJson<McpAdminView>(`${companyMcpPath(required(input.companyId, "companyId"))}/assignments/${encodeURIComponent(input.assignmentId)}`, {
    method: "DELETE",
  });
}
