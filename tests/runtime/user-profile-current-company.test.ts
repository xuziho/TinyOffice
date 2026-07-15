import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";

import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";
import {
  loadUserPreferredCompanyId,
  loadUserProfile,
  saveUserProfile,
  saveUserPreferredCompanyId,
} from "../../src/runtime/company-config/user-profile.js";
import { createCompanyWithoutCarrier } from "../../src/runtime/company-config/companies-admin.js";
import { resetRuntimePostgresTables } from "./postgres-test-utils.js";

beforeEach(resetRuntimePostgresTables);

test("a clean Owner profile remains explicitly uninitialized until it is saved", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-user-onboarding-"));
  const initial = await loadUserProfile({ repoRoot, userId: "owner-1", fallbackDisplayName: "Owner" });
  assert.equal(initial.initialized, false);
  assert.equal(initial.displayName, "Owner");
  assert.equal(initial.uiLocale, "system");

  const saved = await saveUserProfile({ repoRoot, userId: "owner-1", displayName: "Xu Ziho", avatarSeed: "owner-avatar", uiLocale: "zh-CN" });
  assert.equal(saved.initialized, true);
  assert.equal(saved.uiLocale, "zh-CN");
  assert.equal((await loadUserProfile({ repoRoot, userId: "owner-1" })).displayName, "Xu Ziho");
});

test("first Company creation inherits the initialized Owner profile identity", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-owner-company-"));
  await saveUserProfile({
    repoRoot,
    userId: "owner-1",
    displayName: "Xu Ziho",
    avatarSeed: "chosen-owner-avatar",
    uiLocale: "system",
  });

  const created = await createCompanyWithoutCarrier({
    repoRoot,
    companyId: "acme",
    displayName: "Acme",
    ownerMemberId: "owner-1",
    ownerDisplayName: "Stale Auth Name",
    hrEmployeeDisplayName: "Mira",
  });

  assert.equal(created.owner?.displayName, "Xu Ziho");
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  assert.ok(postgres);
  try {
    const member = await postgres.client.query<{ display_name: string; avatar_seed: string }>(
      "SELECT display_name, avatar_seed FROM company_members WHERE company_id = 'acme' AND id = 'owner-1'",
    );
    assert.deepEqual(member.rows[0], {
      display_name: "Xu Ziho",
      avatar_seed: "chosen-owner-avatar",
    });
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
});

test("current Company selection persists in the user profile and clears when the Company is deleted", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-user-current-company-"));
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  assert.ok(postgres);
  try {
    await postgres.client.query(
      `INSERT INTO companies (company_id, display_name, created_at, updated_at)
VALUES ('acme', 'Acme', now(), now())`,
    );
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }

  await saveUserPreferredCompanyId({
    repoRoot,
    userId: "xuziho",
    companyId: "acme",
    fallbackDisplayName: "Xu Ziho",
  });
  assert.equal(await loadUserPreferredCompanyId({ repoRoot, userId: "xuziho" }), "acme");

  const deletion = await openConfiguredPostgresConnection(repoRoot);
  assert.ok(deletion);
  try {
    await deletion.client.query("DELETE FROM companies WHERE company_id = 'acme'");
  } finally {
    deletion.client.release();
    await endCompanyPostgresPool(deletion.pool);
  }
  assert.equal(await loadUserPreferredCompanyId({ repoRoot, userId: "xuziho" }), undefined);
});

test("user avatar persists in the account profile and synchronizes the user's company member identity", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-user-avatar-"));
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  assert.ok(postgres);
  try {
    await postgres.client.query(`INSERT INTO companies (company_id, display_name, created_at, updated_at) VALUES ('acme', 'Acme', now(), now())`);
    await postgres.client.query(`INSERT INTO company_members (company_id, id, display_name, role, summary, avatar_seed, created_at, updated_at) VALUES ('acme', 'xuziho', 'Xu Ziho', 'boss', NULL, 'xuziho', now(), now())`);
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }

  const saved = await saveUserProfile({ repoRoot, userId: "xuziho", displayName: "Xu Ziho", avatarSeed: "chosen-avatar", uiLocale: "en" });
  assert.equal(saved.avatarSeed, "chosen-avatar");
  assert.equal((await loadUserProfile({ repoRoot, userId: "xuziho" })).avatarSeed, "chosen-avatar");

  const verification = await openConfiguredPostgresConnection(repoRoot);
  assert.ok(verification);
  try {
    const member = await verification.client.query<{ avatar_seed: string }>("SELECT avatar_seed FROM company_members WHERE company_id = 'acme' AND id = 'xuziho'");
    assert.equal(member.rows[0]?.avatar_seed, "chosen-avatar");
  } finally {
    verification.client.release();
    await endCompanyPostgresPool(verification.pool);
  }
});
