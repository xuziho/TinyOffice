import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export async function serveTinyOfficeStaticWeb(
  request: IncomingMessage,
  response: ServerResponse,
  webRoot: string,
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
  if (requestUrl.pathname.startsWith("/api/") || requestUrl.pathname === "/health" || requestUrl.pathname === "/ready") return false;

  const root = path.resolve(webRoot);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestUrl.pathname);
  } catch {
    return false;
  }
  const relativePath = decodedPath === "/"
    ? "index.html"
    : decodedPath.replace(/^\/+/, "");
  let filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return false;

  try {
    if (!(await stat(filePath)).isFile()) throw new Error("not a file");
  } catch {
    filePath = path.join(root, "index.html");
  }

  try {
    const body = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader("content-type", contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
    response.setHeader("cache-control", path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable");
    response.setHeader("content-length", body.byteLength);
    response.end(request.method === "HEAD" ? undefined : body);
    return true;
  } catch {
    return false;
  }
}
