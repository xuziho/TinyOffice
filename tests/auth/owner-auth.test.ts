import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createTinyOfficeOwnerAuth } from "../../src/auth/better-auth-owner.js";
import { defaultRuntimePostgresTestDatabaseUrl, resetRuntimePostgresTables } from "../runtime/postgres-test-utils.js";

test("single-Owner auth starts with a private one-time passkey bootstrap", async () => {
  const databaseUrl = process.env.TINYOFFICE_TEST_DATABASE_URL?.trim() || defaultRuntimePostgresTestDatabaseUrl;
  process.env.TINYOFFICE_DATABASE_URL = databaseUrl;
  await resetRuntimePostgresTables();
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-owner-auth-"));
  const provider = await createTinyOfficeOwnerAuth({
    repoRoot,
    databaseUrl,
    publicOrigin: "http://localhost:5175",
    secret: "test-only-owner-auth-secret-that-is-long-enough",
  });
  try {
    assert.ok(provider.bootstrapToken);
    const request = new Request("http://localhost:5175/api/tinyoffice/auth/status");
    const status = await provider.status(request);
    assert.deepEqual(status, {
      schema: "tinyoffice-auth-status",
      version: 1,
      authenticated: false,
      bootstrapRequired: true,
      ownerConfigured: false,
    });
    assert.equal(JSON.stringify(status).includes(provider.bootstrapToken ?? "unreachable"), false);
    assert.equal(await provider.resolveCurrentUser(request), undefined);

    const options = await provider.handle(new Request(
      `http://localhost:5175/api/auth/passkey/generate-register-options?name=Primary%20Owner%20passkey&context=${encodeURIComponent(provider.bootstrapToken ?? "")}`,
      { headers: { Origin: "http://localhost:5175" } },
    ));
    assert.equal(options.status, 200);
    const registration = await options.json() as { challenge?: string; user?: { name?: string } };
    assert.ok(registration.challenge);
    assert.equal(registration.user?.name, "Primary Owner passkey");
  } finally {
    await provider.close();
  }
});

test("Owner auth rejects insecure non-local public origins", async () => {
  const databaseUrl = process.env.TINYOFFICE_TEST_DATABASE_URL?.trim() || defaultRuntimePostgresTestDatabaseUrl;
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-owner-auth-origin-"));
  await assert.rejects(
    () => createTinyOfficeOwnerAuth({
      repoRoot,
      databaseUrl,
      publicOrigin: "http://tinyoffice.example.com",
      secret: "test-only-owner-auth-secret-that-is-long-enough",
    }),
    /must use HTTPS, except for localhost/,
  );
});
