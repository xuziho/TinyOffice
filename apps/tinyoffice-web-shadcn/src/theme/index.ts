import type { UiThemePreference } from "tinyoffice/frontend-api-contracts";

export const UI_THEMES: readonly UiThemePreference[] = ["sakura", "ocean", "forest", "violet", "neutral"];

export function applyUiThemePreference(theme: UiThemePreference): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}
