import type { UiLocalePreference, UiThemePreference, UserProfileState } from "tinyoffice/frontend-api-contracts";
import { requestJson } from "./tinyofficeRequest";
export function getMyProfile(): Promise<UserProfileState> { return requestJson<UserProfileState>("/api/tinyoffice/profile"); }
export function saveMyProfile(input: { displayName: string; avatarSeed: string; uiLocale: UiLocalePreference; uiTheme: UiThemePreference }): Promise<UserProfileState> { return requestJson<UserProfileState>("/api/tinyoffice/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
