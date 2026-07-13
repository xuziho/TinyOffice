import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listEmployeePrivateSkills,
  loadEmployeesAdminState,
  readEmployeePrivateSkill,
  runtimeModelSupportsImageInput,
  saveEmployeeAdminRecord,
  saveEmployeePrivateSkill,
} from "../../src/runtime/company-config/employees-admin.js";
import { companyEmployeesRootPath } from "../../src/runtime/company-config/company-paths.js";
import {
  openConfiguredPostgresConnection,
  endCompanyPostgresPool,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";

async function createEmployeesFixture() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-employees-config-"));
  const companyId = DEFAULT_COMPANY_ID;
  const employeesRootPath = companyEmployeesRootPath({ repoRoot, companyId });
  return { repoRoot, companyId, employeesRootPath };
}

test("runtime model image capability is derived from the PI model input contract", () => {
  const availableModels = [{
    provider: "openai-codex",
    id: "gpt-5.4",
    name: "GPT-5.4",
    reasoning: true,
    input: ["text", "image"],
    supportsImageInput: true,
  }, {
    provider: "openai-codex",
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    reasoning: true,
    input: ["text"],
    supportsImageInput: false,
  }];

  assert.equal(runtimeModelSupportsImageInput({
    runtime: { version: 1, modelProvider: "openai-codex", modelId: "gpt-5.4", thinkingLevel: "minimal" },
    availableModels,
  }), true);
  assert.equal(runtimeModelSupportsImageInput({
    runtime: { version: 1, modelProvider: "openai-codex", modelId: "gpt-5.3-codex-spark", thinkingLevel: "minimal" },
    availableModels,
  }), false);
});

test("employees admin saves core identity, resource policy, and explicit runtime model", async () => {
  const { repoRoot, companyId, employeesRootPath } = await createEmployeesFixture();

  const initial = await loadEmployeesAdminState({ repoRoot, companyId });
  assert.equal(Object.hasOwn(initial, "defaultModel"), false);

  const saved = await saveEmployeeAdminRecord({
    employeesRootPath,
    repoRoot,
    companyId,
    employeeId: "mira-hr",
    profile: {
      employeeId: "mira-hr",
      role: "people",
      displayName: "Mira People",
      presenceMode: "auto_exit_idle",
      sceneProfile: "Owns people operations and onboarding.",
    },
    resourcePolicy: {
      version: 1,
      filesystem: {
        ownWorkspace: "allow",
        otherEmployeeWorkspace: "allow",
        repo: "approval",
        secrets: "deny",
      },
    },
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "low",
    },
  });

  const employee = saved.employees.find((candidate) => candidate.employeeId === "mira-hr");
  assert.equal(Object.hasOwn(saved, "defaultModel"), false);
  if (employee) {
    assert.equal(employee.profile.role, "people");
    assert.equal(employee.profile.presenceMode, "auto_exit_idle");
    assert.equal(employee.profile.sceneProfile, "Owns people operations and onboarding.");
    assert.equal(employee.resourcePolicy.filesystem.repo, "approval");
    assert.equal(employee.runtime.modelProvider, "openai");
    assert.equal(employee.runtime.modelId, "gpt-5-codex");
    assert.equal(employee.runtime.thinkingLevel, "low");
  }
});

test("employees admin rejects a runtime model that is not present in the supplied PI registry", async () => {
  const { repoRoot, companyId } = await createEmployeesFixture();

  await assert.rejects(
    saveEmployeeAdminRecord({
      repoRoot,
      companyId,
      employeeId: "invalid-model-employee",
      profile: {
        employeeId: "invalid-model-employee",
        role: "analyst",
        displayName: "Invalid Model Employee",
        presenceMode: "resident",
      },
      resourcePolicy: { version: 1, ownWorkspace: "allow", otherEmployeeWorkspace: "approval", repo: "approval", secrets: "deny" },
      runtime: { version: 1, modelProvider: "openai", modelId: "retired-model", thinkingLevel: "minimal" },
      availableModels: [{
        provider: "openai-codex",
        id: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
        input: ["text"],
        supportsImageInput: false,
      }],
    }),
    /runtime model openai\/retired-model is not available/,
  );
});

