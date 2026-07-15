import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";

import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";
import {
  __clearPiTransportStateForTests,
  __recordPiTransportFailureForTests,
  assertExplicitEmployeeRuntimeModel,
  buildSystemPromptAppend,
  buildUserPrompt,
  loadCompanyPromptBlocks,
  loadEmployeeInstructionFiles,
  loadEmployeeSkillPaths,
  resolveTransportSelection,
  type PiSessionTransportStartInput,
  type PiSessionTransport,
  type PiSessionTransportReplyInput,
  type EmployeeInstructionFile,
  PersistentPiEmployeeAgent,
} from "../../src/runtime/pi/persistent-pi-employee-agent.js";
import {
  savePromptBlockContent,
  savePromptBlocksConfig,
  savePromptPolicyTemplateContent,
} from "../../src/runtime/company-config/prompt-blocks-admin.js";
import {
  companyEmployeeHomePath,
} from "../../src/runtime/company-config/company-paths.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { resetRuntimePostgresTables } from "./postgres-test-utils.js";
import { updatePiReplyText } from "../../src/runtime/pi/persistent-pi-session-transport.js";
import { DEFAULT_HTTP_IDLE_TIMEOUT_MS } from "../../src/runtime/pi/pi-coding-agent-sdk.js";

beforeEach(resetRuntimePostgresTables);

test("PI retry starts a clean reply buffer and uses a bounded idle timeout", () => {
  const partial = updatePiReplyText("", {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "partial attempt" },
  });
  const reset = updatePiReplyText(partial.text, { type: "auto_retry_start" });
  const retried = updatePiReplyText(reset.text, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "clean retry" },
  });

  assert.equal(partial.text, "partial attempt");
  assert.equal(reset.text, "");
  assert.equal(retried.text, "clean retry");
  assert.equal(DEFAULT_HTTP_IDLE_TIMEOUT_MS, 120_000);
});

const TEST_COMPANY_ID = DEFAULT_COMPANY_ID;
const DEFAULT_TEST_PROMPT_SCENES = {
  dm_thread: ["dm-scene"],
  channel_thread: ["channel-scene"],
  intake_event: ["intake-event"],
  work_run_execution: ["workrun-scene"],
};

function testEmployeeHomePath(repoRoot: string, employeeId: string) {
  return companyEmployeeHomePath({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId,
  });
}

function repoRootFromTestEmployeeHome(employeeHomePath: string) {
  const marker = `${path.sep}companies${path.sep}`;
  const markerIndex = employeeHomePath.indexOf(marker);
  assert.ok(markerIndex > -1, `Expected company-scoped employee home: ${employeeHomePath}`);
  return employeeHomePath.slice(0, markerIndex);
}

class FakeTransport implements PiSessionTransport {
  readonly startCalls: PiSessionTransportStartInput[] = [];
  readonly replyCalls: PiSessionTransportReplyInput[] = [];
  employeeInstructionFiles: EmployeeInstructionFile[] = [];

  async start(input: PiSessionTransportStartInput): Promise<void> {
    this.startCalls.push(input);
  }

  async reply(input: PiSessionTransportReplyInput): Promise<{
    message: string;
    loadedSkillNames: string[];
    employeeInstructionFiles?: EmployeeInstructionFile[];
  }> {
    this.replyCalls.push(input);
    return {
      message: this.replyCalls.length === 1 ? "Hello, I received it." : "Continuing follow-up.",
      loadedSkillNames: [],
      employeeInstructionFiles: this.employeeInstructionFiles,
    };
  }

}

class DeferredTransport implements PiSessionTransport {
  readonly startCalls: PiSessionTransportStartInput[] = [];
  readonly replyCalls: PiSessionTransportReplyInput[] = [];
  private readonly resolvers: Array<(value: { message: string; loadedSkillNames: string[] }) => void> = [];

  async start(input: PiSessionTransportStartInput): Promise<void> {
    this.startCalls.push(input);
  }

