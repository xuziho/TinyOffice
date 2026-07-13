import type { UserProfileState } from "tinyoffice/frontend-api-contracts";
import { requestJson } from "./tinyofficeRequest";
export function getMyProfile(): Promise<UserProfileState> { return requestJson<UserProfileState>("/api/tinyoffice/profile"); }
export function saveMyProfile(input: { displayName: string; avatarSeed: string }): Promise<UserProfileState> { return requestJson<UserProfileState>("/api/tinyoffice/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
