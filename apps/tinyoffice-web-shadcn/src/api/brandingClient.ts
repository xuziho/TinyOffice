import type { CompanyBrandingState } from "tinyoffice/frontend-api-contracts";
import { companyBrandingPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export function getCompanyBranding(input: { companyId?: string }): Promise<CompanyBrandingState> {
  return requestJson<CompanyBrandingState>(companyBrandingPath(required(input.companyId, "companyId")));
}
export function uploadCompanyLogo(input: { companyId?: string; file: File }): Promise<CompanyBrandingState> {
  const form = new FormData(); form.set("file", input.file);
  return requestJson<CompanyBrandingState>(`${companyBrandingPath(required(input.companyId, "companyId"))}/logo`, { method: "POST", body: form });
}
export function removeCompanyLogo(input: { companyId?: string }): Promise<CompanyBrandingState> {
  return requestJson<CompanyBrandingState>(`${companyBrandingPath(required(input.companyId, "companyId"))}/logo`, { method: "DELETE" });
}