  async reply(input: PiSessionTransportReplyInput): Promise<{
    message: string;
    loadedSkillNames: string[];
  }> {
    this.replyCalls.push(input);
    return new Promise<{ message: string; loadedSkillNames: string[] }>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  resolveNext(value: string) {
    const resolver = this.resolvers.shift();
    if (!resolver) {
      throw new Error("No pending runner call to resolve.");
    }
    resolver({ message: value, loadedSkillNames: [] });
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(predicate(), "condition was not met before timeout");
}

async function createEmployeeHome(): Promise<EmployeeHome> {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-agent-"));
  const homePath = testEmployeeHomePath(root, "mira-hr");
  const workspacePath = path.join(homePath, "workspace");
  await mkdir(workspacePath, { recursive: true });

  return {
    companyId: TEST_COMPANY_ID,
    employeeId: "mira-hr",
    homePath,
    workspacePath,
    profile: {
      employeeId: "mira-hr",
      role: "hr",
      displayName: "Mira",
      presenceMode: "resident",
    },
    resourcePolicy: { version: 1, filesystem: { ownWorkspace: "allow", otherEmployeeWorkspace: "allow", repo: "allow", secrets: "deny" } },
  };
}

async function setPromptPolicy(input: {
  repoRoot: string;
  always?: string[];
  scenes?: Partial<Record<"dm_thread" | "channel_thread" | "intake_event" | "work_run_execution", string[]>>;
  contents?: Record<string, string>;
}) {
  for (const [blockPath, content] of Object.entries(input.contents || {})) {
    await savePromptBlockContent({
      repoRoot: input.repoRoot,
      companyId: TEST_COMPANY_ID,
      blockPath,
      content,
    });
  }
  await savePromptBlocksConfig({
    repoRoot: input.repoRoot,
    companyId: TEST_COMPANY_ID,
    config: {
      version: 1,
      always: input.always || [],
      scenes: {
        dm_thread: input.scenes?.dm_thread ?? DEFAULT_TEST_PROMPT_SCENES.dm_thread,
        channel_thread: input.scenes?.channel_thread ?? DEFAULT_TEST_PROMPT_SCENES.channel_thread,
        intake_event: input.scenes?.intake_event ?? DEFAULT_TEST_PROMPT_SCENES.intake_event,
        work_run_execution: input.scenes?.work_run_execution ?? DEFAULT_TEST_PROMPT_SCENES.work_run_execution,
      },
    },
  });
}

function fakeTransportRuntimeModel() {
  return {
    version: 1,
    modelProvider: "test-provider",
    modelId: "test-model",
    thinkingLevel: "minimal",
  } as const;
}

test("buildSystemPromptAppend keeps identity separate from configurable prompt blocks", async () => {
  const employee = await createEmployeeHome();
  const prompt = buildSystemPromptAppend({
    employee,
    sessionKey: "mira-hr|channel_thread|post-3",
  });

  assert.match(prompt, /You are an employee in TinyOffice/);
  assert.match(prompt, /Employee id: mira-hr/);
  assert.match(prompt, /Display name: Mira/);
  assert.match(prompt, /Role: hr/);
  assert.match(prompt, /Act as the current employee, not as a generic assistant/);
  assert.doesNotMatch(prompt, /Reply in concise, practical Chinese/);
  assert.doesNotMatch(prompt, /Protocol:/);
  assert.doesNotMatch(prompt, /use handoff for formal task moves/i);
  assert.doesNotMatch(prompt, /handoff takes exactly four fields/i);
  assert.doesNotMatch(prompt, /call handoff at most once/i);
  assert.doesNotMatch(prompt, /Session:/);
  assert.doesNotMatch(prompt, /Message:/);
  assert.ok(prompt.length < 900, `system prompt append too long: ${prompt.length}`);
});

test("buildUserPrompt does not inject shell paths into every user prompt", () => {
  const employee: EmployeeHome = {
    companyId: TEST_COMPANY_ID,
    employeeId: "mira-hr",
    homePath: "D:\\AI\\Codex\\Tiny Office\\companies\\tinyoffice\\employees\\mira-hr",
    workspacePath: "D:\\AI\\Codex\\Tiny Office\\companies\\tinyoffice\\employees\\mira-hr\\workspace",
    profile: {
      employeeId: "mira-hr",
      role: "hr",
      displayName: "Mira",
      presenceMode: "resident",
    },
    resourcePolicy: { version: 1, filesystem: { ownWorkspace: "allow", otherEmployeeWorkspace: "allow", repo: "allow", secrets: "deny" } },
  };

  const prompt = buildUserPrompt({
    employee,
    message: "Check the repo status.",
    sessionKey: "mira-hr|dm_thread|root-1",
  });

  assert.match(prompt, /Scene: dm_thread/);
  assert.match(prompt, /User Message:\nCheck the repo status\./);
  assert.doesNotMatch(prompt, /Shell paths:/);
  assert.doesNotMatch(prompt, /\/mnt\/d\/AI\/Codex\/Tiny Office/);
  assert.doesNotMatch(prompt, /D:[/\\]/);
});

test("reply passes streaming callbacks through to the PI transport", async () => {
  const employee = await createEmployeeHome();
  const transport = new FakeTransport();
  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath: path.join(employee.workspacePath, ".scratch", "sessions"),
    transport,
  });
  const onTextDelta = () => undefined;
  const onSessionEvent = () => undefined;

  await agent.reply({
    message: "Please handle this topic.",
    sessionKey: "mira-hr|channel_thread|post-3",
    onTextDelta,
    onSessionEvent,
  });

  assert.equal(transport.replyCalls.length, 1);
  assert.equal(transport.replyCalls[0].onTextDelta, onTextDelta);
  assert.equal(transport.replyCalls[0].onSessionEvent, onSessionEvent);
});

test("PI transport selection defaults to auto for websocket-preferred stability", () => {
  __clearPiTransportStateForTests();
  const selection = resolveTransportSelection({
    env: {},
    sessionDir: "/tmp/pi-transport-default",
    nowMs: 1000,
  });

  assert.equal(selection.requested, "auto");
  assert.equal(selection.effective, "auto");
  assert.equal(selection.cooldownActive, false);
});

test("PI transport selection preserves explicit sse", () => {
  __clearPiTransportStateForTests();
  const selection = resolveTransportSelection({
    env: {
      PI_EMPLOYEE_PI_TRANSPORT: "sse",
    },
    sessionDir: "/tmp/pi-transport-sse",
    nowMs: 1000,
  });

  assert.equal(selection.requested, "sse");
  assert.equal(selection.effective, "sse");
  assert.equal(selection.cooldownActive, false);
});

test("PI transport selection accepts websocket connect timeout override", () => {
  __clearPiTransportStateForTests();
  const selection = resolveTransportSelection({
    env: {
      PI_EMPLOYEE_PI_TRANSPORT: "auto",
      PI_EMPLOYEE_PI_WEBSOCKET_CONNECT_TIMEOUT_MS: "30000",
    },
    sessionDir: "/tmp/pi-transport-timeout",
    nowMs: 1000,
  });

  assert.equal(selection.effective, "auto");
  assert.equal(selection.websocketConnectTimeoutMs, 30000);
});

