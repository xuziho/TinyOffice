import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeTinyOfficeCapabilityCallTool } from "../../src/runtime/capabilities/capability-tool.js";
import { clearDeferredRuntimeReloads, consumeDeferredRuntimeReloads, requestDeferredRuntimeReload } from "../../src/runtime/capabilities/deferred-runtime-reload.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";

const skillContent = (name: string, body = "Use this workflow for a real recurring review.") => [
  "---",
  `name: ${name}`,
  "description: Use when preparing a decision summary with owners and follow-up actions.",
  "---",
  "",
  `# ${name}`,
  "",
  body,
  "",
].join("\n");

test("deferred Skill reloads stay scoped to the Chat turn that requested them", () => {
  clearDeferredRuntimeReloads();
  requestDeferredRuntimeReload("acme", "session-a", ["olivia"]);
  requestDeferredRuntimeReload("acme", "session-b", ["avery"]);
  assert.deepEqual(consumeDeferredRuntimeReloads("acme", "session-b"), ["avery"]);
  assert.deepEqual(consumeDeferredRuntimeReloads("acme", "session-a"), ["olivia"]);
});

test("Skill capabilities create, list, describe, and update Company Skills without a system Skill scope", async () => {
  clearDeferredRuntimeReloads();
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-skill-capability-"));
  const companyId = `skill-company-${Date.now()}`;
  const context = { repoRoot, companyId, conversationId: "conversation-1", actorMemberId: "owner", runtimeEmployeeId: "owner" };

  await assert.rejects(() => executeTinyOfficeCapabilityCallTool({
    ...context,
    capabilityId: "skill.create",
    input: { companyId, scope: { kind: "company" }, skillName: "decision-summary-standard", files: [{ relativePath: "SKILL.md", content: skillContent("decision-summary-standard") }] },
  }), /requires operator confirmation/);

  const created = await executeTinyOfficeCapabilityCallTool({
    ...context,
    capabilityId: "skill.create",
    confirmation: { accepted: true },
    input: { companyId, scope: { kind: "company" }, skillName: "decision-summary-standard", files: [{ relativePath: "SKILL.md", content: skillContent("decision-summary-standard") }] },
  });
  assert.match(JSON.stringify(created.result), /scheduled_after_current_turn/);
  assert.match(await readFile(path.join(repoRoot, "companies", companyId, "skills", "decision-summary-standard", "SKILL.md"), "utf8"), /decision-summary-standard/);
  await assert.rejects(() => access(path.join(repoRoot, "company", "skills", "decision-summary-standard", "SKILL.md")));

  const listed = await executeTinyOfficeCapabilityCallTool({ ...context, capabilityId: "skill.list", input: { companyId, scope: { kind: "company" } } });
  assert.match(JSON.stringify(listed.result), /decision-summary-standard/);
  const described = await executeTinyOfficeCapabilityCallTool({ ...context, capabilityId: "skill.describe", input: { companyId, scope: { kind: "company" }, skillName: "decision-summary-standard" } });
  assert.match(JSON.stringify(described.result), /preparing a decision summary/);

  await executeTinyOfficeCapabilityCallTool({
    ...context,
    capabilityId: "skill.update",
    confirmation: { accepted: true },
    input: { companyId, scope: { kind: "company" }, skillName: "decision-summary-standard", files: [{ relativePath: "SKILL.md", content: skillContent("decision-summary-standard", "Updated workflow body.") }] },
  });
  assert.match(await readFile(path.join(repoRoot, "companies", companyId, "skills", "decision-summary-standard", "SKILL.md"), "utf8"), /Updated workflow body/);
  assert.deepEqual(consumeDeferredRuntimeReloads(companyId, "conversation-1"), []);
});

test("Skill capabilities reject system scope, overwrite, missing update, invalid frontmatter, and path traversal", async () => {
  clearDeferredRuntimeReloads();
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-skill-guards-"));
  const companyId = `skill-guards-${Date.now()}`;
  const call = (capabilityId: string, input: Record<string, unknown>) => executeTinyOfficeCapabilityCallTool({
    repoRoot,
    companyId,
    conversationId: "conversation-1",
    actorMemberId: "owner",
    runtimeEmployeeId: "owner",
    capabilityId,
    confirmation: { accepted: true },
    input: { companyId, ...input },
  });
  await assert.rejects(() => call("skill.create", { scope: { kind: "system" }, skillName: "bad-scope", files: [{ relativePath: "SKILL.md", content: skillContent("bad-scope") }] }), /system Skill scope does not exist/);
  await assert.rejects(() => call("skill.create", { scope: { kind: "company" }, skillName: "bad-frontmatter", files: [{ relativePath: "SKILL.md", content: "# Missing frontmatter" }] }), /frontmatter/);
  await assert.rejects(() => call("skill.create", { scope: { kind: "company" }, skillName: "bad-path", files: [{ relativePath: "SKILL.md", content: skillContent("bad-path") }, { relativePath: "../secret", content: "no" }] }), /Invalid Skill file path/);
  await call("skill.create", { scope: { kind: "company" }, skillName: "existing-skill", files: [{ relativePath: "SKILL.md", content: skillContent("existing-skill") }] });
  await assert.rejects(() => call("skill.create", { scope: { kind: "company" }, skillName: "existing-skill", files: [{ relativePath: "SKILL.md", content: skillContent("existing-skill") }] }), /already exists/);
  await assert.rejects(() => call("skill.update", { scope: { kind: "company" }, skillName: "missing-skill", files: [{ relativePath: "SKILL.md", content: skillContent("missing-skill") }] }), /requires an existing Skill/);
});

test("Employee Skill creation targets one real Company member and schedules only that member for reload", async () => {
  clearDeferredRuntimeReloads();
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-employee-skill-capability-"));
  const companyId = DEFAULT_COMPANY_ID;
  const memberId = `skill-specialist-${Date.now()}`;
  const repository = await CompanyDirectoryRepository.open(repoRoot, { companyId });
  try {
    await repository.upsertEmployee({
      employeeId: memberId,
      enabled: true,
      profile: { employeeId: memberId, displayName: "Skill Specialist", role: "content-operations", presenceMode: "resident" },
      resourcePolicy: { version: 1 },
      runtime: { version: 1, modelProvider: "openai-codex", modelId: "gpt-5.5", thinkingLevel: "minimal" },
    });
  } finally {
    repository.close();
  }
  await executeTinyOfficeCapabilityCallTool({
    repoRoot,
    companyId,
    conversationId: "conversation-employee-skill",
    actorMemberId: "owner",
    runtimeEmployeeId: memberId,
    capabilityId: "skill.create",
    confirmation: { accepted: true },
    input: {
      companyId,
      scope: { kind: "employee", memberId },
      skillName: "content-final-review",
      files: [{ relativePath: "SKILL.md", content: skillContent("content-final-review") }],
    },
  });
  assert.match(await readFile(path.join(repoRoot, "companies", companyId, "employees", memberId, "skills", "content-final-review", "SKILL.md"), "utf8"), /content-final-review/);
  assert.deepEqual(consumeDeferredRuntimeReloads(companyId, "conversation-employee-skill"), [memberId]);
});
