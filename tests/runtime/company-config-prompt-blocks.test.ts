import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadPromptPolicyViewModel,
  loadPromptBlocksAdminState,
  savePromptBlockContent,
  resetPromptPolicyBlockToDefault,
  resetPromptPolicyTemplateToDefault,
  savePromptBlocksConfig,
  savePromptPolicyTemplateContent,
} from "../../src/runtime/company-config/prompt-blocks-admin.js";
import {
  loadCompanyPromptBlocks,
} from "../../src/runtime/pi/persistent-pi-employee-agent.js";
import { companyEmployeeHomePath } from "../../src/runtime/company-config/company-paths.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";

const TEST_COMPANY_ID = DEFAULT_COMPANY_ID;

function legacyChannelScenePrompt(): string {
  return [
    "# Channel Scene",
    "",
    "You are replying in a channel thread.",
    "",
    "Write the visible assistant reply as normal assistant text.",
    `${"After the visible " + "reply"}, call ` + "`handoff_topic_turn` exactly once.",
    "Do not skip this handoff, and do not call it more than once.",
    "Set `toId` to exactly one participant id; do not include multiple ids, names, or explanatory text.",
    "Choose `toId` from the Handoff candidates using the current topic, roles, and recent messages.",
    `If no ${"other participant"} should act next, ${"hand the topic " + "back"} to the current ${"hum" + "an/oper" + "ator"} participant.`,
    "Do not put the visible reply text in tool arguments.",
  ].join("\n");
}

test("prompt policy admin backend has focused module boundaries behind the public entry", async () => {
  const companyConfigDir = path.join(process.cwd(), "src", "runtime", "company-config");
  const expectedModules = [
    "prompt-policy-model.ts",
    "prompt-policy-format.ts",
    "prompt-policy-persistence.ts",
    "prompt-policy-view-model.ts",
  ];

  const entrySource = await readFile(path.join(companyConfigDir, "prompt-blocks-admin.ts"), "utf8");
  assert.ok(
    entrySource.split(/\r?\n/).length <= 160,
    "prompt-blocks-admin.ts should stay a thin public Prompt Policy admin entry",
  );

  for (const moduleName of expectedModules) {
    const source = await readFile(path.join(companyConfigDir, moduleName), "utf8");
    assert.ok(source.trim().length > 0, `${moduleName} should own a focused Prompt Policy backend concern`);
  }
});

async function createPromptBlocksFixture() {
  return mkdtemp(path.join(tmpdir(), "tinyoffice-company-config-"));
}

function testEmployeeHomePath(repoRoot: string, employeeId: string) {
  return companyEmployeeHomePath({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId,
  });
}