test("PI transport selection cools down to sse after repeated websocket-capable failures", () => {
  __clearPiTransportStateForTests();
  const sessionDir = "/tmp/pi-transport-cooldown";
  const env = {
    PI_EMPLOYEE_PI_TRANSPORT: "auto",
    PI_EMPLOYEE_PI_TRANSPORT_MAX_FAILURES: "2",
    PI_EMPLOYEE_PI_TRANSPORT_FAILURE_COOLDOWN_MS: "5000",
  };

  __recordPiTransportFailureForTests({ sessionDir, env, nowMs: 1000 });
  let selection = resolveTransportSelection({ env, sessionDir, nowMs: 1500 });
  assert.equal(selection.effective, "auto");
  assert.equal(selection.cooldownActive, false);

  __recordPiTransportFailureForTests({ sessionDir, env, nowMs: 2000 });
  selection = resolveTransportSelection({ env, sessionDir, nowMs: 2500 });
  assert.equal(selection.requested, "auto");
  assert.equal(selection.effective, "sse");
  assert.equal(selection.cooldownActive, true);
  assert.equal(selection.consecutiveFailures, 2);

  selection = resolveTransportSelection({ env, sessionDir, nowMs: 8000 });
  assert.equal(selection.effective, "auto");
  assert.equal(selection.cooldownActive, false);
});

test("PI transport failure tracking does not count explicit sse failures as websocket instability", () => {
  __clearPiTransportStateForTests();
  const sessionDir = "/tmp/pi-transport-explicit-sse-failure";
  const env = {
    PI_EMPLOYEE_PI_TRANSPORT: "sse",
    PI_EMPLOYEE_PI_TRANSPORT_MAX_FAILURES: "1",
    PI_EMPLOYEE_PI_TRANSPORT_FAILURE_COOLDOWN_MS: "5000",
  };

  __recordPiTransportFailureForTests({ sessionDir, env, nowMs: 1000 });
  const selection = resolveTransportSelection({ env, sessionDir, nowMs: 1500 });

  assert.equal(selection.requested, "sse");
  assert.equal(selection.effective, "sse");
  assert.equal(selection.cooldownActive, false);
  assert.equal(selection.consecutiveFailures, 0);
});

test("buildSystemPromptAppend omits the wake-up protocol in DM scenes", async () => {
  const employee = await createEmployeeHome();
  const prompt = buildSystemPromptAppend({
    employee,
    sessionKey: "mira-hr|dm_thread|post-dm",
  });

  assert.doesNotMatch(prompt, /Protocol:/);
  assert.doesNotMatch(prompt, /An @mention is a real wake-up signal/);
  assert.doesNotMatch(prompt, /take over the next step or task/i);
});

test("loadCompanyPromptBlocks follows prompt-blocks config by scene", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-prompt-blocks-"));
  const employeeHomePath = testEmployeeHomePath(root, "mira-hr");
  await mkdir(employeeHomePath, { recursive: true });
  await setPromptPolicy({
    repoRoot: root,
    always: [],
    scenes: {
      channel_thread: ["channel-scene"],
    },
    contents: {
      "channel-scene": "# Channel Scene\n\nYou are replying in a channel thread.\n",
    },
  });

  const blocks = await loadCompanyPromptBlocks({
    employeeHomePath,
    sessionKey: "mira-hr|channel_thread|post-3",
  });

  assert.deepEqual(blocks.map((block) => block.path), [
    "channel-scene",
  ]);
  assert.match(blocks[0]?.content || "", /channel thread/);
  assert.match(blocks[0]?.sha256 || "", /^[a-f0-9]{64}$/);
});

test("loadCompanyPromptBlocks loads WorkRun execution prompt blocks for work sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-task-prompt-blocks-"));
  const employeeHomePath = testEmployeeHomePath(root, "iris-growth");
  await mkdir(employeeHomePath, { recursive: true });
  await setPromptPolicy({
    repoRoot: root,
    always: [],
    scenes: {
      work_run_execution: ["workrun-scene"],
    },
    contents: {
      "workrun-scene": "# WorkRun Scene\n\nYou are executing a background WorkRun.\n",
    },
  });

  const blocks = await loadCompanyPromptBlocks({
    employeeHomePath,
    sessionKey: "iris-growth|work_run_execution|task-123",
  });

  assert.deepEqual(blocks.map((block) => block.path), [
    "workrun-scene",
  ]);
  assert.match(blocks[0]?.content || "", /background WorkRun/);
});

test("loadCompanyPromptBlocks loads intake prompt blocks for external inbox sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-intake-prompt-blocks-"));
  const employeeHomePath = testEmployeeHomePath(root, "quality-editor");
  await mkdir(employeeHomePath, { recursive: true });
  await setPromptPolicy({
    repoRoot: root,
    always: [],
    scenes: {
      intake_event: ["intake-event"],
    },
    contents: {
      "intake-event": "# Intake Scene\n\nYou are handling an external intake event.\n",
    },
  });

  const blocks = await loadCompanyPromptBlocks({
    employeeHomePath,
    sessionKey: "quality-editor|intake_event|intake-event-1",
  });

  assert.deepEqual(blocks.map((block) => block.path), [
    "intake-event",
  ]);
  assert.match(blocks[0]?.content || "", /external intake event/);
});

