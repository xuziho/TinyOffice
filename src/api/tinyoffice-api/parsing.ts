import type { Context } from "hono";

export type Cursor = { cursor?: string; limit?: number };

export function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function numberFrom(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function cursorFromContext(c: Context): Cursor {
  const url = new URL(c.req.url);
  return {
    cursor: stringFrom(url.searchParams.get("cursor")),
    limit: numberFrom(url.searchParams.get("limit")),
  };
}

export function requireParam(c: Context, fieldName: string): string {
  const value = stringFrom(c.req.param(fieldName));
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

export function requireString(input: Record<string, unknown>, fieldName: string): string {
  const value = stringFrom(input[fieldName]);
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

export function requireObjectBody(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is required`);
  }
  return value as Record<string, unknown>;
}

export function assertKnownFields(input: Record<string, unknown>, allowedFields: readonly string[], label: string): void {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) {
      throw new Error(`unknown ${label} field: ${field}`);
    }
  }
}

export function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${fieldName} must contain strings`);
    }
    return item.trim();
  });
}

export function optionalObjectArray(value: unknown, fieldName: string): Record<string, unknown>[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${fieldName} must contain objects`);
    }
    return item as Record<string, unknown>;
  });
}

export function optionalDisplayNames(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("memberDisplayNames must be an object");
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([memberId, displayName]) => {
      if (typeof displayName !== "string" || !displayName.trim()) {
        throw new Error("memberDisplayNames must contain strings");
      }
      return [memberId, displayName.trim()];
    }),
  );
}