async function deletePromptPolicyTemplateRow(repoRoot: string, templateId: string): Promise<void> {
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    throw new Error("PostgreSQL runtime config is required for prompt policy tests.");
  }
  try {
    await postgres.client.query(
      "DELETE FROM prompt_policy_templates WHERE company_id = $1 AND template_id = $2",
      [TEST_COMPANY_ID, templateId],
    );
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

test("company prompt blocks admin loads DB-backed Prompt Policy scene blocks and reusable blocks", async () => {
  const repoRoot = await createPromptBlocksFixture();

  const state = await loadPromptBlocksAdminState(repoRoot, { companyId: TEST_COMPANY_ID });
  const availableByPath = new Map(state.availableBlocks.map((block) => [block.path, block]));
  const requiredSceneBlocks = [
    "channel-scene",
    "dm-scene",
    "intake-event",
    "workrun-scene",
  ];

  assert.deepEqual(state.config.always, []);
  assert.deepEqual(
    state.availableBlocks
      .map((block) => block.path)
      .filter((blockPath) => requiredSceneBlocks.includes(blockPath)),
    requiredSceneBlocks,
  );
  assert.match(availableByPath.get("channel-scene")?.content || "", /handoff_topic_turn/);
  assert.match(availableByPath.get("dm-scene")?.content || "", /direct-message thread/);
  assert.match(availableByPath.get("intake-event")?.content || "", /finish_intake_turn/);
  assert.match(availableByPath.get("workrun-scene")?.content || "", /finish_work_turn/);
  assert.match(availableByPath.get("workrun-scene")?.content || "", /acceptanceCriteria/);
  assert.doesNotMatch(availableByPath.get("workrun-scene")?.content || "", /success condition/i);
  assert.ok(
    state.availableBlocks.every((block) => /^[a-z0-9][a-z0-9_-]*$/i.test(block.path)),
    "availableBlocks may include operator-created reusable blocks, but every block id must be normalized",
  );
  assert.ok(state.availableBlocks.every((block) => ![
    "communication-style",
    "approval-boundary",
    "employee-work-loop",
    "skill-usage",
    "collaboration-contract",
    "multi-party-thread",
    "work-run-execution-contract",
  ].includes(block.path)));
});

test("prompt policy view model audits scene contracts and effective prompts", async () => {
  const repoRoot = await createPromptBlocksFixture();

  const viewModel = await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });

  assert.equal(viewModel.contract.name, "prompt-policy");
  assert.equal(viewModel.contract.version, 1);
  assert.equal(viewModel.contract.boundary, "scene-runtime-contract");
  assert.deepEqual(
    viewModel.scenes.map((scene) => scene.id),
    ["dm_thread", "channel_thread", "intake_event", "work_run_execution"],
  );
  const dm = viewModel.scenes.find((scene) => scene.id === "dm_thread");
  assert(dm);
  assert.deepEqual(dm.alwaysBlocks.map((block) => block.path), []);
  assert.deepEqual(dm.sceneBlocks.map((block) => block.path), ["dm-scene"]);
  assert.equal(dm.effectivePrompt.replace(/\r\n/g, "\n").trim(), "# DM Scene\n\nYou are replying in a direct-message thread.");
  assert.doesNotMatch(dm.effectivePrompt, /preferred user-visible language/i);
  const dmBlock = viewModel.availableBlocks.find((block) => block.path === "dm-scene");
  assert.deepEqual(dmBlock?.loadedBy.map((item) => item.label), ["DM Thread"]);
  const channel = viewModel.scenes.find((scene) => scene.id === "channel_thread");
  assert(channel);
  assert.deepEqual(channel.sceneBlocks.map((block) => block.path), ["channel-scene"]);
  assert.match(channel.effectivePrompt, /handoff_topic_turn/);
  assert.match(channel.effectivePrompt, /exactly once/);
  assert.match(channel.effectivePrompt, /return the ball to the user/);
  assert.match(channel.effectivePrompt, /before ending every channel turn/i);
  assert.doesNotMatch(channel.effectivePrompt, /After the visible reply/i);
  assert.doesNotMatch(channel.effectivePrompt, /human|operator/i);
  assert.doesNotMatch(channel.effectivePrompt, /return to|hand back/i);
  assert.equal(viewModel.diagnostics.errors.length, 0);
  assert.equal(viewModel.diagnostics.warnings.length, 0);
  assert.deepEqual(viewModel.diagnostics.unmountedBlocks.map((block) => block.path), []);
});

test("prompt policy view model exposes foundation prompt templates with variable hints", async () => {
  const repoRoot = await createPromptBlocksFixture();

  const viewModel = await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });

  assert.deepEqual(
    viewModel.templates.map((template) => template.id),
    ["base-system-prompt", "runtime-prompt-template"],
  );
  const base = viewModel.templates.find((template) => template.id === "base-system-prompt");
  assert(base);
  assert.equal(base.label, "Base System Prompt");
  assert.deepEqual(base.variableHints, ["{employeeId}", "{displayName}", "{role}"]);
  assert.match(base.content, /You are an employee in TinyOffice/);
  assert.match(base.content, /\{employeeId\}/);
  const runtime = viewModel.templates.find((template) => template.id === "runtime-prompt-template");
  assert(runtime);
  assert.equal(runtime.label, "Runtime Prompt Template");
  assert.deepEqual(runtime.variableHints, ["{sceneType}", "{contextBlocks}", "{userMessage}"]);
  assert.match(runtime.content, /Runtime Context:/);
  assert.match(runtime.content, /\{userMessage\}/);
  assert.doesNotMatch(runtime.content, /\{completionPolicy\}/);
});

test("prompt policy view model reports missing template DB rows instead of using code defaults", async () => {
  const repoRoot = await createPromptBlocksFixture();

  await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });
  await deletePromptPolicyTemplateRow(repoRoot, "runtime-prompt-template");

  await assert.rejects(
    () => loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID }),
    /Prompt Policy template runtime-prompt-template is missing for company/,
  );
});

