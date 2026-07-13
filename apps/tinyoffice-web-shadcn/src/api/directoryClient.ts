import type { CompanyDirectoryDto } from "tinyoffice/frontend-api-contracts";
import { companyDirectoryPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export async function getCompanyDirectory(input: { companyId?: string }): Promise<CompanyDirectoryDto> {
  return requestJson<CompanyDirectoryDto>(companyDirectoryPath(required(input.companyId, "companyId")));
}
