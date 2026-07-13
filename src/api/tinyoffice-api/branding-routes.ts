import type { Hono } from "hono";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

const MIME_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function registerBrandingRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  app.get("/api/companies/:companyId/branding", async (c) => {
    const companyId = api.companyIdFromContext(c);
    const file = await logoFile(options, companyId);
    return api.jsonResponse(c, { schema: "tinyoffice-company-branding", version: 1, companyId, ...(file ? { logoUrl: `/api/companies/${encodeURIComponent(companyId)}/branding/logo` } : {}) });
  });
  app.post("/api/companies/:companyId/branding/logo", async (c) => {
    const companyId = api.companyIdFromContext(c);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Company logo file is required.");
    const extension = MIME_EXTENSIONS[file.type];
    if (!extension) throw new Error("Company logo must be PNG, JPEG, or WebP.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Company logo must be 5 MB or smaller.");
    const directory = brandingDirectory(options, companyId);
    await mkdir(directory, { recursive: true });
    await removeExistingLogos(directory);
    const target = path.join(directory, `logo.${extension}`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, target);
    return api.jsonResponse(c, { schema: "tinyoffice-company-branding", version: 1, companyId, logoUrl: `/api/companies/${encodeURIComponent(companyId)}/branding/logo` }, 201);
  });
  app.delete("/api/companies/:companyId/branding/logo", async (c) => {
    const companyId = api.companyIdFromContext(c);
    await removeExistingLogos(brandingDirectory(options, companyId));
    return api.jsonResponse(c, { schema: "tinyoffice-company-branding", version: 1, companyId });
  });
  app.get("/api/companies/:companyId/branding/logo", async (c) => {
    const companyId = api.companyIdFromContext(c);
    const file = await logoFile(options, companyId);
    if (!file) return c.text("Company logo not found", 404);
    const extension = path.extname(file).slice(1);
    const mime = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    const bytes = await readFile(file);
    return new Response(bytes, { headers: { "content-type": mime, "cache-control": "no-cache" } });
  });
}

function brandingDirectory(options: TinyOfficeApiOptions, companyId: string): string {
  if (!options.repoRoot) throw new Error("Company branding requires repoRoot.");
  return path.join(options.repoRoot, "companies", companyId, "branding");
}
async function logoFile(options: TinyOfficeApiOptions, companyId: string): Promise<string | undefined> {
  const directory = brandingDirectory(options, companyId);
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
  const name = files.find((item) => /^logo\.(png|jpg|webp)$/.test(item));
  return name ? path.join(directory, name) : undefined;
}
async function removeExistingLogos(directory: string): Promise<void> {
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
  await Promise.all(files.filter((item) => /^logo\.(png|jpg|webp)$/.test(item)).map((item) => rm(path.join(directory, item), { force: true })));
}
