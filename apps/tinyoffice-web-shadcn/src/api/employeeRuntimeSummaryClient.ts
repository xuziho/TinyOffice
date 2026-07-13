import type { EmployeeRuntimeSummaryViewModel } from "tinyoffice/frontend-api-contracts";
import { companyEmployeeRuntimeSummaryPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export async function getEmployeeRuntimeSummary(input: { companyId?: string; employeeId?: string }): Promise<EmployeeRuntimeSummaryViewModel> {
  const companyId = required(input.companyId, "companyId");
  const query = new URLSearchParams();
  if (input.employeeId?.trim()) {
    query.set("employeeId", input.employeeId.trim());
  }
  const queryString = query.toString();
  return requestJson<EmployeeRuntimeSummaryViewModel>(`${companyEmployeeRuntimeSummaryPath(companyId)}${queryString ? `?${queryString}` : ""}`);
}
