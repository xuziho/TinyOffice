import { endCompanyPostgresPool, openConfiguredPostgresConnection } from "./postgres-runtime-connection.js";

export type UiLocalePreference = "system" | "en" | "zh-CN";
export type UserProfile = { schema: "tinyoffice-user-profile"; version: 4; id: string; displayName: string; avatarSeed: string; uiLocale: UiLocalePreference; initialized: boolean };

export async function loadUserPreferredCompanyId(input: { repoRoot: string; userId: string }): Promise<string | undefined> {
  const postgres = await openConfiguredPostgresConnection(input.repoRoot);
  if (!postgres) throw new Error("User profile requires PostgreSQL.");
  try {
    const rows = await postgres.client.query<{ current_company_id: string | null }>(
      "SELECT current_company_id FROM user_profiles WHERE user_id = $1",
      [input.userId],
    );
    return rows.rows[0]?.current_company_id ?? undefined;
  } finally { postgres.client.release(); await endCompanyPostgresPool(postgres.pool); }
}

export async function saveUserPreferredCompanyId(input: {
  repoRoot: string;
  userId: string;
  companyId: string;
  fallbackDisplayName?: string;
}): Promise<void> {
  const companyId = input.companyId.trim();
  if (!companyId) throw new Error("companyId is required");
  const postgres = await openConfiguredPostgresConnection(input.repoRoot);
  if (!postgres) throw new Error("User profile requires PostgreSQL.");
  try {
    await postgres.client.query(
      `INSERT INTO user_profiles (user_id, display_name, avatar_seed, current_company_id, created_at, updated_at)
VALUES ($1, $2, $1, $3, now(), now())
ON CONFLICT (user_id) DO UPDATE SET
  current_company_id = EXCLUDED.current_company_id,
  updated_at = now()`,
      [input.userId, input.fallbackDisplayName?.trim() || input.userId, companyId],
    );
  } finally { postgres.client.release(); await endCompanyPostgresPool(postgres.pool); }
}

export async function loadUserProfile(input: { repoRoot: string; userId: string; fallbackDisplayName?: string }): Promise<UserProfile> {
  const postgres = await openConfiguredPostgresConnection(input.repoRoot);
  if (!postgres) throw new Error("User profile requires PostgreSQL.");
  try {
    const rows = await postgres.client.query<{ display_name: string; avatar_seed: string; ui_locale: UiLocalePreference; profile_initialized_at: Date | null }>("SELECT display_name, avatar_seed, ui_locale, profile_initialized_at FROM user_profiles WHERE user_id = $1", [input.userId]);
    return { schema: "tinyoffice-user-profile", version: 4, id: input.userId, displayName: rows.rows[0]?.display_name ?? input.fallbackDisplayName ?? "", avatarSeed: rows.rows[0]?.avatar_seed ?? input.userId, uiLocale: rows.rows[0]?.ui_locale ?? "system", initialized: Boolean(rows.rows[0]?.profile_initialized_at) };
  } finally { postgres.client.release(); await endCompanyPostgresPool(postgres.pool); }
}

export async function saveUserProfile(input: { repoRoot: string; userId: string; displayName: unknown; avatarSeed: unknown; uiLocale: unknown }): Promise<UserProfile> {
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (!displayName || displayName.length > 80) throw new Error("Display name must be between 1 and 80 characters.");
  const avatarSeed = typeof input.avatarSeed === "string" ? input.avatarSeed.trim() : "";
  if (!avatarSeed || avatarSeed.length > 160) throw new Error("Avatar seed must be between 1 and 160 characters.");
  const uiLocale = normalizeUiLocale(input.uiLocale);
  const postgres = await openConfiguredPostgresConnection(input.repoRoot);
  if (!postgres) throw new Error("User profile requires PostgreSQL.");
  try {
    await postgres.client.query("BEGIN");
    await postgres.client.query(`INSERT INTO user_profiles (user_id, display_name, avatar_seed, ui_locale, profile_initialized_at, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now(), now()) ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, avatar_seed = EXCLUDED.avatar_seed, ui_locale = EXCLUDED.ui_locale, profile_initialized_at = COALESCE(user_profiles.profile_initialized_at, now()), updated_at = now()`, [input.userId, displayName, avatarSeed, uiLocale]);
    await postgres.client.query("UPDATE company_members SET display_name = $2, avatar_seed = $3, updated_at = now() WHERE id = $1", [input.userId, displayName, avatarSeed]);
    await postgres.client.query(`UPDATE auth_users SET name = $2, "updatedAt" = now() WHERE id = $1`, [input.userId, displayName]);
    await postgres.client.query("COMMIT");
    return { schema: "tinyoffice-user-profile", version: 4, id: input.userId, displayName, avatarSeed, uiLocale, initialized: true };
  } catch (error) { await postgres.client.query("ROLLBACK"); throw error; }
  finally { postgres.client.release(); await endCompanyPostgresPool(postgres.pool); }
}

function normalizeUiLocale(value: unknown): UiLocalePreference {
  if (value === "system" || value === "en" || value === "zh-CN") return value;
  throw new Error("UI locale must be system, en, or zh-CN.");
}