test("prompt policy keeps saved runtime template content as DB truth", async () => {
  const repoRoot = await createPromptBlocksFixture();
  const savedTemplate = [
    "Runtime Context:",
    "Scene: {sceneType}",
    "",
    "{completionPolicy}",
    "{contextBlocks}",
    "",
    "User Message:",
    "{userMessage}",
  ].join("\n");

  await savePromptPolicyTemplateContent({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    templateId: "runtime-prompt-template",
    content: savedTemplate,
  });

  const viewModel = await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });
  const runtime = viewModel.templates.find((template) => template.id === "runtime-prompt-template");

  assert.equal(runtime?.content, savedTemplate);
  assert.match(runtime?.content || "", /\{completionPolicy\}/);
});

test("prompt policy keeps saved channel scene block content as DB truth", async () => {
  const repoRoot = await createPromptBlocksFixture();
  const savedPrompt = legacyChannelScenePrompt();

  await savePromptBlockContent({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    blockPath: "channel-scene",
    content: savedPrompt,
  });

  const viewModel = await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });
  const channel = viewModel.scenes.find((scene) => scene.id === "channel_thread");

  assert.equal(channel?.effectivePrompt, savedPrompt);
  assert.match(channel?.effectivePrompt || "", /After the visible reply/i);
  assert.match(channel?.effectivePrompt || "", /human\/operator/i);
});

test("company prompt templates save and reset to built-in defaults", async () => {
  const repoRoot = await createPromptBlocksFixture();

  await savePromptPolicyTemplateContent({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    templateId: "base-system-prompt",
    content: "CUSTOM BASE {employeeId}",
  });
  let viewModel = await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });
  assert.equal(
    viewModel.templates.find((template) => template.id === "base-system-prompt")?.content,
    "CUSTOM BASE {employeeId}",
  );

  await resetPromptPolicyTemplateToDefault({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    templateId: "base-system-prompt",
  });
  viewModel = await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });
  const base = viewModel.templates.find((template) => template.id === "base-system-prompt");
  assert.match(base?.content || "", /You are an employee in TinyOffice/);
  assert.match(base?.content || "", /\{displayName\}/);
  assert.doesNotMatch(base?.content || "", /CUSTOM BASE/);
});

test("company scene prompt blocks reset to built-in defaults without clearing content", async () => {
  const repoRoot = await createPromptBlocksFixture();

  await savePromptBlockContent({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    blockPath: "dm-scene",
    content: "# DM Scene\n\nCUSTOM DM GUIDANCE\n",
  });
  await resetPromptPolicyBlockToDefault({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    blockPath: "dm-scene",
  });

  const viewModel = await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });
  const dm = viewModel.availableBlocks.find((block) => block.path === "dm-scene");
  assert.equal(dm?.title, "DM Scene");
  assert.match(dm?.content || "", /direct-message thread/);
  assert.doesNotMatch(dm?.content || "", /CUSTOM DM GUIDANCE/);
});

test("company prompt blocks admin saves validated config to PostgreSQL", async () => {
  const repoRoot = await createPromptBlocksFixture();

  const saved = await savePromptBlocksConfig({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    config: {
      version: 1,
      always: [],
      scenes: {
        dm_thread: ["dm-scene"],
        channel_thread: ["channel-scene"],
        intake_event: ["intake-event"],
        work_run_execution: ["workrun-scene"],
      },
    },
  });

  assert.deepEqual(saved.config.always, []);

  const blocks = await loadCompanyPromptBlocks({
    employeeHomePath: testEmployeeHomePath(repoRoot, "mira-hr"),
    sessionKey: "mira-hr|channel_thread|post-1",
  });
  assert.deepEqual(blocks.map((block) => block.path), ["channel-scene"]);

  const intakeBlocks = await loadCompanyPromptBlocks({
    employeeHomePath: testEmployeeHomePath(repoRoot, "mira-hr"),
    sessionKey: "mira-hr|intake_event|event-1",
  });
  assert.deepEqual(intakeBlocks.map((block) => block.path), ["intake-event"]);
});

