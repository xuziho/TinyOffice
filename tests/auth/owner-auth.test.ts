import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createTinyOfficeOwnerAuth } from "../../src/auth/better-auth-owner.js";
import { defaultRuntimePostgresTestDatabaseUrl, resetRuntimePostgresTables } from "../runtime/postgres-test-utils.js";

const TEST_SECRET = "test-only-owner-auth-secret-that-is-long-enough";

test("local Owner access exchanges a private one-time ticket for the standard session", async () => {
  const databaseUrl = testDatabaseUrl();
  await resetRuntimePostgresTables();
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-owner-auth-local-"));
  const provider = await createTinyOfficeOwnerAuth({
    repoRoot,
    databaseUrl,
    publicOrigin: "http://localhost:5175",
    secret: TEST_SECRET,
  });
  try {
    assert.ok(provider.localAccessTicket);
    assert.equal(provider.bootstrapToken, undefined);
    const statusRequest = new Request("http://localhost:5175/api/tinyoffice/auth/status");
    assert.deepEqual(await provider.status(statusRequest), {
      schema: "tinyoffice-auth-status",
      version: 2,
      accessMode: "local",
      authenticated: false,
      bootstrapRequired: false,
      ownerConfigured: false,
      passkeyConfigured: false,
    });

    const ticket = provider.localAccessTicket;
    const exchange = await provider.handle(new Request(
      "http://localhost:5175/api/auth/tinyoffice/local-owner-access",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:5175" },
        body: JSON.stringify({ ticket }),
      },
    ));
    assert.equal(exchange.status, 200);
    assert.equal(provider.localAccessTicket, undefined);
    const cookie = exchange.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);

    const authenticatedRequest = new Request("http://localhost:5175/api/tinyoffice/auth/status", {
      headers: { Cookie: cookie },
    });
    assert.equal((await provider.status(authenticatedRequest)).authenticated, true);
    assert.deepEqual(await provider.resolveCurrentUser(authenticatedRequest), {
      userId: "owner",
      displayName: "Owner",
      profileInitialized: false,
      source: "owner-session",
    });

    const reused = await provider.handle(new Request(
      "http://localhost:5175/api/auth/tinyoffice/local-owner-access",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:5175" },
        body: JSON.stringify({ ticket }),
      },
    ));
    assert.equal(reused.status, 401);
    assert.equal((await reused.json() as { code?: string }).code, "LOCAL_OWNER_ACCESS_INVALID");
  } finally {
    await provider.close();
  }
});

test("remote Owner auth uses private Passkey bootstrap and rejects local access", async () => {
  const databaseUrl = testDatabaseUrl();
  await resetRuntimePostgresTables();
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-owner-auth-remote-"));
  const provider = await createTinyOfficeOwnerAuth({
    repoRoot,
    databaseUrl,
    publicOrigin: "https://office.example.com",
    secret: TEST_SECRET,
  });
  try {
    assert.ok(provider.bootstrapToken);
    assert.equal(provider.localAccessTicket, undefined);
    const status = await provider.status(new Request("https://office.example.com/api/tinyoffice/auth/status"));
    assert.deepEqual(status, {
      schema: "tinyoffice-auth-status",
      version: 2,
      accessMode: "remote",
      authenticated: false,
      bootstrapRequired: true,
      ownerConfigured: false,
      passkeyConfigured: false,
    });
    assert.equal(JSON.stringify(status).includes(provider.bootstrapToken ?? "unreachable"), false);

    const invalidBootstrap = await provider.handle(new Request(
      "https://office.example.com/api/auth/passkey/generate-register-options?name=Primary%20Owner%20passkey&context=wrong",
      { headers: { Origin: "https://office.example.com" } },
    ));
    assert.equal(invalidBootstrap.status, 401);
    assert.equal((await invalidBootstrap.json() as { code?: string }).code, "OWNER_BOOTSTRAP_INVALID");

    const options = await provider.handle(new Request(
      `https://office.example.com/api/auth/passkey/generate-register-options?name=Primary%20Owner%20passkey&context=${encodeURIComponent(provider.bootstrapToken ?? "")}`,
      { headers: { Origin: "https://office.example.com" } },
    ));
    assert.equal(options.status, 200);
    const registration = await options.json() as { challenge?: string; user?: { name?: string } };
    assert.ok(registration.challenge);
    assert.equal(registration.user?.name, "Primary Owner passkey");

    const localAccess = await provider.handle(new Request(
      "https://office.example.com/api/auth/tinyoffice/local-owner-access",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://office.example.com" },
        body: JSON.stringify({ ticket: "not-available-remotely" }),
      },
    ));
    assert.equal(localAccess.status, 403);
    assert.equal((await localAccess.json() as { code?: string }).code, "LOCAL_OWNER_ACCESS_DISABLED");
  } finally {
    await provider.close();
  }
});

test("Owner auth rejects insecure and lookalike non-local public origins", async () => {
  const databaseUrl = testDatabaseUrl();
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-owner-auth-origin-"));
  for (const publicOrigin of ["http://tinyoffice.example.com", "http://localhost.example.com"]) {
    await assert.rejects(
      () => createTinyOfficeOwnerAuth({ repoRoot, databaseUrl, publicOrigin, secret: TEST_SECRET }),
      /must use HTTPS, except for localhost/,
    );
  }
});

function testDatabaseUrl(): string {
  const databaseUrl = process.env.TINYOFFICE_TEST_DATABASE_URL?.trim() || defaultRuntimePostgresTestDatabaseUrl;
  process.env.TINYOFFICE_DATABASE_URL = databaseUrl;
  return databaseUrl;
}
