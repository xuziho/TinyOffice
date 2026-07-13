import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { capabilityRegistry, getCapabilityEntry } from "../../src/runtime/capabilities/capability-registry.js";

test("capability registry documents the HR recruitment capability set", () => {
  assert.equal(capabilityRegistry.schema, "tinyoffice-capability-registry");
  assert.equal(capabilityRegistry.version, 1);

  const ids = capabilityRegistry.capabilities.map((entry) => entry.id);
  assert.deepEqual(ids, [
    "company.member.directory.list",
    "runtime.models.list",
    "intake.integration.describe",
    "skill.list",
    "skill.describe",
    "skill.create",
    "skill.update",
    "member.profile.describe",
    "employee.recruit",
    "chat.channel.create",
    "work.create",
    "work.list",
    "work.describe",
    "work.cancel",
    "work.revise",
    "work.retry",
    "work.archive",
    "work.restore",
    "schedule.pause",
    "schedule.resume",
    "schedule.cancel",
  ]);

  const recruit = getCapabilityEntry("employee.recruit");
  assert.match(recruit?.useWhen ?? "", /recruit/i);
  assert.equal(recruit?.effect, "create");
  assert.equal(recruit?.confirmationPolicy.required, true);
  assert.ok(recruit?.inputSchema.required?.includes("displayName"));
  assert.equal(recruit?.inputSchema.properties?.employeeId?.required, false);
  assert.ok(recruit?.inputSchema.required?.includes("runtime"));
  assert.ok(recruit?.notes.some((note) => /AGENTS\.md/.test(note)));
});

test("capability registry exposes confirmed DM and Channel Work creation", () => {
  const workCreate = getCapabilityEntry("work.create");

  assert.match(workCreate?.useWhen ?? "", /confirmed DM or Channel discussion/i);
  assert.ok(workCreate?.inputSchema.required?.includes("title"));
  assert.ok(workCreate?.inputSchema.required?.includes("ownerMemberId"));
  assert.ok(workCreate?.inputSchema.required?.includes("trigger"));
  assert.match(JSON.stringify(workCreate?.inputSchema), /scheduledFor/);
  assert.match(JSON.stringify(workCreate?.inputSchema), /intervalMs/);
  assert.match(JSON.stringify(workCreate?.outputSchema), /task/);
  assert.ok(workCreate?.notes.some((note) => /DM\/Channel creation requires operator confirmation/i.test(note)));
  assert.ok(workCreate?.notes.some((note) => /intake/i.test(note) && /explicit/i.test(note)));
});

test("capability registry requires complete capability documentation", () => {
  for (const entry of capabilityRegistry.capabilities) {
    assert.match(entry.id, /^[a-z][a-z0-9.]*$/);
    assert.ok(entry.title);
    assert.ok(["member", "chat", "work", "runtime", "governance", "system"].includes(entry.category));
    assert.ok(["read", "create", "update", "restore", "delete", "execute"].includes(entry.effect));
    assert.equal(typeof entry.confirmationPolicy.required, "boolean");
    assert.ok(entry.allowedScenes.length > 0);
    assert.ok(entry.useWhen);
    assert.ok(entry.description);
    assert.ok(entry.inputSchema);
    assert.ok(entry.outputSchema);
  }
});