test("prompt policy save validation rejects duplicate mounted blocks", async () => {
  const repoRoot = await createPromptBlocksFixture();

  await assert.rejects(
    () => savePromptBlocksConfig({
      repoRoot,
      companyId: TEST_COMPANY_ID,
      config: {
        version: 1,
        always: ["dm-scene"],
        scenes: {
          dm_thread: ["dm-scene"],
          channel_thread: [],
          intake_event: [],
          work_run_execution: [],
        },
      },
    }),
    /duplicate prompt block/i,
  );
});

test("company prompt blocks admin saves prompt block content to PostgreSQL", async () => {
  const repoRoot = await createPromptBlocksFixture();
  const blockPath = "dm-scene";

  const saved = await savePromptBlockContent({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    blockPath,
    content: "# DM Scene\n\nYou are replying in a direct-message thread.\n",
  });

  const updated = saved.availableBlocks.find((block) => block.path === blockPath);
  assert.equal(updated?.title, "DM Scene");
  assert.match(updated?.content || "", /direct-message thread/);
});

test("company prompt blocks admin creates reusable blocks and mounts them into effective prompts", async () => {
  const repoRoot = await createPromptBlocksFixture();

  const savedBlock = await savePromptBlockContent({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    blockPath: "company-behavior",
    title: "Company Behavior",
    content: "# Company Behavior\n\nKeep replies concise and evidence-backed.\n",
  });

  assert.ok(savedBlock.availableBlocks.some((block) =>
    block.path === "company-behavior" &&
    block.title === "Company Behavior" &&
    /evidence-backed/.test(block.content)
  ));

  await savePromptBlocksConfig({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    config: {
      version: 1,
      always: ["company-behavior"],
      scenes: {
        dm_thread: ["dm-scene"],
        channel_thread: [],
        intake_event: [],
        work_run_execution: [],
      },
    },
  });

  const dm = (await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID })).scenes.find((scene) => scene.id === "dm_thread");
  assert(dm);
  assert.deepEqual(dm.effectiveBlockPaths, ["company-behavior", "dm-scene"]);
  assert.match(dm.effectivePrompt, /Keep replies concise and evidence-backed/);
  assert.match(dm.effectivePrompt, /direct-message thread/);
});

test("prompt policy view model does not warn about ordinary unmounted blocks", async () => {
  const repoRoot = await createPromptBlocksFixture();

  await savePromptBlockContent({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    blockPath: "draft-guidance",
    title: "Draft Guidance",
    content: "# Draft Guidance\n\nKeep this inactive until it is promoted.\n",
  });

  const viewModel = await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });
  const draftBlock = viewModel.availableBlocks.find((block) => block.path === "draft-guidance");

  assert(draftBlock);
  assert.deepEqual(draftBlock.loadedBy, []);
  assert.equal(viewModel.diagnostics.warnings.length, 0);
  assert.deepEqual(viewModel.diagnostics.unmountedBlocks, []);
});

test("runtime scene contract reports missing DB scene block bindings", async () => {
  const repoRoot = await createPromptBlocksFixture();

  await savePromptBlocksConfig({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    config: {
      version: 1,
      always: [],
      scenes: {
        dm_thread: [],
        channel_thread: [],
        intake_event: [],
        work_run_execution: [],
      },
    },
  });

  const viewModel = await loadPromptPolicyViewModel(repoRoot, { companyId: TEST_COMPANY_ID });

  assert.deepEqual(viewModel.scenes.map((scene) => [scene.id, scene.sceneBlocks.map((block) => block.path)]), [
    ["dm_thread", []],
    ["channel_thread", []],
    ["intake_event", []],
    ["work_run_execution", []],
  ]);
  assert.deepEqual(viewModel.diagnostics.errors.map((error) => error.code), [
    "missing_scene_prompt_block",
    "missing_scene_prompt_block",
    "missing_scene_prompt_block",
    "missing_scene_prompt_block",
  ]);
  assert.match(viewModel.diagnostics.errors[1]?.message || "", /channel_thread/);
});

test("company prompt blocks admin rejects invalid block ids", async () => {
  const repoRoot = await createPromptBlocksFixture();

  await assert.rejects(
    () => savePromptBlocksConfig({
      repoRoot,
      companyId: TEST_COMPANY_ID,
      config: {
        version: 1,
        always: ["companies/acme/skills/not-a-prompt.md"],
        scenes: {
          dm_thread: [],
          channel_thread: [],
          intake_event: [],
          work_run_execution: [],
        },
      },
    }),
    /Prompt block id is invalid/,
  );
});
