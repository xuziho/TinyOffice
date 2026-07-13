import type { TinyOfficeUpdateJob, TinyOfficeUpdateStatus } from "tinyoffice/frontend-api-contracts";
import { requestJson } from "./tinyofficeRequest";

export function getUpdateStatus(): Promise<TinyOfficeUpdateStatus> {
  return requestJson<TinyOfficeUpdateStatus>("/api/tinyoffice/updates");
}

export function installApprovedUpdate(): Promise<TinyOfficeUpdateJob> {
  return requestJson<TinyOfficeUpdateJob>("/api/tinyoffice/updates", { method: "POST" });
}
