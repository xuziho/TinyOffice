import type { SwitchCurrentCompanyRequest, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import { currentCompanySessionPath, currentSessionPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export async function getCurrentSession(): Promise<TinyOfficeCurrentSession> {
  return requestJson<TinyOfficeCurrentSession>(currentSessionPath());
}

export async function switchCurrentCompany(input: SwitchCurrentCompanyRequest): Promise<TinyOfficeCurrentSession> {
  return requestJson<TinyOfficeCurrentSession>(currentCompanySessionPath(), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId: required(input.companyId, "companyId"),
    }),
  });
}