test("buildUserPrompt marks task execution sessions as work_run_execution scene", async () => {
  const employee = await createEmployeeHome();
  const prompt = buildUserPrompt({
    employee,
    message: "Task package: task-123",
    sessionKey: "mira-hr|work_run_execution|task-123",
    preferredLanguage: "en-US",
  });

  assert.match(prompt, /Scene: work_run_execution/);
  assert.doesNotMatch(prompt, /Preferred user-visible language/);
});

test("buildUserPrompt marks external inbox sessions as intake_event scene", async () => {
  const employee = await createEmployeeHome();
  const prompt = buildUserPrompt({
    employee,
    message: "External intake event: article quality report",
    sessionKey: "mira-hr|intake_event|intake-event-1",
    preferredLanguage: "en-US",
  });

  assert.match(prompt, /Scene: intake_event/);
  assert.match(prompt, /External intake event: article quality report/);
});

test("loadCompanyPromptBlocks requires DB scene bindings instead of applying code defaults", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-empty-prompt-blocks-"));
  const employeeHomePath = testEmployeeHomePath(root, "mira-hr");
  await mkdir(employeeHomePath, { recursive: true });
  await setPromptPolicy({
    repoRoot: root,
    scenes: {
      dm_thread: [],
      channel_thread: [],
      intake_event: [],
      work_run_execution: [],
    },
  });

  await assert.rejects(
    () => loadCompanyPromptBlocks({
      employeeHomePath,
      sessionKey: "mira-hr|channel_thread|post-3",
    }),
    /Prompt Policy scene channel_thread has no configured prompt block/,
  );
});

test("buildUserPrompt keeps the Channel trigger inside explicit runtime context", async () => {
  const employee = await createEmployeeHome();
  const prompt = buildUserPrompt({
    employee,
    message: "Please ask Nora to collaborate on this.",
    sessionKey: "mira-hr|channel_thread|post-3",
    channelTopicId: "channel-topic-3",
    threadId: "post-3",
    reachableMemberIds: ["nora-automation", "iris-growth"],
    reachableParticipants: [
      { id: "nora-automation" },
      { id: "iris-growth" },
      {
        id: "xuziho",
        participantKind: "company_member",
        role: "boss",
        displayName: "Xu Ziho",
        summary: "Final report target and approval authority for company work.",
        runtimeCapable: false,
      },
    ],
    requesterUsername: "xuziho",
    contextBlocks: [{
      role: "channel_thread_context",
      source: "tinyoffice.chat_topic_context",
      label: "Topic context",
      text: [
        "Handoff candidates:",
        "- nora-automation",
        "- iris-growth",
        "- Xu Ziho (xuziho): role=boss",
        "- [trigger] Xu Ziho: Please ask Nora to collaborate on this.",
      ].join("\n"),
    }],
  });

  assert.doesNotMatch(prompt, /Session: mira-hr\|channel_thread\|post-3/);
  assert.doesNotMatch(prompt, /ChannelTopic: channel-topic-3/);
  assert.doesNotMatch(prompt, /Thread: post-3/);
  assert.match(prompt, /Scene: channel_thread/);
  assert.doesNotMatch(prompt, /Preferred user-visible language/);
  assert.doesNotMatch(prompt, /Use the preferred language for user-visible progress/);
  assert.doesNotMatch(prompt, /Requester: xuziho/);
  assert.doesNotMatch(prompt, /Persistent PI reply context:/);
  assert.match(prompt, /Handoff candidates:\n- nora-automation\n- iris-growth\n- Xu Ziho \(xuziho\): role=boss/);
  assert.doesNotMatch(prompt, /kind=company_member/);
  assert.doesNotMatch(prompt, /handoff=returns to user/);
  assert.doesNotMatch(prompt, /handoff=continues runtime/);
  assert.doesNotMatch(prompt, /User Message:/);
  assert.equal(prompt.match(/Please ask Nora to collaborate on this\./g)?.length, 1);
  assert.doesNotMatch(prompt, /Protocol:/);
});

test("loadEmployeeInstructionFiles reads only employee home AGENTS.md", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-employee-instructions-"));
  const employeeHomePath = testEmployeeHomePath(root, "mira-hr");
  const workspacePath = path.join(employeeHomePath, "workspace");
  await mkdir(workspacePath, { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "ROOT PROJECT INSTRUCTIONS", "utf8");
  await writeFile(path.join(employeeHomePath, "AGENTS.md"), "MIRA HOME INSTRUCTIONS", "utf8");
  await writeFile(path.join(employeeHomePath, "CLAUDE.md"), "MIRA HOME CLAUDE INSTRUCTIONS", "utf8");
  await writeFile(path.join(workspacePath, "AGENTS.md"), "MIRA WORKSPACE INSTRUCTIONS", "utf8");
  await writeFile(path.join(workspacePath, "CLAUDE.md"), "MIRA WORKSPACE CLAUDE INSTRUCTIONS", "utf8");

  const files = await loadEmployeeInstructionFiles({
    employeeHomePath,
    workspacePath,
  });

  assert.deepEqual(
    files.map((file) => path.basename(path.dirname(file.path)) + "/" + path.basename(file.path)),
    ["mira-hr/AGENTS.md"],
  );
  assert.match(files.map((file) => file.content).join("\n"), /MIRA HOME INSTRUCTIONS/);
  assert.doesNotMatch(files.map((file) => file.content).join("\n"), /ROOT PROJECT INSTRUCTIONS/);
  assert.doesNotMatch(files.map((file) => file.content).join("\n"), /CLAUDE INSTRUCTIONS/);
  assert.doesNotMatch(files.map((file) => file.content).join("\n"), /WORKSPACE INSTRUCTIONS/);
});

