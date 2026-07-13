export const DEFAULT_COMPANY_LANGUAGE = "zh-CN";

const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function normalizePreferredLanguage(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !LANGUAGE_TAG_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function inferPreferredLanguageFromText(text?: string): string | undefined {
  if (!text?.trim()) {
    return undefined;
  }

  if (/[\u3040-\u30ff]/.test(text)) {
    return "ja";
  }
  if (/[\uac00-\ud7af]/.test(text)) {
    return "ko";
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return "zh-CN";
  }
  if (/[A-Za-z]/.test(text)) {
    return "en-US";
  }
  return undefined;
}

export function resolvePreferredLanguage(input: {
  explicit?: string;
  text?: string;
  fallback?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return (
    normalizePreferredLanguage(input.explicit) ||
    inferPreferredLanguageFromText(input.text) ||
    normalizePreferredLanguage(input.fallback) ||
    normalizePreferredLanguage(input.env?.TINYOFFICE_DEFAULT_LANGUAGE) ||
    DEFAULT_COMPANY_LANGUAGE
  );
}