test("employees admin saves product identity without Mattermost account mapping", async () => {
  const { repoRoot, companyId } = await createEmployeesFixture();

  const saved = await saveEmployeeAdminRecord({
    repoRoot,
    companyId,
    employeeId: "carrier-free",
    profile: {
      employeeId: "carrier-free",
      role: "operations",
      displayName: "Carrier Free",
      presenceMode: "resident",
    },
    resourcePolicy: {
      version: 1,
      filesystem: {
        ownWorkspace: "allow",
        otherEmployeeWorkspace: "approval",
        repo: "approval",
        secrets: "deny",
      },
    },
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "medium",
    },
  });

  const employee = saved.employees.find((candidate) => candidate.employeeId === "carrier-free");
  assert.equal(employee?.profile.displayName, "Carrier Free");
  assert.equal(Object.hasOwn(employee || {}, "mattermost"), false);

  const postgres = await openConfiguredPostgresConnection(repoRoot);
  assert(postgres);
  try {
    const tables = await postgres.client.query(
      `SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('employee_mattermost_accounts', 'company_mattermost_bindings')`,
    );
    assert.deepEqual(tables.rows, []);
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
});

test("employees admin reads and writes only the selected company employees", async () => {
  const { repoRoot } = await createEmployeesFixture();
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

  await saveEmployeeAdminRecord({
    repoRoot,
    companyId: otherCompanyId,
    employeeId: "mira-hr",
    profile: {
      employeeId: "mira-hr",
      role: "acme-people",
      displayName: "Acme Mira",
      presenceMode: "resident",
    },
    resourcePolicy: {
      version: 1,
      filesystem: {
        ownWorkspace: "allow",
        otherEmployeeWorkspace: "allow",
        repo: "approval",
        secrets: "deny",
      },
    },
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "low",
    },
  });

  const defaultState = await loadEmployeesAdminState({ repoRoot, companyId: DEFAULT_COMPANY_ID });
  const otherState = await loadEmployeesAdminState({ repoRoot, companyId: otherCompanyId });
  const defaultMira = defaultState.employees.find((employee) => employee.employeeId === "mira-hr");
  const otherMira = otherState.employees.find((employee) => employee.employeeId === "mira-hr");
  assert.notEqual(defaultMira?.profile.displayName, "Acme Mira");
  assert.equal(Object.hasOwn(defaultMira || {}, "mattermost"), false);
  assert.equal(otherMira?.profile.displayName, "Acme Mira");
  assert.equal(Object.hasOwn(otherMira || {}, "mattermost"), false);
  assert.equal(
    otherMira?.localAssets?.workspacePath,
    path.join(repoRoot, "companies", otherCompanyId, "employees", "mira-hr", "workspace"),
  );
});

