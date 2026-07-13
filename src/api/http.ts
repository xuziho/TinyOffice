import type { Context } from "hono";

import { assertNoForbiddenPublicCarrierFields } from "../collaboration/contracts/conversation-message-contract.js";

export type TinyOfficeApiErrorBody = {
  error: string;
  message: string;
};

export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new Error("invalid json body");
  }
}

export function jsonResponse(c: Context, value: unknown, status = 200): Response {
  assertNoForbiddenPublicCarrierFields(value);
  return c.json(value as never, status as never);
}

export function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : undefined;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return statusCode;
  }
  if (
    /explicit companyId is required|companyId is missing|requires PostgreSQL runtime configuration|requires employee viewer identity| is required|must be|unknown .* field|invalid .*body|forbidden carrier field|runtime evidence identity|unsupported Chat containerId|unsupported Chat image attachment MIME type|attachments metadata is not accepted|current member session/.test(
      message,
    )
  ) {
    return 400;
  }
  if (/companyId mismatch/.test(message)) {
    return 403;
  }
  if (/not found/.test(message)) {
    return 404;
  }
  return 500;
}

export function jsonError(c: Context, error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const body: TinyOfficeApiErrorBody = {
    error: message,
    message,
  };
  return c.json(body, errorStatus(error) as never);
}
