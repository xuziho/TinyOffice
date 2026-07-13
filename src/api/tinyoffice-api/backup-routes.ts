import { readFile } from "node:fs/promises";
import type { Hono } from "hono";
import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerBackupRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  app.get("/api/tinyoffice/backups", async (c) => {
    api.currentUserFromRequest(c.req.raw, options.auth);
    if (!options.backupService) throw new Error("TinyOffice backup service is not configured.");
    return api.jsonResponse(c, await options.backupService.list());
  });
  app.post("/api/tinyoffice/backups", async (c) => {
    api.currentUserFromRequest(c.req.raw, options.auth);
    if (!options.backupService) throw new Error("TinyOffice backup service is not configured.");
    return api.jsonResponse(c, options.backupService.start(), 202);
  });
  app.get("/api/tinyoffice/backups/:backupId/download", async (c) => {
    api.currentUserFromRequest(c.req.raw, options.auth);
    if (!options.backupService) throw new Error("TinyOffice backup service is not configured.");
    const backup = await options.backupService.download(c.req.param("backupId"));
    return c.body(await readFile(backup.path), 200, {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${backup.fileName}"`,
      "Content-Length": String(backup.byteLength),
      "Cache-Control": "no-store",
    });
  });
}
