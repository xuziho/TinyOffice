import type { Hono } from "hono";
import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";
import { loadUserProfile, saveUserProfile } from "../../runtime/company-config/user-profile.js";

export function registerProfileRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  app.get("/api/tinyoffice/profile", async (c) => {
    if (!options.repoRoot) throw new Error("User profile requires repoRoot.");
    const user = api.currentUserFromRequest(c.req.raw);
    return api.jsonResponse(c, await loadUserProfile({ repoRoot: options.repoRoot, userId: user.userId, fallbackDisplayName: user.displayName }));
  });
  app.patch("/api/tinyoffice/profile", async (c) => {
    if (!options.repoRoot) throw new Error("User profile requires repoRoot.");
    const user = api.currentUserFromRequest(c.req.raw);
    const body = await api.readJsonBody(c) as { displayName?: unknown; avatarSeed?: unknown; uiLocale?: unknown; uiTheme?: unknown };
    return api.jsonResponse(c, await saveUserProfile({ repoRoot: options.repoRoot, userId: user.userId, displayName: body.displayName, avatarSeed: body.avatarSeed, uiLocale: body.uiLocale, uiTheme: body.uiTheme }));
  });
}
