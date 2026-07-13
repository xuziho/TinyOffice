import type { IncomingMessage, ServerResponse } from "node:http";

export async function readJsonBody<T>(
  req: IncomingMessage,
): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

export function writeJson(
  res: ServerResponse,
  statusCode: number,
  value: unknown,
  contentType = "application/json; charset=utf-8",
): void {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(JSON.stringify(value));
}

export function writeInvalidJsonBody(
  res: ServerResponse,
  contentType?: string,
): void {
  writeJson(res, 400, { error: "invalid json body" }, contentType);
}