test("employees admin exposes and saves the fixed employee AGENTS.md instruction asset", async () => {
  const { repoRoot, companyId, employeesRootPath } = await createEmployeesFixture();
  const employeeHomePath = path.join(employeesRootPath, "mira-hr");
  const workspacePath = path.join(employeeHomePath, "workspace");
  const employeeAgentsPath = path.join(employeeHomePath, "AGENTS.md");
  const workspaceClaudePath = path.join(workspacePath, "CLAUDE.md");
  const employeeSkillsPath = path.join(employeeHomePath, "skills", "mira-playbook");

  await mkdir(employeeSkillsPath, { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(employeeAgentsPath, "Original employee home guidance.", "utf8");
  await writeFile(workspaceClaudePath, "Workspace operating guidance.", "utf8");

  await saveEmployeeAdminRecord({
    employeesRootPath,
    repoRoot,
    companyId,
    employeeId: "mira-hr",
    profile: {
      employeeId: "mira-hr",
      role: "people",
      displayName: "Mira People",
      presenceMode: "resident",
    },
    resourcePolicy: {
      version: 1,
      filesystem: {
        ownWorkspace: "allow",
        otherEmployeeWorkspace: "allow",
        repo: "approval",
        secrets: "deny",
      },
    },
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "low",
    },
  });

  const loaded = await loadEmployeesAdminState({ repoRoot, companyId });
  const employee = loaded.employees.find((candidate) => candidate.employeeId === "mira-hr");
  assert(employee);
  const localAssets = employee.localAssets;
  assert(localAssets);
  assert.equal(localAssets.homePath, employeeHomePath);
  assert.equal(localAssets.workspacePath, workspacePath);
  assert.deepEqual(localAssets.skillPaths, [path.join(employeeHomePath, "skills")]);
  assert.deepEqual(
    localAssets.instructionFiles.map((file) => ({
      location: file.location,
      name: file.name,
      path: file.path,
      relativePath: file.relativePath,
      exists: file.exists,
      editable: file.editable,
      content: file.content,
    })),
    [
      {
        location: "employee_home",
        name: "AGENTS.md",
        path: employeeAgentsPath,
        relativePath: "AGENTS.md",
        exists: true,
        editable: true,
        content: "Original employee home guidance.",
      },
    ],
  );

  await saveEmployeeAdminRecord({
    employeesRootPath,
    repoRoot,
    companyId,
    employeeId: "mira-hr",
    profile: {
      employeeId: "mira-hr",
      role: "people",
      displayName: "Mira People",
      presenceMode: "resident",
    },
    resourcePolicy: employee.resourcePolicy,
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "medium",
    },
    instructionFiles: [
      {
        path: employeeAgentsPath,
        content: "Updated employee work style, reporting expectations, and long-term guidance.",
      },
    ],
  });

  assert.equal(
    await readFile(employeeAgentsPath, "utf8"),
    "Updated employee work style, reporting expectations, and long-term guidance.\n",
  );
  assert.equal(await readFile(workspaceClaudePath, "utf8"), "Workspace operating guidance.");
});

test("employees admin exposes missing employee AGENTS.md as a creatable target only", async () => {
  const { repoRoot, companyId, employeesRootPath } = await createEmployeesFixture();
  const employeeHomePath = path.join(employeesRootPath, "mira-hr");
  const workspacePath = path.join(employeeHomePath, "workspace");
  const employeeAgentsPath = path.join(employeeHomePath, "AGENTS.md");
  await mkdir(workspacePath, { recursive: true });
  await writeFile(path.join(employeeHomePath, "CLAUDE.md"), "Home Claude guidance should be ignored.", "utf8");
  await writeFile(path.join(workspacePath, "AGENTS.md"), "Workspace AGENTS guidance should be ignored.", "utf8");

  await saveEmployeeAdminRecord({
    employeesRootPath,
    repoRoot,
    companyId,
    employeeId: "mira-hr",
    profile: {
      employeeId: "mira-hr",
      role: "people",
      displayName: "Mira People",
      presenceMode: "resident",
    },
    resourcePolicy: {
      version: 1,
      filesystem: {
        ownWorkspace: "allow",
        otherEmployeeWorkspace: "allow",
        repo: "approval",
        secrets: "deny",
      },
    },
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "low",
    },
  });

  const loaded = await loadEmployeesAdminState({ repoRoot, companyId });
  const employee = loaded.employees.find((candidate) => candidate.employeeId === "mira-hr");
  assert(employee?.localAssets);
  assert.deepEqual(
    employee.localAssets.instructionFiles.map((file) => ({
      location: file.location,
      name: file.name,
      path: file.path,
      relativePath: file.relativePath,
      exists: file.exists,
      editable: file.editable,
      content: file.content,
    })),
    [
      {
        location: "employee_home",
        name: "AGENTS.md",
        path: employeeAgentsPath,
        relativePath: "AGENTS.md",
        exists: false,
        editable: true,
        content: "",
      },
    ],
  );

  await assert.rejects(
    () => saveEmployeeAdminRecord({
      employeesRootPath,
      repoRoot,
      companyId,
      employeeId: "mira-hr",
      profile: {
        employeeId: "mira-hr",
        role: "people",
        displayName: "Mira People",
        presenceMode: "resident",
      },
      resourcePolicy: employee.resourcePolicy,
      runtime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-codex",
        thinkingLevel: "medium",
      },
      instructionFiles: [
        {
          path: path.join(workspacePath, "AGENTS.md"),
          content: "Do not save workspace guidance through Employee Config.",
        },
      ],
    }),
    /instructionFiles\.path must target the selected employee's company-scoped AGENTS\.md file/,
  );
});

