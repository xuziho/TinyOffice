import type { SessionExplorerViewModel } from "tinyoffice/frontend-api-contracts";
import { companySessionsPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export interface GetSessionExplorerViewModelInput {
  companyId: string;
  employeeId?: string;
  sessionId?: string;
  query?: string;
  employeeIdFilter?: string;
}

export async function getSessionExplorerViewModel(
  input: GetSessionExplorerViewModelInput,
): Promise<SessionExplorerViewModel> {
  const params = new URLSearchParams();
  appendParam(params, "employeeId", input.employeeId);
  appendParam(params, "sessionId", input.sessionId);
  appendParam(params, "q", input.query);
  appendParam(params, "employeeIdFilter", input.employeeIdFilter);
  const query = params.toString();
  const path = companySessionsPath(required(input.companyId, "companyId"));
  return requestJson<SessionExplorerViewModel>(query ? `${path}?${query}` : path);
}

function appendParam(params: URLSearchParams, name: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    params.set(name, trimmed);
  }
}
