import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CompanyDirectoryRepository,
} from "../../src/runtime/company-config/company-directory-repository.js";
import {
  companyEmployeesRootPath,
} from "../../src/runtime/company-config/company-paths.js";
import {
  loadEmployeesAdminState,
} from "../../src/runtime/company-config/employees-admin.js";
import {
  openConfiguredPostgresConnection,
  endCompanyPostgresPool,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { loadEmployeeHomes } from "../../src/runtime/registry/employee-home.js";

test("company directory repository loads seeded employees from PostgreSQL", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-directory-"));

  const repository = await CompanyDirectoryRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    await repository.upsertEmployee({
      employeeId: "nora-automation",
      profile: {
        employeeId: "nora-automation",
        displayName: "Nora Automation",
        role: "automation",
        presenceMode: "resident",
      },
      enabled: true,
      resourcePolicy: { version: 1 },
      runtime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-codex",
        thinkingLevel: "minimal",
      },
    });
    const snapshot = await repository.loadSnapshot();
    assert.ok(snapshot.employees.length >= 1);
    const nora = snapshot.employees.find((employee) => employee.employeeId === "nora-automation");
    assert.equal(nora?.profile.role, "automation");
    assert.equal(Object.hasOwn(nora || {}, "mattermost"), false);
  } finally {
    repository.close();
  }
});

test("employees admin and employee homes read updates from PostgreSQL directory", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-directory-load-"));
  const employeesRootPath = companyEmployeesRootPath({
    repoRoot,
    companyId: DEFAULT_COMPANY_ID,
  });

  const repository = await CompanyDirectoryRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    await repository.upsertEmployee({
      employeeId: "iris-growth",
      profile: {
        employeeId: "iris-growth",
        presenceMode: "resident",
        role: "growth",
        displayName: "Iris From Directory",
      },
      enabled: true,
      resourcePolicy: { version: 1 },
      runtime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-codex",
        thinkingLevel: "medium",
      },
    });
    await repository.save();
  } finally {
    repository.close();
  }

  const homes = await loadEmployeeHomes({ repoRoot, companyId: DEFAULT_COMPANY_ID });
  const irisHome = homes.find((home) => home.employeeId === "iris-growth");
  assert.equal(irisHome?.profile.role, "growth");
  assert.equal(irisHome?.profile.displayName, "Iris From Directory");

  const adminState = await loadEmployeesAdminState({ repoRoot, companyId: DEFAULT_COMPANY_ID });
  const iris = adminState.employees.find((employee) => employee.employeeId === "iris-growth");
  assert.equal(iris?.runtime.modelId, "gpt-5-codex");
  assert.equal(iris?.runtime.thinkingLevel, "medium");
  assert.equal(iris?.profile.role, "growth");
  assert.equal(iris?.profile.displayName, "Iris From Directory");
});

test("inactive employee remains in admin history but is excluded from executable employee homes", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-directory-inactive-"));
  const repository = await CompanyDirectoryRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    await repository.upsertEmployee({
      employeeId: "inactive-lifecycle-test",
      profile: { employeeId: "inactive-lifecycle-test", displayName: "Lifecycle Test", role: "analyst", presenceMode: "resident" },
      enabled: true,
      resourcePolicy: { version: 1 },
      runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
    });
    await repository.setEmployeeEnabled("inactive-lifecycle-test", false);
  } finally {
    repository.close();
  }

  const admin = await loadEmployeesAdminState({ repoRoot, companyId: DEFAULT_COMPANY_ID });
  assert.equal(admin.employees.find((employee) => employee.employeeId === "inactive-lifecycle-test")?.enabled, false);
  assert.equal((await loadEmployeeHomes({ repoRoot, companyId: DEFAULT_COMPANY_ID })).some((home) => home.employeeId === "inactive-lifecycle-test"), false);

  const reactivated = await CompanyDirectoryRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    await reactivated.setEmployeeEnabled("inactive-lifecycle-test", true);
  } finally {
    reactivated.close();
  }
  assert.equal((await loadEmployeeHomes({ repoRoot, companyId: DEFAULT_COMPANY_ID })).some((home) => home.employeeId === "inactive-lifecycle-test"), true);
});

test("company directory repository scopes duplicate employee ids by company", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-directory-company-scope-"));
  const otherCompanyId = "acme";
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  assert(postgres);
  try {
    await postgres.client.query(
      `INSERT INTO companies (company_id, display_name, created_at, updated_at)
VALUES ($1, 'Acme', NOW(), NOW())
ON CONFLICT (company_id) DO NOTHING`,
      [otherCompanyId],
    );
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }

  const defaultRepository = await CompanyDirectoryRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  const otherRepository = await CompanyDirectoryRepository.open(repoRoot, { companyId: otherCompanyId });
  try {
    await defaultRepository.upsertEmployee({
      employeeId: "mira-hr",
      profile: {
        employeeId: "mira-hr",
        displayName: "Mira",
        role: "hr",
        presenceMode: "resident",
      },
      enabled: true,
      resourcePolicy: { version: 1 },
      runtime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-codex",
        thinkingLevel: "low",
      },
    });
    await otherRepository.upsertEmployee({
      employeeId: "mira-hr",
      profile: {
        employeeId: "mira-hr",
        displayName: "Acme Mira",
        role: "acme-people",
        presenceMode: "resident",
      },
      enabled: true,
      resourcePolicy: { version: 1 },
      runtime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-codex",
        thinkingLevel: "low",
      },
    });

    const defaultMiraAfter = (await defaultRepository.loadEmployees())
      .find((employee) => employee.employeeId === "mira-hr");
    const otherMira = (await otherRepository.loadEmployees())
      .find((employee) => employee.employeeId === "mira-hr");
    assert.equal(defaultMiraAfter?.profile.displayName, "Mira");
    assert.equal(defaultMiraAfter?.profile.role, "hr");
    assert.equal(otherMira?.profile.displayName, "Acme Mira");
    assert.equal(otherMira?.profile.role, "acme-people");
  } finally {
    defaultRepository.close();
    otherRepository.close();
  }
});
