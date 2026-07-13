import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadToolGuardAdminState,
  loadToolSafetyViewModel,
  previewToolSafetyDecision,
  saveToolGuardPolicy,
  TOOL_GUARD_POLICY_SOURCE,
} from "../../src/runtime/company-config/tool-guard-admin.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";

const TEST_COMPANY_ID = DEFAULT_COMPANY_ID;

test("access admin backend has focused module boundaries behind the public entry", async () => {
  const companyConfigDir = path.join(process.cwd(), "src", "runtime", "company-config");
  const expectedModules = [
    "access-policy.ts",
    "access-policy-persistence.ts",
    "access-safety-preview.ts",
    "access-view-model.ts",
  ];

  const entrySource = await readFile(path.join(companyConfigDir, "tool-guard-admin.ts"), "utf8");
  assert.ok(
    entrySource.split(/\r?\n/).length <= 140,
    "tool-guard-admin.ts should stay a thin public Access admin entry",
  );

  for (const moduleName of expectedModules) {
    const source = await readFile(path.join(companyConfigDir, moduleName), "utf8");
    assert.ok(source.trim().length > 0, `${moduleName} should own a focused Access backend concern`);
  }
});

test("access admin loads DB-backed policy shape", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "pi-tool-guard-admin-"));

  const state = await loadToolGuardAdminState(repoRoot, { companyId: TEST_COMPANY_ID });

  assert.equal(state.policy.version, 1);
  assert.ok(["allow", "ask", "deny"].includes(state.policy.cwdBoundaryReadMode));
  assert.ok(["allow", "ask", "deny"].includes(state.policy.cwdBoundaryWriteMode));
  assert.ok(Array.isArray(state.policy.sensitivePathPatterns));
  assert.ok(Array.isArray(state.policy.protectedWritePathPatterns));
  assert.ok(Array.isArray(state.policy.askWritePathPatterns));
  assert.equal(state.policyPath, TOOL_GUARD_POLICY_SOURCE);
});

test("tool guard admin saves normalized policy to PostgreSQL", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "pi-tool-guard-admin-"));

  const saved = await saveToolGuardPolicy({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    policy: {
      version: 1,
      cwdBoundaryReadMode: "ask",
      cwdBoundaryWriteMode: "deny",
      sensitivePathPatterns: [".env", ".env", "  credentials/**  "],
      blockedReadPathPatterns: ["docs/private/**"],
      protectedWritePathPatterns: [".env"],
      askReadPathPatterns: ["company/**"],
      askWritePathPatterns: ["src/**"],
      externalWriteAllowPaths: ["company"],
      bashDenyPatterns: ["rm *-rf*"],
      bashAskPatterns: ["npm install *"],
      bashAllowPatterns: ["rg *"],
      denyBashByDefault: true,
    },
  });

  assert.deepEqual(saved.policy.sensitivePathPatterns, [".env", "credentials/**"]);
  assert.equal(saved.policy.cwdBoundaryReadMode, "ask");
  assert.equal(saved.policy.cwdBoundaryWriteMode, "deny");
  assert.deepEqual(saved.policy.askReadPathPatterns, ["company/**"]);
  assert.deepEqual(saved.policy.askWritePathPatterns, ["src/**"]);
  assert.deepEqual(saved.policy.bashAskPatterns, ["npm install *"]);
  assert.equal(saved.policy.denyBashByDefault, true);

  const reloaded = await loadToolGuardAdminState(repoRoot, { companyId: TEST_COMPANY_ID });
  assert.deepEqual(reloaded.policy.externalWriteAllowPaths, ["company"]);
});

test("access view model frames the runtime access contract", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "pi-tool-safety-"));

  const viewModel = await loadToolSafetyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });

  assert.deepEqual(viewModel.contract, {
    name: "access",
    version: 1,
    boundary: "runtime-access-policy",
  });
  assert.equal(viewModel.policyPath, TOOL_GUARD_POLICY_SOURCE);
  assert.equal(viewModel.routes.htmlPath, "/config/access");
  assert.equal(viewModel.routes.viewModelJsonPath, "/api/companies/:companyId/access");
  assert.equal(viewModel.routes.previewPath, "/api/companies/:companyId/access/preview");
  assert.ok(Array.isArray(viewModel.policy.sensitivePathPatterns));
  assert.ok(viewModel.capabilityGroups.some((group) => group.id === "environment-config"));
  assert.ok(viewModel.capabilityGroups.some((group) => group.id === "secrets-credentials"));
  assert.ok(viewModel.capabilityGroups.some((group) => group.id === "dangerous-commands"));
  const environmentGroup = viewModel.capabilityGroups.find((group) => group.id === "environment-config");
  assert.equal(environmentGroup?.kind, "resource");
  assert.equal(environmentGroup?.readRule, "ask");
  assert.equal(environmentGroup?.writeRule, "ask");
  assert.ok(environmentGroup?.patterns.includes(".env"));
  const commandGroup = viewModel.capabilityGroups.find((group) => group.id === "dangerous-commands");
  assert.equal(commandGroup?.kind, "command");
  assert.ok(commandGroup?.commandPatterns?.deny.includes("rm *-rf*"));
  assert.ok(viewModel.previewExamples.some((example) => example.result.decision === "ask"));
  assert.ok(viewModel.previewExamples.some((example) => example.result.decision === "deny"));
});

