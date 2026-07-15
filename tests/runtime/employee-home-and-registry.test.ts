import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  companyEmployeesRootPath,
} from "../../src/runtime/company-config/company-paths.js";
import {
  CompanyDirectoryRepository,
  type CompanyDirectoryEmployeeRecord,
} from "../../src/runtime/company-config/company-directory-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import {
  loadEmployeeHomes,
} from "../../src/runtime/registry/employee-home.js";

async function seedEmployeeHomes(
  repoRoot: string,
  records: Array<Pick<CompanyDirectoryEmployeeRecord, "employeeId" | "profile">>,
) {
  const repository = await CompanyDirectoryRepository.open(repoRoot, {
    companyId: DEFAULT_COMPANY_ID,
  });
  try {
    for (const record of records) {
      await repository.upsertEmployee({
        employeeId: record.employeeId,
        profile: record.profile,
        enabled: true,
        resourcePolicy: { version: 1 },
        runtime: {
          version: 1,
          modelProvider: "openai",
          modelId: "gpt-5-codex",
          thinkingLevel: "minimal",
        },
      });
    }
  } finally {
    repository.close();
  }
}

test("employee home runtime loader uses PostgreSQL Company Directory", async () => {
  const source = await readFile(
    path.resolve("src/runtime/registry/employee-home.ts"),
    "utf8",
  );

  assert.match(source, /CompanyDirectoryRepository/);
  assert.doesNotMatch(source, /profile\.json/);
  assert.doesNotMatch(source, /mattermost\.json/);
  assert.doesNotMatch(source, /resource-policy\.json/);
});

test("loads DB employees with workspace paths", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-employee-homes-"));
  const rootPath = companyEmployeesRootPath({
    repoRoot,
    companyId: DEFAULT_COMPANY_ID,
  });
  await seedEmployeeHomes(repoRoot, [
    {
      employeeId: "iris-growth",
      profile: {
        employeeId: "iris-growth",
        displayName: "Smoke Runtime Member",
        role: "growth",
        presenceMode: "resident",
      },
    },
    {
      employeeId: "mira-hr",
      profile: {
        employeeId: "mira-hr",
        displayName: "Mira HR",
        role: "hr",
        presenceMode: "resident",
      },
    },
    {
      employeeId: "nora-automation",
      profile: {
        employeeId: "nora-automation",
        displayName: "Nora Automation",
        role: "automation",
        presenceMode: "resident",
      },
    },
    {
      employeeId: "quality-editor",
      profile: {
        employeeId: "quality-editor",
        displayName: "Quality Editor",
        role: "quality",
        presenceMode: "resident",
      },
    },
  ]);

  const homes = await loadEmployeeHomes({ repoRoot, companyId: DEFAULT_COMPANY_ID });

  assert.equal(homes.length, 4);
  const iris = homes.find((home) => home.employeeId === "iris-growth");
  const nora = homes.find((home) => home.employeeId === "nora-automation");
  assert.equal(iris?.workspacePath, path.join(rootPath, "iris-growth", "workspace"));
  assert.equal(nora?.profile.presenceMode, "resident");
  assert.equal(Object.hasOwn(nora || {}, "mattermostAccount"), false);

  const workspacePiSettings = JSON.parse(
    await readFile(
      path.join(rootPath, "nora-automation", "workspace", ".pi", "settings.json"),
      "utf8",
    ),
  ) as { packages: string[] };
  assert.deepEqual(workspacePiSettings.packages, [
    "../../../../../../packages/pi-tool-guard",
    "../../../../../../packages/pi-web-tools",
    "../../../../../../packages/pi-context-harness",
  ]);
});
