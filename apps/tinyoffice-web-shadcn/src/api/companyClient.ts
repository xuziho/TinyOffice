import type {
  CompaniesAdminViewModel,
  CreateCompanyRequest,
  DeleteCompanyRequest,
  DeleteCompanyResult,
  OwnedCreateCompanyResult,
  SaveCompanySystemAiSettingsRequest,
} from "tinyoffice/frontend-api-contracts";
import { companiesPath, companyLifecyclePath, companySystemAiPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export async function listCompanies(): Promise<CompaniesAdminViewModel> {
  return requestJson<CompaniesAdminViewModel>(companiesPath());
}

export async function createCompany(input: CreateCompanyRequest): Promise<OwnedCreateCompanyResult> {
  return requestJson<OwnedCreateCompanyResult>(companiesPath(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(input.companyId?.trim() ? { companyId: input.companyId.trim() } : {}),
      displayName: required(input.displayName, "displayName"),
      hrEmployeeDisplayName: required(input.hrEmployeeDisplayName, "hrEmployeeDisplayName"),
      ...(input.hrRuntime ? { hrRuntime: input.hrRuntime } : {}),
      ...(input.systemAiRuntime ? { systemAiRuntime: input.systemAiRuntime } : {}),
    }),
  });
}

export async function deleteCompany(input: DeleteCompanyRequest): Promise<DeleteCompanyResult> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<DeleteCompanyResult>(companyLifecyclePath(companyId), {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      confirmation: {
        intent: required(input.confirmationText, "confirmationText"),
      },
    }),
  });
}

export async function saveCompanySystemAiSettings(
  input: SaveCompanySystemAiSettingsRequest,
): Promise<CompaniesAdminViewModel> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<CompaniesAdminViewModel>(companySystemAiPath(companyId), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chatTitleGeneration: input.chatTitleGeneration || {},
      chatTopicSummary: input.chatTopicSummary || {},
    }),
  });
}