test("capability registry declares machine-readable operation metadata", () => {
  const metadata = Object.fromEntries(capabilityRegistry.capabilities.map((entry) => [entry.id, {
    category: entry.category,
    effect: entry.effect,
    requiresOperatorConfirmation: entry.confirmationPolicy.required,
    allowedScenes: entry.allowedScenes,
  }]));

  assert.deepEqual(metadata, {
    "company.member.directory.list": {
      category: "member",
      effect: "read",
      requiresOperatorConfirmation: false,
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
    },
    "runtime.models.list": {
      category: "runtime",
      effect: "read",
      requiresOperatorConfirmation: false,
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
    },
    "intake.integration.describe": {
      category: "system",
      effect: "read",
      requiresOperatorConfirmation: false,
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
    },
    "skill.list": { category: "system", effect: "read", requiresOperatorConfirmation: false, allowedScenes: ["chat_dm", "chat_channel"] },
    "skill.describe": { category: "system", effect: "read", requiresOperatorConfirmation: false, allowedScenes: ["chat_dm", "chat_channel"] },
    "skill.create": { category: "system", effect: "create", requiresOperatorConfirmation: true, allowedScenes: ["chat_dm", "chat_channel"] },
    "skill.update": { category: "system", effect: "update", requiresOperatorConfirmation: true, allowedScenes: ["chat_dm", "chat_channel"] },
    "member.profile.describe": {
      category: "member",
      effect: "read",
      requiresOperatorConfirmation: false,
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
    },
    "employee.recruit": {
      category: "member",
      effect: "create",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
    "chat.channel.create": {
      category: "chat",
      effect: "create",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
    "work.create": {
      category: "work",
      effect: "create",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
    "work.list": {
      category: "work",
      effect: "read",
      requiresOperatorConfirmation: false,
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
    },
    "work.describe": {
      category: "work",
      effect: "read",
      requiresOperatorConfirmation: false,
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
    },
    "work.cancel": {
      category: "work",
      effect: "update",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
    "work.revise": {
      category: "work",
      effect: "update",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
    },
    "work.retry": {
      category: "work",
      effect: "execute",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
    "work.archive": {
      category: "work",
      effect: "update",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
    "work.restore": {
      category: "work",
      effect: "restore",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
    "schedule.pause": {
      category: "work",
      effect: "update",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
    "schedule.resume": {
      category: "work",
      effect: "update",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
    "schedule.cancel": {
      category: "work",
      effect: "update",
      requiresOperatorConfirmation: true,
      allowedScenes: ["chat_dm", "chat_channel"],
    },
  });
});

test("skill creation guidance is system capability metadata rather than a user-managed system Skill", async () => {
  const skillCreate = getCapabilityEntry("skill.create");
  assert.equal(skillCreate?.confirmationPolicy.required, true);
  const skillList = getCapabilityEntry("skill.list");
  assert.match(skillList?.useWhen ?? "", /natural language/i);
  assert.match(skillList?.useWhen ?? "", /Company Skill signal/i);
  assert.ok(skillList?.notes.some((note) => note.includes("workspace is not a Company Skill")));
  assert.ok(skillCreate?.notes.some((note) => note.includes("ordinary workspace Markdown")));
  assert.match([skillCreate?.description, skillCreate?.useWhen, ...(skillCreate?.notes || [])].join("\n"), /Company.*Employee scope|Company scope|Employee scope/i);
  await assert.rejects(() => readFile("company/skills/skill-creator/SKILL.md", "utf8"));
  const productDoc = await readFile("docs/product/company-api-guide.md", "utf8");
  assert.match(productDoc, /system-level capability registry/);
  assert.match(productDoc, /do not duplicate the full capability registry in Markdown/);
});

test("HR recruitment skill uses capability ids without host environment details", async () => {
  const hrRecruitSkill = (await readFile("src/runtime/company-config/company-blueprint.ts", "utf8"))
    .replace(/\\"/g, "\"");

  assert.doesNotMatch(hrRecruitSkill, /TINYOFFICE_API_BASE_URL|TINYOFFICE_RUNTIME_ORIGIN|\{apiBase\}/);
  assert.doesNotMatch(hrRecruitSkill, /normal available execution tools/);
  assert.match(hrRecruitSkill, /tinyoffice_capability_call/);
  assert.match(hrRecruitSkill, /"capabilityId": "company\.member\.directory\.list"/);
  assert.match(hrRecruitSkill, /"capabilityId": "runtime\.models\.list"/);
  assert.match(hrRecruitSkill, /"capabilityId": "employee\.recruit"/);
  assert.doesNotMatch(hrRecruitSkill, /tinyoffice_api_request/);
  assert.doesNotMatch(hrRecruitSkill, /"path": "\/api\//);
});

test("Channel and Work creation rules live in system capabilities rather than copied Skills", async () => {
  const channelCreate = getCapabilityEntry("chat.channel.create");
  const workCreate = getCapabilityEntry("work.create");
  assert.equal(channelCreate?.confirmationPolicy.required, true);
  assert.match(JSON.stringify(channelCreate), /company\.member\.directory\.list|memberId/);
  assert.equal(workCreate?.confirmationPolicy.required, true);
  assert.match(JSON.stringify(workCreate), /scheduled_once/);
  await assert.rejects(() => readFile("company/skills/channel-builder/SKILL.md", "utf8"));
  await assert.rejects(() => readFile("company/skills/work-creator/SKILL.md", "utf8"));
});

test("AI-callable channel APIs use memberId selectors only", () => {
  const directory = getCapabilityEntry("company.member.directory.list");
  const channelCreate = getCapabilityEntry("chat.channel.create");

  assert.ok(directory);
  assert.ok(channelCreate);

  const directoryGuideText = [
    directory.description,
    JSON.stringify(directory.outputSchema),
    ...directory.notes,
  ].join("\n");
  assert.match(directoryGuideText, /members\[\]\.memberId/);
  assert.match(directoryGuideText, /members\[\]\.participantKind: company_member/);
  assert.doesNotMatch(directoryGuideText, /employee \| company_member/);
  assert.doesNotMatch(directoryGuideText, /employee entries' employeeId/);

  const channelGuideText = [
    channelCreate.description,
    JSON.stringify(channelCreate.inputSchema),
    JSON.stringify(channelCreate.outputSchema),
    ...channelCreate.notes,
  ].join("\n");
  assert.match(channelGuideText, /members\[\]\.memberId/);
  assert.doesNotMatch(channelGuideText, /members\[\]\.employeeId/);
  assert.doesNotMatch(channelGuideText, /employeeId or memberId/);
});