test("loadEmployeeSkillPaths returns current Company and Employee skill directories without a global Skill scope", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-employee-skills-"));
  const employeeHomePath = testEmployeeHomePath(root, "mira-hr");
  const companySkillsPath = path.join(root, "companies", TEST_COMPANY_ID, "skills");
  const employeeSkillsPath = path.join(employeeHomePath, "skills");
  await mkdir(companySkillsPath, { recursive: true });
  await mkdir(employeeSkillsPath, { recursive: true });

  const paths = await loadEmployeeSkillPaths({ employeeHomePath });

  assert.deepEqual(paths, [companySkillsPath, employeeSkillsPath]);
});

test("persistent PI employee agent no longer writes PI local prompt files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-context-boundary-"));
  const employeeHomePath = testEmployeeHomePath(root, "mira-hr");
  const workspacePath = path.join(employeeHomePath, "workspace");
  const companySkillPath = path.join(root, "companies", TEST_COMPANY_ID, "skills", "company-common");
  const employeeSkillPath = path.join(employeeHomePath, "skills", "mira-hr-specialist");
  await mkdir(workspacePath, { recursive: true });
  await mkdir(companySkillPath, { recursive: true });
  await mkdir(employeeSkillPath, { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "ROOT PROJECT INSTRUCTIONS SHOULD NOT LOAD", "utf8");
  await writeFile(path.join(employeeHomePath, "AGENTS.md"), "MIRA EMPLOYEE INSTRUCTIONS SHOULD LOAD", "utf8");
  await setPromptPolicy({
    repoRoot: root,
    always: ["channel-scene"],
    scenes: {
      channel_thread: [],
    },
    contents: {
      "channel-scene": "# Channel Scene\n\nYou are replying in a channel thread.\n",
    },
  });
  await writeFile(
    path.join(companySkillPath, "SKILL.md"),
    [
      "---",
      "name: company-common",
      "description: Company-wide work standard.",
      "---",
      "",
      "# Company Common",
      "",
      "COMPANY SKILL BODY SHOULD NOT BE IN PROMPT",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(employeeSkillPath, "SKILL.md"),
    [
      "---",
      "name: mira-hr-specialist",
      "description: Mira-specific HR workflow.",
      "---",
      "",
      "# Mira HR Specialist",
      "",
      "EMPLOYEE SKILL BODY SHOULD NOT BE IN PROMPT",
    ].join("\n"),
    "utf8",
  );

  const employee: EmployeeHome = {
    companyId: TEST_COMPANY_ID,
    employeeId: "mira-hr",
    homePath: employeeHomePath,
    workspacePath,
    profile: {
      employeeId: "mira-hr",
      role: "hr",
      displayName: "Mira",
      presenceMode: "resident",
      mountedActions: [],
    },
    permissionRules: [],
    runtimeConfig: fakeTransportRuntimeModel(),
  };
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));
  const transport = new FakeTransport();
  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    sessionKey: "mira-hr|dm_thread|context-boundary",
    transport,
  });

  await agent.start();

  const startCall = transport.startCalls[0];
  assert.ok(startCall);
  assert.match(startCall.systemPromptAppend, /You are an employee in TinyOffice/);
  assert.deepEqual(startCall.promptBlocks?.map((block) => block.path), ["channel-scene", "dm-scene"]);
  assert.match(startCall.promptBlocks?.[0]?.content || "", /channel thread/);
  assert.match(startCall.promptBlocks?.[1]?.content || "", /direct-message thread/);
  assert.match(startCall.promptBlocks?.[0]?.sha256 || "", /^[a-f0-9]{64}$/);
  assert.rejects(
    () => access(path.join(sessionRootPath, "prompt-snapshot.json")),
    { code: "ENOENT" },
  );
});

test("persistent PI employee agent uses Channel context as the complete turn input", async () => {
  const employee = await createEmployeeHome();
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));
  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
  });

  await agent.reply({
    message: "Please ask Nora to collaborate on this.",
    sessionKey: "mira-hr|channel_thread|post-compiler",
    contextBlocks: [{
      role: "channel_thread_context",
      source: "tinyoffice.channel_topic_context",
      label: "TinyOffice Channel/Topic context",
      text: "- [trigger] Xu: Please ask Nora to collaborate on this.",
    }],
    reachableMemberIds: ["nora-automation"],
    requesterUsername: "xuziho",
    preferredLanguage: "en-US",
  });

  const prompt = transport.replyCalls[0]?.userPrompt || "";
  assert.match(prompt, /^Runtime Context:/);
  assert.doesNotMatch(prompt, /Persistent PI reply context:/);
  assert.doesNotMatch(prompt, /Preferred user-visible language/);
  assert.doesNotMatch(prompt, /Handoff candidates:\n- nora-automation/);
  assert.doesNotMatch(prompt, /User Message:/);
  assert.equal(prompt.match(/Please ask Nora to collaborate on this\./g)?.length, 1);
  assert.doesNotMatch(prompt, /^Context:/);
  assert.ok(!prompt.includes("\nMessage:\n"));
});