test("employees admin reads and saves existing employee-private skill files", async () => {
  const { repoRoot, companyId, employeesRootPath } = await createEmployeesFixture();
  const skillRootPath = path.join(employeesRootPath, "mira-hr", "skills");
  const weeklySkillPath = path.join(skillRootPath, "weekly-audit", "SKILL.md");
  await mkdir(path.dirname(weeklySkillPath), { recursive: true });
  await mkdir(path.join(skillRootPath, "draft-without-skill-file"), { recursive: true });
  const initialSkill = [
    "---",
    "name: weekly-audit",
    "description: Audit weekly operations.",
    "---",
    "",
    "# Weekly Audit",
    "",
    "Audit weekly operations.",
    "",
  ].join("\n");
  await writeFile(weeklySkillPath, initialSkill, "utf8");

  const listed = await listEmployeePrivateSkills({ repoRoot, companyId, memberId: "mira-hr" });
  assert.equal(listed.schema, "employee-private-skills");
  assert.equal(listed.companyId, companyId);
  assert.equal(listed.memberId, "mira-hr");
  assert.equal(listed.skillsRootPath, skillRootPath);
  assert.deepEqual(
    listed.skills.map((skill) => ({
      skillId: skill.skillId,
      name: skill.name,
      path: skill.path,
      relativePath: skill.relativePath,
      exists: skill.exists,
    })),
    [{
      skillId: "weekly-audit",
      name: "weekly-audit",
      path: weeklySkillPath,
      relativePath: "weekly-audit/SKILL.md",
      exists: true,
    }],
  );

  const loaded = await readEmployeePrivateSkill({ repoRoot, companyId, memberId: "mira-hr", skillId: "weekly-audit" });
  assert.equal(loaded.schema, "employee-private-skill");
  assert.equal(loaded.content, initialSkill);
  assert.equal(loaded.editable, true);

  const updatedSkill = initialSkill.replace("Audit weekly operations.\n", "Updated weekly audit checklist.\n");
  const saved = await saveEmployeePrivateSkill({
    repoRoot,
    companyId,
    memberId: "mira-hr",
    skillId: "weekly-audit",
    content: updatedSkill,
  });
  assert.match(saved.content, /Updated weekly audit checklist/);
  assert.equal(await readFile(weeklySkillPath, "utf8"), saved.content);

  await assert.rejects(
    () => saveEmployeePrivateSkill({
      repoRoot,
      companyId,
      memberId: "mira-hr",
      skillId: "weekly-audit",
      content: "# Missing frontmatter",
    }),
    /SKILL\.md must begin with YAML frontmatter/,
  );

  await assert.rejects(
    () => readEmployeePrivateSkill({ repoRoot, companyId, memberId: "mira-hr", skillId: "../secrets" }),
    (error: unknown) => error instanceof Error
      && /Invalid employee private skill id/.test(error.message)
      && (error as { statusCode?: number }).statusCode === 400,
  );
});

test("employees admin rejects saves without an explicit runtime model", async () => {
  const { repoRoot, companyId } = await createEmployeesFixture();

  await assert.rejects(
    () => saveEmployeeAdminRecord({
      repoRoot,
      companyId,
      employeeId: "mira-hr",
      profile: {
        employeeId: "mira-hr",
        role: "people",
        displayName: "Mira People",
        presenceMode: "resident",
      },
      resourcePolicy: {
        version: 1,
        filesystem: {
          ownWorkspace: "allow",
          otherEmployeeWorkspace: "allow",
          repo: "approval",
          secrets: "deny",
        },
      },
      runtime: {
        version: 1,
        modelProvider: "",
        modelId: "",
        thinkingLevel: "low",
      },
    }),
    /runtime\.modelProvider and runtime\.modelId are required/,
  );
});
