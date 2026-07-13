import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { recruitEmployee } from "../../src/runtime/company-config/recruit-employee.js";
import { companyEmployeeHomePath } from "../../src/runtime/company-config/company-paths.js";
import { loadEmployeesAdminState } from "../../src/runtime/company-config/employees-admin.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";

async function createRecruitFixture(companyId = "acme") {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-recruit-"));
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  assert(postgres);
  try {
    await postgres.client.query(
      `INSERT INTO companies (company_id, display_name, created_at, updated_at)
VALUES ($1, $2, NOW(), NOW())`,
      [companyId, "Acme"],
    );
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
  return { repoRoot, companyId };
}

test("recruit employee creates a runtime-capable company employee with local assets", async () => {
  const { repoRoot, companyId } = await createRecruitFixture();

  const result = await recruitEmployee({
    repoRoot,
    companyId,
    employeeId: "nora-ops",
    displayName: "Nora Ops",
    role: "operations",
    summary: "Runs internal operations checks.",
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "medium",
    },
  });

  assert.equal(result.companyId, companyId);
  assert.equal(result.employee.employeeId, "nora-ops");
  assert.equal(result.employee.profile.displayName, "Nora Ops");
  assert.equal(result.employee.profile.role, "operations");
  assert.equal(result.employee.profile.presenceMode, "resident");
  assert.equal(result.employee.resourcePolicy.filesystem.ownWorkspace, "allow");
  assert.equal(result.employee.resourcePolicy.filesystem.otherEmployeeWorkspace, "approval");
  assert.equal(result.employee.resourcePolicy.filesystem.repo, "approval");
  assert.equal(result.employee.runtime.modelProvider, "openai");
  assert.equal(result.employee.runtime.modelId, "gpt-5-codex");
  assert.equal(result.employee.runtime.thinkingLevel, "medium");

  const homePath = companyEmployeeHomePath({ repoRoot, companyId, employeeId: "nora-ops" });
  assert.equal(result.localAssets.homePath, homePath);
  await stat(path.join(homePath, "workspace"));
  await stat(path.join(homePath, "skills"));
  const instructionContent = await readFile(path.join(homePath, "AGENTS.md"), "utf8");
  assert.match(instructionContent, /Personal Operating Guidance/);
  assert.doesNotMatch(instructionContent, /Role: operations/);
  assert.doesNotMatch(instructionContent, /Responsibility: Runs internal operations checks\./);
  assert.match(await readFile(path.join(homePath, "workspace", "README.md"), "utf8"), /Nora Ops Workspace/);

  const state = await loadEmployeesAdminState({ repoRoot, companyId });
  const employee = state.employees.find((candidate) => candidate.employeeId === "nora-ops");
  assert.equal(employee?.profile.displayName, "Nora Ops");
  assert.equal(employee?.localAssets?.instructionFiles[0]?.exists, true);
});

test("recruit employee derives a unique employee id from display name when omitted", async () => {
  const { repoRoot, companyId } = await createRecruitFixture("derived");

  const first = await recruitEmployee({
    repoRoot,
    companyId,
    displayName: "Iris Growth",
    role: "growth",
    summary: "Runs growth experiments.",
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "medium",
    },
  });
  const second = await recruitEmployee({
    repoRoot,
    companyId,
    displayName: "Iris Growth",
    role: "growth",
    summary: "Runs a second growth lane.",
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "medium",
    },
  });

  assert.equal(first.employee.employeeId, "iris-growth");
  assert.equal(second.employee.employeeId, "iris-growth-2");
});

test("recruit employee rejects incomplete runtime model configuration", async () => {
  const { repoRoot, companyId } = await createRecruitFixture("globex");

  await assert.rejects(
    () => recruitEmployee({
      repoRoot,
      companyId,
      employeeId: "iris-growth",
      displayName: "Iris Growth",
      role: "growth",
      summary: "Runs growth experiments.",
      runtime: {
        version: 1,
        modelProvider: "openai",
        modelId: "",
        thinkingLevel: "low",
      },
    }),
    /runtime\.modelProvider and runtime\.modelId are required/,
  );
});
