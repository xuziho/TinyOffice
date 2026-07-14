import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { Pool, type PoolClient } from "pg";

import type {
  TinyOfficeAuthProvider,
  TinyOfficeAuthStatus,
  TinyOfficeCurrentUserSession,
} from "./tinyoffice-session.js";

const OWNER_EMAIL = "owner@tinyoffice.local";
const OWNER_FALLBACK_ID = "owner";

export interface TinyOfficeOwnerAuthConfig {
  repoRoot: string;
  databaseUrl: string;
  publicOrigin: string;
  rpId?: string;
  secret?: string;
}

export interface TinyOfficeOwnerAuthProvider extends TinyOfficeAuthProvider {
  bootstrapToken?: string;
  close(): Promise<void>;
}

export async function createTinyOfficeOwnerAuth(
  config: TinyOfficeOwnerAuthConfig,
): Promise<TinyOfficeOwnerAuthProvider> {
  const publicOrigin = normalizedOrigin(config.publicOrigin);
  const rpId = config.rpId?.trim() || new URL(publicOrigin).hostname;
  const pool = new Pool({ connectionString: config.databaseUrl });
  const secret = config.secret?.trim() || await loadOrCreateAuthSecret(config.repoRoot);
  let bootstrapToken = await ownerHasPasskey(pool) ? undefined : randomBytes(32).toString("base64url");

  async function resolveBootstrapOwner(context?: string | null) {
    if (!bootstrapToken || !constantTimeEqual(context, bootstrapToken)) {
      throw new Error("TinyOffice Owner bootstrap token is invalid or expired");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(821946523)");
      if (await ownerHasPasskey(client)) {
        bootstrapToken = undefined;
        throw new Error("TinyOffice Owner is already configured");
      }
      const owner = await ensureSingleOwnerUser(client);
      await client.query("COMMIT");
      return owner;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const auth = betterAuth({
    appName: "TinyOffice",
    baseURL: publicOrigin,
    basePath: "/api/auth",
    secret,
    trustedOrigins: [publicOrigin],
    database: pool,
    emailAndPassword: { enabled: false },
    user: { modelName: "auth_users" },
    session: {
      modelName: "auth_sessions",
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: { modelName: "auth_accounts" },
    verification: { modelName: "auth_verifications" },
    advanced: {
      cookiePrefix: "tinyoffice",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: publicOrigin.startsWith("https://"),
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
    },
    plugins: [
      passkey({
        rpID: rpId,
        rpName: "TinyOffice",
        origin: publicOrigin,
        schema: {
          passkey: { modelName: "auth_passkeys" },
        },
        registration: {
          requireSession: false,
          resolveUser: async ({ context }) => resolveBootstrapOwner(context),
          afterVerification: async ({ context }) => {
            await resolveBootstrapOwner(context);
            bootstrapToken = undefined;
          },
        },
      }),
    ],
  });

  return {
    get bootstrapToken() {
      return bootstrapToken;
    },
    async handle(request) {
      return auth.handler(request);
    },
    async resolveCurrentUser(request): Promise<TinyOfficeCurrentUserSession | undefined> {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user?.id) {
        return undefined;
      }
      return {
        userId: session.user.id,
        ...(session.user.name?.trim() ? { displayName: session.user.name.trim() } : {}),
        source: "owner-session",
      };
    },
    async status(request): Promise<TinyOfficeAuthStatus> {
      const [session, configured] = await Promise.all([
        auth.api.getSession({ headers: request.headers }),
        ownerHasPasskey(pool),
      ]);
      if (configured) {
        bootstrapToken = undefined;
      }
      return {
        schema: "tinyoffice-auth-status",
        version: 1,
        authenticated: Boolean(session?.user?.id),
        bootstrapRequired: !configured,
        ownerConfigured: configured,
      };
    },
    async close() {
      await pool.end();
    },
  };
}

async function ensureSingleOwnerUser(client: PoolClient): Promise<{ id: string; name: string; displayName: string }> {
  const existing = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM auth_users ORDER BY "createdAt" ASC LIMIT 2`,
  );
  if (existing.rows.length > 1) {
    throw new Error("TinyOffice supports exactly one authenticated Owner");
  }
  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id,
      name: existing.rows[0].name,
      displayName: existing.rows[0].name,
    };
  }

  const profiles = await client.query<{ user_id: string; display_name: string }>(
    `SELECT user_id, display_name FROM user_profiles ORDER BY updated_at DESC LIMIT 2`,
  );
  if (profiles.rows.length > 1) {
    throw new Error("Multiple user profiles exist; select the authoritative Owner before authentication bootstrap");
  }
  const ownerId = profiles.rows[0]?.user_id || OWNER_FALLBACK_ID;
  const ownerName = profiles.rows[0]?.display_name || "Owner";
  await client.query(
    `INSERT INTO auth_users (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, now(), now())`,
    [ownerId, ownerName, OWNER_EMAIL],
  );
  return { id: ownerId, name: ownerName, displayName: ownerName };
}

async function ownerHasPasskey(client: Pick<Pool, "query"> | PoolClient): Promise<boolean> {
  const result = await client.query<{ configured: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM auth_passkeys) AS configured`,
  );
  return result.rows[0]?.configured === true;
}

async function loadOrCreateAuthSecret(repoRoot: string): Promise<string> {
  const directory = path.join(repoRoot, ".runtime", "auth");
  const secretPath = path.join(directory, "owner-session-secret");
  try {
    const existing = (await readFile(secretPath, "utf8")).trim();
    if (existing.length >= 32) {
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(directory, { recursive: true });
  const secret = randomBytes(48).toString("base64url");
  await writeFile(secretPath, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  return secret;
}

function normalizedOrigin(value: string): string {
  const origin = new URL(value.trim()).origin;
  if (!origin.startsWith("http://localhost") && !origin.startsWith("https://")) {
    throw new Error("TinyOffice public origin must use HTTPS, except for localhost");
  }
  return origin;
}

function constantTimeEqual(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate) {
    return false;
  }
  const left = createHash("sha256").update(candidate).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}
