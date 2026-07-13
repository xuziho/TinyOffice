import type { CapabilityRegistryViewModel } from "tinyoffice/frontend-api-contracts";
import { companyCapabilitiesPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export function getCapabilities(input: { companyId?: string }): Promise<CapabilityRegistryViewModel> {
  return requestJson<CapabilityRegistryViewModel>(companyCapabilitiesPath(required(input.companyId, "companyId")));
}