test("access resource editor preserves mixed per-pattern policy sources", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "pi-tool-safety-mixed-"));
  const mixedPolicy = {
    version: 1 as const,
    cwdBoundaryReadMode: "allow" as const,
    cwdBoundaryWriteMode: "allow" as const,
    sensitivePathPatterns: ["credentials/**"],
    blockedReadPathPatterns: ["customer-exports/**"],
    protectedWritePathPatterns: ["credentials/**"],
    askReadPathPatterns: ["team-notes/**"],
    askWritePathPatterns: ["team-notes/**"],
    externalWriteAllowPaths: [],
    bashDenyPatterns: ["rm *-rf*"],
    bashAskPatterns: [],
    bashAllowPatterns: [],
    denyBashByDefault: false,
  };

  await saveToolGuardPolicy({ repoRoot, companyId: TEST_COMPANY_ID, policy: mixedPolicy });
  const viewModel = await loadToolSafetyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });
  const secretsGroup = viewModel.capabilityGroups.find((group) => group.id === "secrets-credentials");

  assert.equal(secretsGroup?.kind, "resource");
  assert.deepEqual(
    secretsGroup?.resourcePatterns?.map((pattern) => ({
      pattern: pattern.pattern,
      readPolicyKey: pattern.readPolicyKey,
      writePolicyKey: pattern.writePolicyKey,
    })),
    [
      {
        pattern: "customer-exports/**",
        readPolicyKey: "blockedReadPathPatterns",
        writePolicyKey: undefined,
      },
      {
        pattern: "credentials/**",
        readPolicyKey: "sensitivePathPatterns",
        writePolicyKey: "protectedWritePathPatterns",
      },
      {
        pattern: "team-notes/**",
        readPolicyKey: "askReadPathPatterns",
        writePolicyKey: "askWritePathPatterns",
      },
    ],
  );

  assert.equal(
    previewToolSafetyDecision({ policy: viewModel.policy, operation: "read", targetPath: "customer-exports/report.csv" }).decision,
    "deny",
  );
  assert.equal(
    previewToolSafetyDecision({ policy: viewModel.policy, operation: "write", targetPath: "team-notes/plan.md" }).decision,
    "ask",
  );

  const savedAgain = await saveToolGuardPolicy({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    policy: JSON.parse(viewModel.advancedEditor.policyJson),
  });
  assert.deepEqual(savedAgain.policy, viewModel.policy);
});

test("tool safety preview explains allow ask and deny decisions", () => {
  const policy = {
    version: 1 as const,
    cwdBoundaryReadMode: "allow" as const,
    cwdBoundaryWriteMode: "allow" as const,
    sensitivePathPatterns: [".env", ".env.*"],
    blockedReadPathPatterns: ["private/**"],
    protectedWritePathPatterns: [".env"],
    askReadPathPatterns: ["company/**"],
    askWritePathPatterns: ["src/**"],
    externalWriteAllowPaths: [],
    bashDenyPatterns: ["rm *-rf*"],
    bashAskPatterns: ["npm install *"],
    bashAllowPatterns: ["rg *"],
    denyBashByDefault: false,
  };

  assert.equal(previewToolSafetyDecision({ policy, operation: "read", targetPath: ".env" }).decision, "ask");
  assert.equal(previewToolSafetyDecision({ policy, operation: "read", targetPath: "private/notes.md" }).decision, "deny");
  assert.equal(previewToolSafetyDecision({ policy, operation: "write", targetPath: "src/index.ts" }).decision, "ask");
  assert.deepEqual(
    previewToolSafetyDecision({ policy, operation: "bash", command: "sed -n 's/=.*/=<redacted>/p' .env.local | nl -ba" }),
    {
      operation: "bash",
      target: "sed -n 's/=.*/=<redacted>/p' .env.local | nl -ba",
      decision: "ask",
      matchedPolicy: "sensitivePathPatterns",
      reason: "Access requires confirmation for sensitive path read via bash command: .env.local",
    },
  );
  assert.equal(previewToolSafetyDecision({ policy, operation: "bash", command: "rm -rf build" }).decision, "deny");
  assert.equal(previewToolSafetyDecision({ policy, operation: "bash", command: "rg TODO src" }).decision, "allow");
});