test("persistent PI employee agent uses configured prompt policy templates for model calls", async () => {
  const employee = await createEmployeeHome();
  const repoRoot = repoRootFromTestEmployeeHome(employee.homePath);
  await setPromptPolicy({ repoRoot });
  await savePromptPolicyTemplateContent({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    templateId: "base-system-prompt",
    content: "Configured base for {employeeId} / {displayName} / {role}",
  });
  await savePromptPolicyTemplateContent({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    templateId: "runtime-prompt-template",
    content: [
      "Configured scene: {sceneType}",
      "{contextBlocks}",
      "Configured user: {userMessage}",
    ].join("\n"),
  });
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));
  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
  });

  await agent.reply({
    message: "Please use the saved template.",
    sessionKey: "mira-hr|dm_thread|post-template",
    requesterUsername: "xuziho",
  });

  assert.equal(
    transport.replyCalls[0]?.systemPromptAppend,
    "Configured base for mira-hr / Mira / hr",
  );
  assert.match(transport.replyCalls[0]?.userPrompt || "", /Configured scene: dm_thread/);
  assert.doesNotMatch(transport.replyCalls[0]?.userPrompt || "", /Persistent PI reply context:/);
  assert.match(transport.replyCalls[0]?.userPrompt || "", /Configured user: Please use the saved template\./);
  assert.doesNotMatch(transport.replyCalls[0]?.userPrompt || "", /^Runtime Context:/);
});

test("persistent PI employee agent includes the Channel trigger only inside room context", async () => {
  const employee = await createEmployeeHome();
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));
  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
  });

  await agent.reply({
    message: "Please decide who owns this topic.",
    sessionKey: "mira-hr|channel_thread|post-room-context",
    contextBlocks: [{
      role: "channel_thread_context",
      source: "tinyoffice.channel_topic_context",
      label: "TinyOffice Channel/Topic context",
      text: "Earlier post: please involve Nora.\n- [trigger] Xu: Please decide who owns this topic.",
    }],
  });

  const prompt = transport.replyCalls[0]?.userPrompt || "";
  assert.match(prompt, /TinyOffice Channel\/Topic context:/);
  assert.match(prompt, /Earlier post: please involve Nora\./);
  assert.doesNotMatch(prompt, /Completion Policy:/);
  assert.doesNotMatch(prompt, /User Message:/);
  assert.equal(prompt.match(/Please decide who owns this topic\./g)?.length, 1);
});

test("persistent PI employee agent opens a session on first reply and reuses continuity for later replies", async () => {
  const employee = await createEmployeeHome();
  await setPromptPolicy({ repoRoot: repoRootFromTestEmployeeHome(employee.homePath) });
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));

  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
    env: {
      PI_EMPLOYEE_ID: employee.employeeId,
      PI_EMPLOYEE_ROLE: employee.profile.role,
    },
  });
  transport.employeeInstructionFiles = [{
    path: path.join(employee.homePath, "AGENTS.md"),
    content: "Mira employee local operating instructions.",
  }];

  const firstStatus = agent.getStatus();
  assert.equal(firstStatus.bootstrapped, false);

  const reply = await agent.reply({
    message: "Please review this task.",
    sessionKey: "mira-hr|channel_thread|post-1",
    channelTopicId: "channel-topic-1",
    threadId: "post-1",
    actorMemberId: "mira-hr",
    reachableMemberIds: ["nora-automation", "iris-growth"],
    reachableParticipants: [
      { id: "nora-automation" },
      { id: "iris-growth" },
      {
        id: "xuziho",
        participantKind: "company_member",
        role: "boss",
        displayName: "Xu Ziho",
        summary: "Final report target and approval authority for company work.",
        runtimeCapable: false,
      },
    ],
    requesterUsername: "xuziho",
  });

  assert.equal(reply.message, "Hello, I received it.");
  assert.equal(reply.promptInputPackage.employeeInstructions[0]?.path, path.join(employee.homePath, "AGENTS.md"));
  assert.equal(reply.promptInputPackage.employeeInstructions[0]?.content, "Mira employee local operating instructions.");
  assert.match(reply.promptInputPackage.employeeInstructions[0]?.sha256 || "", /^[a-f0-9]{64}$/);
  assert.equal(transport.replyCalls.length, 1);
  assert.equal(transport.replyCalls[0]?.env.PI_EMPLOYEE_ID, "mira-hr");
  assert.equal(transport.replyCalls[0]?.env.PI_EMPLOYEE_ROLE, "hr");
  assert.match(transport.replyCalls[0]?.env.PI_CONVERSATION_CONTEXT_JSON || "", /"companyId":"tinyoffice"/);
  assert.match(transport.replyCalls[0]?.env.PI_CONVERSATION_CONTEXT_JSON || "", /"channelTopicId":"channel-topic-1"/);
  assert.match(transport.replyCalls[0]?.env.PI_CONVERSATION_CONTEXT_JSON || "", /"actorMemberId":"mira-hr"/);
  assert.match(transport.replyCalls[0]?.env.PI_CONVERSATION_CONTEXT_JSON || "", /"preferredLanguage":"en-US"/);
  const systemPrompt = transport.replyCalls[0]?.systemPromptAppend || "";
  const firstPrompt = transport.replyCalls[0]?.userPrompt || "";
  assert.match(systemPrompt, /You are an employee in TinyOffice/i);
  assert.doesNotMatch(systemPrompt, /In multi-party work threads, use handoff for formal task moves/i);
  assert.doesNotMatch(systemPrompt, /available participant roles/i);
  assert.deepEqual(transport.replyCalls[0]?.promptBlocks?.map((block) => block.path), ["channel-scene"]);
  assert.doesNotMatch(systemPrompt, /call handoff at most once/i);
  assert.doesNotMatch(firstPrompt, /Thread: post-1/);
  assert.match(firstPrompt, /Scene: channel_thread/);
  assert.doesNotMatch(firstPrompt, /Preferred user-visible language/);
  assert.doesNotMatch(firstPrompt, /Handoff candidates:\n- nora-automation\n- iris-growth\n- Xu Ziho \(xuziho\): role=boss/);
  assert.doesNotMatch(firstPrompt, /kind=company_member/);
  assert.doesNotMatch(firstPrompt, /handoff=returns to user/);
  assert.doesNotMatch(firstPrompt, /handoff=continues runtime/);
  assert.doesNotMatch(firstPrompt, /Requester: xuziho/);
  assert.doesNotMatch(firstPrompt, /Persistent PI reply context:/);
  assert.doesNotMatch(firstPrompt, /Protocol:/);

  const afterStatus = agent.getStatus();
  assert.equal(afterStatus.bootstrapped, true);

  await agent.reply({
    message: "Continue follow-up.",
    sessionKey: "mira-hr|channel_thread|post-1",
  });

  assert.equal(transport.replyCalls.length, 2);
});

