import type { TinyOfficeDoctorReport } from "tinyoffice/frontend-api-contracts";
import { companyDoctorPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export async function getDoctorReport(input: { companyId?: string }): Promise<TinyOfficeDoctorReport> {
  return requestJson<TinyOfficeDoctorReport>(companyDoctorPath(required(input.companyId, "companyId")));
}
