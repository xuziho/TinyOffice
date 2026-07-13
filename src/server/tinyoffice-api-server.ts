import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hono } from "hono";

const TINYOFFICE_API_PREFIX = /^\/api\/(?:tinyoffice\/(?:profile|backups(?:\/|$)|updates(?:\/|$)|session\/current)|runtime\/models|companies(?:$|\/[^/]+(?:$|\/(?:access|branding|capabilities|chat|directory|doctor|employees|intake|member-directory|member-runtime|prompt-policy|sessions|skills|system-ai|tasks|work)(?:\/|$))))/;

export function isTinyOfficeApiRequest(url: string | undefined): boolean {
  const requestUrl = new URL(url || "/", "http://127.0.0.1");
  return TINYOFFICE_API_PREFIX.test(requestUrl.pathname);
}

async function nodeRequestToWebRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const method = req.method || "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Request(url, {
    method,
    headers,
    body: Buffer.concat(chunks),
  });
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

export async function handleTinyOfficeApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  app: Hono,
): Promise<boolean> {
  if (!isTinyOfficeApiRequest(req.url)) {
    return false;
  }
  const response = await app.fetch(await nodeRequestToWebRequest(req));
  await writeWebResponse(res, response);
  return true;
}