test("persistent PI employee agent exposes concrete DM source context without placeholder thread ids", async () => {
  const employee = await createEmployeeHome();
  await setPromptPolicy({ repoRoot: repoRootFromTestEmployeeHome(employee.homePath) });
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));

  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
  });

  await agent.reply({
    message: "Create the agreed task.",
    sessionKey: "mira-hr|dm_thread|conversation-direct-work",
    roomId: "conversation-direct-work",
    conversationId: "conversation-direct-work",
    messageId: "message-create-task",
    chatEntryId: "entry-create-task",
    actorMemberId: "xuziho",
    requesterUsername: "xuziho",
  });

  const rawContext = transport.replyCalls[0]?.env.PI_CONVERSATION_CONTEXT_JSON;
  assert.ok(rawContext, "conversation context env should be present");
  const context = JSON.parse(rawContext);
  assert.equal(context.threadId, undefined);
  assert.equal(context.roomId, "conversation-direct-work");
  assert.equal(context.conversationId, "conversation-direct-work");
  assert.equal(context.messageId, "message-create-task");
  assert.equal(context.chatEntryId, "entry-create-task");
  assert.equal(context.actorMemberId, "xuziho");
  assert.doesNotMatch(rawContext, /"none"/);
});

test("persistent PI employee agent exposes the WorkRun id to guarded tools", async () => {
  const employee = await createEmployeeHome();
  await setPromptPolicy({ repoRoot: repoRootFromTestEmployeeHome(employee.homePath) });
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));
  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
  });

  await agent.reply({
    message: "Start the protected configuration preflight.",
    sessionKey: "mira-hr|work_run_execution|work-run-123",
    threadId: "work-run-123",
  });

  const rawContext = transport.replyCalls[0]?.env.PI_CONVERSATION_CONTEXT_JSON;
  assert.ok(rawContext, "conversation context env should be present");
  const context = JSON.parse(rawContext);
  assert.equal(context.workRunId, "work-run-123");
  assert.equal(context.threadId, "work-run-123");
});

test("persistent PI employee agent passes configured prompt blocks to the transport", async () => {
  const employee = await createEmployeeHome();
  await setPromptPolicy({
    repoRoot: repoRootFromTestEmployeeHome(employee.homePath),
    scenes: {
      channel_thread: ["channel-scene"],
    },
    contents: {
      "channel-scene": "# Channel Scene\n\nYou are replying in a channel thread.\n",
    },
  });
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));

  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
  });

  await agent.reply({
    message: "Please move this forward.",
    sessionKey: "mira-hr|channel_thread|post-with-block",
  });

  assert.equal(transport.replyCalls[0]?.promptBlocks?.length, 1);
  assert.match(transport.replyCalls[0]?.promptBlocks?.[0]?.content || "", /channel thread/);
  assert.equal(transport.replyCalls[0]?.promptBlocks?.[0]?.path, "channel-scene");
});

test("persistent PI employee agent keeps scene policy in the system prompt only", async () => {
  const employee = await createEmployeeHome();
  await setPromptPolicy({
    repoRoot: repoRootFromTestEmployeeHome(employee.homePath),
    scenes: {
      channel_thread: ["channel-scene"],
    },
    contents: {
      "channel-scene": [
        "# Channel Scene",
        "",
        "Write the visible assistant reply as normal assistant text.",
        "Before ending every channel turn, call `handoff_topic_turn` exactly once.",
      ].join("\n"),
    },
  });
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));

  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
  });

  const reply = await agent.reply({
    message: "Please move this forward.",
    sessionKey: "mira-hr|channel_thread|post-with-policy-context",
  });

  const prompt = transport.replyCalls[0]?.userPrompt || "";
  assert.doesNotMatch(prompt, /Prompt Policy: channel-scene:/);
  assert.doesNotMatch(prompt, /call `handoff_topic_turn` exactly once/);
  assert.doesNotMatch(reply.promptInputPackage.runtimePrompt.userPrompt, /call `handoff_topic_turn` exactly once/);
  assert.match(transport.replyCalls[0]?.promptBlocks?.[0]?.content || "", /call `handoff_topic_turn` exactly once/);
});

