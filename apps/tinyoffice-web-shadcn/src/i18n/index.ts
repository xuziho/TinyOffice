import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { UiLocalePreference } from "tinyoffice/frontend-api-contracts";

import { en, zhCN } from "./resources";

export type EffectiveUiLocale = "en" | "zh-CN";

function systemLocale(): EffectiveUiLocale {
  const languages = typeof navigator === "undefined" ? ["en"] : navigator.languages;
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

export function resolveUiLocale(preference: UiLocalePreference): EffectiveUiLocale {
  return preference === "system" ? systemLocale() : preference;
}

export async function applyUiLocalePreference(preference: UiLocalePreference): Promise<void> {
  const locale = resolveUiLocale(preference);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  await i18n.changeLanguage(locale);
}

export function currentUiLocale(): EffectiveUiLocale {
  return i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      "zh-CN": { translation: zhCN },
    },
    lng: systemLocale(),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });

if (typeof document !== "undefined") {
  document.documentElement.lang = systemLocale();
}

export { i18n };
