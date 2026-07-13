import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

export class TinyOfficeApiError extends Error {
  status: number;
  detail?: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "TinyOfficeApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function currentSessionHeaders(session: TinyOfficeCurrentSession | undefined, companyId: string): Record<string, string> {
  const sessionCompanyId = session?.companyId ?? session?.currentCompanyId;
  const memberId = session?.member?.memberId;
  if (!sessionCompanyId || !memberId || sessionCompanyId !== companyId) {
    throw new Error("TinyOffice current member session is required");
  }
  return {
    "x-tinyoffice-company-id": sessionCompanyId,
    "x-tinyoffice-member-id": memberId,
    ...(session.member?.displayName ? { "x-tinyoffice-member-display-name": session.member.displayName } : {}),
    ...(session.member?.role ? { "x-tinyoffice-member-role": session.member.role } : {}),
  };
}

export function required(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin), {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    const detail = parseResponseDetail(responseText);
    const message = errorMessageFromDetail(detail) ?? `TinyOffice runtime request failed: ${response.status}`;
    throw new TinyOfficeApiError(message, response.status, detail);
  }

  const responseText = await response.text();
  return (responseText ? JSON.parse(responseText) : undefined) as T;
}

function parseResponseDetail(responseText: string): unknown {
  if (!responseText) {
    return undefined;
  }
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function errorMessageFromDetail(detail: unknown): string | undefined {
  if (!detail || typeof detail !== "object") {
    return typeof detail === "string" && detail.trim() ? detail.trim() : undefined;
  }
  const record = detail as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }
  if (record.error && typeof record.error === "object") {
    const nestedMessage = (record.error as Record<string, unknown>).message;
    return typeof nestedMessage === "string" && nestedMessage.trim() ? nestedMessage.trim() : undefined;
  }
  return undefined;
}