test("persistent PI employee agent can narrow active tools for forced finalization", async () => {
  const employee = await createEmployeeHome();
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));

  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
  });

  await agent.reply({
    message: "Finalize the intercepted thread reply through handoff.",
    sessionKey: "mira-hr|channel_thread|post-finalize",
    activeToolNames: ["handoff"],
  });

  assert.deepEqual(transport.replyCalls[0]?.activeToolNames, ["handoff"]);
});

test("persistent PI employee agent public entry stays thin after boundary split", async () => {
  const source = await readFile(
    path.resolve("src/runtime/pi/persistent-pi-employee-agent.ts"),
    "utf8",
  );
  const nonEmptyLines = source
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  assert.ok(
    nonEmptyLines.length <= 80,
    `public entry should stay thin; found ${nonEmptyLines.length} non-empty lines`,
  );
  assert.doesNotMatch(source, /\bcreateAgentSession\s*\(/);
  assert.doesNotMatch(source, /\bclass\s+DefaultPiSessionTransport\b/);
});

test("default PI transport applies narrowed active tools when creating the session", async () => {
  const source = await readFile(
    path.resolve("src/runtime/pi/persistent-pi-session-transport.ts"),
    "utf8",
  );

  const createSessionIndex = source.indexOf("private async createSession");
  const setActiveToolsIndex = source.indexOf("session.setActiveToolsByName(input.activeToolNames);", createSessionIndex);
  const returnSessionIndex = source.indexOf("return session;", createSessionIndex);

  assert.ok(createSessionIndex > 0, "createSession implementation should exist");
  assert.ok(setActiveToolsIndex > createSessionIndex, "createSession should apply narrowed active tools");
  assert.ok(
    setActiveToolsIndex < returnSessionIndex,
    "narrowed active tools must be applied before the session is returned",
  );
});

test("runtime model config must be explicit before starting a PI employee session", () => {
  assert.deepEqual(
    assertExplicitEmployeeRuntimeModel("mira-hr", {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "low",
    }),
    { provider: "openai", id: "gpt-5-codex" },
  );

  assert.throws(
    () => assertExplicitEmployeeRuntimeModel("mira-hr", {
      version: 1,
      thinkingLevel: "minimal",
    }),
    /Employee mira-hr runtime model is required/,
  );
});

test("default PI transport validates explicit runtime model before creating the session", async () => {
  const source = await readFile(
    path.resolve("src/runtime/pi/persistent-pi-session-transport.ts"),
    "utf8",
  );

  const createSessionIndex = source.indexOf("private async createSession");
  const assertIndex = source.indexOf("assertExplicitEmployeeRuntimeModel(", createSessionIndex);
  const sdkCreateIndex = source.indexOf("await createAgentSession({", createSessionIndex);

  assert.ok(createSessionIndex > 0, "createSession implementation should exist");
  assert.ok(assertIndex > createSessionIndex, "createSession should validate the runtime model");
  assert.ok(
    assertIndex < sdkCreateIndex,
    "runtime model validation must happen before PI SDK session creation",
  );
});

test("persistent PI employee agent serializes the first and second replies for the same employee session", async () => {
  const employee = await createEmployeeHome();
  const transport = new DeferredTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));

  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    transport,
  });

  const firstReplyPromise = agent.reply({
    message: "Please contact Iris to review content quality together.",
    sessionKey: "mira-hr|channel_thread|post-2",
  });
  const secondReplyPromise = agent.reply({
    message: "If needed, add a summary for me.",
    sessionKey: "mira-hr|channel_thread|post-2",
  });

  await waitForCondition(() => transport.replyCalls.length === 1);
  assert.equal(transport.replyCalls.length, 1);

  transport.resolveNext("Okay, I will contact Iris first.");
  await waitForCondition(() => transport.replyCalls.length === 2);
  assert.equal(transport.replyCalls.length, 2);

  transport.resolveNext("This is an additional summary.");

  const firstReply = await firstReplyPromise;
  const secondReply = await secondReplyPromise;
  assert.equal(firstReply.message, "Okay, I will contact Iris first.");
  assert.equal(secondReply.message, "This is an additional summary.");
  assert.equal(agent.getStatus().bootstrapped, true);
});

test("persistent PI employee agent start eagerly bootstraps the SDK session", async () => {
  const employee = await createEmployeeHome();
  await setPromptPolicy({ repoRoot: repoRootFromTestEmployeeHome(employee.homePath) });
  const transport = new FakeTransport();
  const sessionRootPath = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-sessions-"));

  const agent = new PersistentPiEmployeeAgent(employee, {
    sessionRootPath,
    sessionKey: "mira-hr|channel_thread|warmup-post",
    transport,
    env: {
      PI_EMPLOYEE_ID: employee.employeeId,
      PI_EMPLOYEE_ROLE: employee.profile.role,
    },
  });

  await agent.start();

  assert.equal(transport.startCalls.length, 1);
  assert.equal(agent.getStatus().bootstrapped, true);
  const systemPrompt = transport.startCalls[0]?.systemPromptAppend || "";
  assert.doesNotMatch(systemPrompt, /In multi-party work threads, use handoff for formal task moves/i);
  assert.doesNotMatch(systemPrompt, /available participant roles/i);
  assert.deepEqual(transport.startCalls[0]?.promptBlocks?.map((block) => block.path), ["channel-scene"]);
  assert.doesNotMatch(systemPrompt, /Runtime task and thread context are injected automatically/i);
});
