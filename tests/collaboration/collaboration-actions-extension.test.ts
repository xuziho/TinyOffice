import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import collaborationActionsExtension from "../../src/collaboration/pi/collaboration-actions-extension.js";
import { createCollaborationPiToolGateway } from "../../src/collaboration/pi/collaboration-pi-tool-gateway.js";
import { OperatingLogRepository } from "../../src/operating-log/index.js";
import { companyEmployeeHomePath } from "../../src/runtime/company-config/company-paths.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { loadEmployeesAdminState } from "../../src/runtime/company-config/employees-admin.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { registerTinyOfficeRealtimePublisher } from "../../src/collaboration/contracts/tinyoffice-realtime-publisher-registry.js";
import { DefaultResourceLoader } from "../../src/runtime/pi/pi-coding-agent-sdk.js";
import { RuntimeSessionRepository } from "../../src/runtime/storage/runtime-session-repository.js";
import { loadTasksViewModel } from "../../src/work/tasks-loader.js";
import { WorkRepository } from "../../src/work/work-repository.js";
import { WorkService } from "../../src/work/work-service.js";

interface RegisteredTool {
  name: string;
  description?: string;
  parameters?: {
    required?: string[];
    properties?: Record<string, { description?: string }>;
  };
  execute(toolCallId: string, params: unknown): Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
}

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return fn().finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function writeEmployeeHomeFixture(input: {
  repoRoot: string;
  employeeId: string;
  displayName?: string;
  role?: string;
  mountedActions: string[];
  companyId: string;
}) {
  await ensureCompanyFixture(input.repoRoot, input.companyId);
  const homePath = companyEmployeeHomePath({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
    employeeId: input.employeeId,
  });
  const profile = {
    employeeId: input.employeeId,
    displayName: input.displayName || input.employeeId,
    role: input.role || "employee",
    presenceMode: "resident",
    mountedActions: input.mountedActions,
  };
  await mkdir(path.join(homePath, "workspace"), { recursive: true });
  const directory = await CompanyDirectoryRepository.open(input.repoRoot, {
    companyId: input.companyId,
  });
  try {
    await directory.upsertEmployee({
      employeeId: input.employeeId,
      enabled: true,
      profile,
      permissions: input.mountedActions.map((actionName) => ({
        employeeId: input.employeeId,
        actionName,
        decision: "allow" as const,
      })),
      runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
    });
    await directory.save();
  } finally {
    directory.close();
  }
}

async function ensureCompanyFixture(repoRoot: string, companyId: string): Promise<void> {
  const postgres = await openConfiguredPostgresConnection(repoRoot, { companyId });
  assert.ok(postgres);
  try {
    await postgres.client.query(
      `INSERT INTO companies (company_id, display_name, created_at, updated_at)
VALUES ($1, $2, NOW(), NOW())
ON CONFLICT (company_id) DO NOTHING`,
      [companyId, companyId],
    );
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

async function writeCompanyMemberFixture(input: {
  repoRoot: string;
  companyId: string;
  memberId: string;
  displayName?: string;
  role?: string;
  summary?: string;
}) {
  await ensureCompanyFixture(input.repoRoot, input.companyId);
  const postgres = await openConfiguredPostgresConnection(input.repoRoot, { companyId: input.companyId });
  assert.ok(postgres);
  try {
    await postgres.client.query(
      `INSERT INTO company_members (
  company_id, id, display_name, role, summary, avatar_seed, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $2, NOW(), NOW())
ON CONFLICT (company_id, id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  summary = EXCLUDED.summary,
  updated_at = EXCLUDED.updated_at`,
      [
        input.companyId,
        input.memberId,
        input.displayName || input.memberId,
        input.role || "member",
        input.summary || null,
      ],
    );
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

test("collaboration actions extension keeps final tools inside the PI tool gateway boundary", async () => {
  const source = await readFile(
    path.resolve("src/collaboration/pi/collaboration-actions-extension.ts"),
    "utf8",
  );

  assert.match(source, /createCollaborationPiToolGateway/);
  assert.doesNotMatch(source, /createCollaborationPiDaemon/);
  assert.doesNotMatch(source, /appendCollaborationToolCallLog/);
  assert.match(source, /finish_intake_turn/);
  assert.match(source, /gateway\.buildContext\(\)/);
  assert.doesNotMatch(source, /name: "plan_work"/);
  assert.doesNotMatch(source, /name: "record_operating_event"/);
});

test("collaboration PI tool gateway normalizes ambient runtime context", () => {
  const gateway = createCollaborationPiToolGateway({
    env: {
      PI_EMPLOYEE_ID: "nora-automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      TASK_REPO_ROOT: "D:/repo",
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        channelTopicId: "channel-topic-1",
        threadId: "thread-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        workRunId: "work-run-1",
        actorMemberId: "xuziho",
        reachableMemberIds: ["nora-automation", "", "iris-growth"],
        reachableParticipants: [
          { id: "nora-automation" },
          { id: "" },
          null,
          { id: "iris-growth", role: "employee" },
        ],
        preferredLanguage: "zh-CN",
      }),
    },
    cwd: () => "D:/fallback",
  });

  assert.deepEqual(gateway.buildContext(), {
    channelTopicId: "channel-topic-1",
    threadId: "thread-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    workRunId: "work-run-1",
    runtimeEmployeeId: "nora-automation",
    actorMemberId: "xuziho",
    companyId: DEFAULT_COMPANY_ID,
    reachableMemberIds: ["nora-automation", "iris-growth"],
    reachableParticipants: [
      { id: "nora-automation" },
      { id: "" },
      { id: "iris-growth", role: "employee" },
    ],
    preferredLanguage: "zh-CN",
  });
  assert.equal(gateway.repoRoot(), "D:/repo");
});

test("collaboration actions extension exposes only current model-visible tools", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  assert.equal(tools.has("handoff"), false);
  assert.equal(tools.has("request_approval"), false);
  assert.equal(tools.has("report_progress"), false);
  assert.deepEqual([...tools.keys()].sort(), [
    "finish_intake_turn",
    "finish_work_turn",
    "handoff_topic_turn",
    "recall_memory",
    "tinyoffice_capability_call",
    "tinyoffice_capability_describe",
    "tinyoffice_capability_list",
  ]);
  assert.equal(tools.has("tinyoffice_api_request"), false);
});

test("tinyoffice_capability_list exposes product categories for capability discovery", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const list = tools.get("tinyoffice_capability_list");
  assert.ok(list);

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        sessionKey: "nora-automation|work_run_execution|work-run-capability-list",
        workRunId: "work-run-capability-list",
        actorMemberId: "nora-automation",
        reachableMemberIds: ["nora-automation"],
      }),
    },
    async () => list.execute("tool-capability-list", {}),
  );
  const capabilities = result.details.capabilities as Array<{
    id?: string;
    category?: string;
    allowedScenes?: string[];
  }>;

  assert.equal(result.details.scene, "work_run");
  assert.equal(capabilities.every((entry) => entry.allowedScenes?.includes("work_run")), true);
  assert.equal(capabilities.some((entry) =>
    entry.id === "company.member.directory.list" &&
    entry.category === "member"
  ), true);
  assert.equal(capabilities.some((entry) => entry.id === "skill.list"), false);
  assert.equal(capabilities.some((entry) =>
    entry.id === "work.list" &&
    entry.category === "work"
  ), true);
});

test("handoff_topic_turn describes the required single-transfer Handoff candidates contract", async () => {
  const tools = new Map<string, RegisteredTool & { label?: string; description?: string }>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool & { label?: string; description?: string });
    },
  });

  const handoff = tools.get("handoff_topic_turn");
  assert(handoff);
  assert.match(handoff.description || "", /required channel-topic state action/i);
  assert.match(handoff.description || "", /exactly once before ending the current channel-topic turn/i);
  assert.match(handoff.description || "", /choose the user's participant id/i);
  assert.doesNotMatch(handoff.description || "", /after (writing )?the visible/i);
  assert.doesNotMatch(handoff.description || "", /human|operator/i);
  const properties = handoff.parameters?.properties as Record<string, { description?: string }> | undefined;
  assert.match(properties?.toId?.description || "", /Handoff candidates/);
  assert.match(properties?.toId?.description || "", /exactly one/i);
  assert.doesNotMatch(properties?.toId?.description || "", /visible channel topic participants/i);
});

test("handoff_topic_turn rejects unreachable ids immediately and accepts a current candidate", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });
  const handoff = tools.get("handoff_topic_turn");
  assert.ok(handoff);

  await withEnv({
    PI_EMPLOYEE_ID: "noah",
    PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
      companyId: DEFAULT_COMPANY_ID,
      sessionKey: "noah|chat_topic_room|conversation-1",
      reachableMemberIds: ["lina", "noah"],
      reachableParticipants: [
        { id: "lina", displayName: "Lina", runtimeCapable: true },
        { id: "owner", displayName: "Xu Ziho", runtimeCapable: false },
      ],
    }),
  }, async () => {
    await assert.rejects(
      handoff.execute("tool-invalid", { toId: "xu-ziho" }),
      /not a current Handoff candidate[^]*id="owner"; displayName="Xu Ziho"/,
    );
    const result = await handoff.execute("tool-valid", { toId: "owner" });
    assert.deepEqual(result.details, {
      status: "allowed",
      result: { toId: "owner" },
    });
  });
});

test("finish_work_turn describes each WorkRun final status and required evidence contract", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const finishWorkTurn = tools.get("finish_work_turn");
  assert(finishWorkTurn);
  assert.match(finishWorkTurn.description || "", /complete.*acceptanceCriteria/i);
  assert.match(finishWorkTurn.description || "", /in_progress.*not finished/i);
  assert.match(finishWorkTurn.description || "", /blocked.*outside input/i);
  assert.match(finishWorkTurn.description || "", /failed.*cannot complete/i);
  assert.match(finishWorkTurn.description || "", /canceled.*operator requested/i);

  const properties = finishWorkTurn.parameters?.properties;
  assert.match(properties?.status?.description || "", /complete.*evidence/i);
  assert.match(properties?.status?.description || "", /in_progress.*continue/i);
  assert.match(properties?.status?.description || "", /blocked.*blocker/i);
  assert.match(properties?.status?.description || "", /failed.*not canceled/i);
  assert.match(properties?.status?.description || "", /canceled.*not.*self-cancel/i);
  assert.match(properties?.evidence?.description || "", /required when status is complete/i);
  assert.match(properties?.blockerMessage?.description || "", /required only when status is blocked/i);
  assert.equal(finishWorkTurn.parameters?.required?.includes("evidence"), false);
  assert.equal(finishWorkTurn.parameters?.required?.includes("blockerMessage"), false);
  assert.equal(properties?.handoffToMemberId, undefined);
  assert.equal(properties?.handoffReason, undefined);
  assert.doesNotMatch(JSON.stringify(finishWorkTurn.parameters), /handoff/);
});

test("finish_intake_turn exposes only supported outcomes and keeps intake provenance runtime-owned", () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const finishIntakeTurn = tools.get("finish_intake_turn");
  assert(finishIntakeTurn);
  assert.match(finishIntakeTurn.description || "", /creates work or records an operating event/i);
  assert.doesNotMatch(finishIntakeTurn.description || "", /approval/i);

  const operatingEvent = finishIntakeTurn.parameters?.properties?.operatingEvent as {
    properties?: Record<string, unknown>;
  } | undefined;
  assert.equal(operatingEvent?.properties?.sourceIntakeEventId, undefined);
  assert.equal(operatingEvent?.properties?.sourceKind, undefined);
  assert.equal(operatingEvent?.properties?.sourceId, undefined);
});

test("collaboration tool schemas use optional fields instead of empty-string placeholders", () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const recallMemory = tools.get("recall_memory");
  assert(recallMemory);
  assert.deepEqual(recallMemory.parameters?.required || [], []);
  assert.equal(recallMemory.parameters?.properties?.limit?.type, "number");

  const capabilityCall = tools.get("tinyoffice_capability_call");
  assert(capabilityCall);
  const confirmation = capabilityCall.parameters?.properties?.confirmation as {
    properties?: Record<string, { type?: string }>;
  } | undefined;
  assert.equal(confirmation?.properties?.accepted?.type, "boolean");
});

test("collaboration PI tool gateway can resolve companyId from ambient context", () => {
  const gateway = createCollaborationPiToolGateway({
    env: {
      PI_EMPLOYEE_ID: "nora-automation",
      TASK_REPO_ROOT: "D:/repo",
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        companyId: DEFAULT_COMPANY_ID,
        conversationId: "conversation-ambient-company",
        reachableMemberIds: ["nora-automation"],
      }),
    },
    cwd: () => "D:/fallback",
  });

  assert.equal(gateway.optionalCompanyId(), DEFAULT_COMPANY_ID);
  assert.equal(gateway.buildContext().companyId, DEFAULT_COMPANY_ID);
});

test("tinyoffice_capability_call reads registered capabilities through runtime services", async () => {
  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-api-"));
  await writeEmployeeHomeFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "nora-automation",
    displayName: "Nora",
    role: "automation",
    mountedActions: [],
  });

  const loader = new DefaultResourceLoader({
    cwd: sandboxRoot,
    agentDir: path.join(sandboxRoot, ".pi-agent"),
    noContextFiles: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [{
      name: "tinyoffice-collaboration-actions",
      factory: collaborationActionsExtension,
    }],
  });
  await loader.reload();
  const extensionResult = loader.getExtensions();
  assert.deepEqual(extensionResult.errors, []);
  const inlineExtension = extensionResult.extensions.find(
    (extension) => extension.path === "<inline:tinyoffice-collaboration-actions>",
  );
  assert.ok(inlineExtension);
  const loadedApiRequestTool = inlineExtension.tools.get("tinyoffice_capability_call") as
    | { definition: RegisteredTool }
    | undefined;
  assert.ok(loadedApiRequestTool);
  const apiRequestTool = loadedApiRequestTool.definition;

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        conversationId: "conversation-api-check",
        reachableMemberIds: ["nora-automation"],
      }),
    },
    async () =>
      apiRequestTool.execute("tool-api-1", {
        capabilityId: "company.member.directory.list",
        input: {
          companyId: DEFAULT_COMPANY_ID,
        },
      }),
  );

  assert.equal(result.details.status, "allowed");
  assert.equal(result.details.capabilityId, "company.member.directory.list");
  const body = result.details.result as {
    members?: Array<{
      participantKind?: string;
      displayName?: string;
      memberId?: string;
      employeeId?: string;
      hasRuntimeProfile?: boolean;
    }>;
  };
  assert.equal(body.members?.some((member) => member.displayName === "Nora"), true);
  assert.equal(body.members?.some((member) =>
    member.participantKind === "company_member" &&
    member.memberId === "nora-automation" &&
    member.employeeId === undefined &&
    member.hasRuntimeProfile === true
  ), true);
  assert.match(result.content[0]?.text ?? "", /company\.member\.directory\.list/);
  assert.match(result.content[0]?.text ?? "", /"members"/);
  assert.match(result.content[0]?.text ?? "", /"displayName": "Nora"/);

  const runtimeResult = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        conversationId: "conversation-api-check",
        reachableMemberIds: ["nora-automation"],
      }),
    },
    async () =>
      apiRequestTool.execute("tool-api-2", {
        capabilityId: "runtime.models.list",
      }),
  );
  const runtimeBody = runtimeResult.details.result as {
    availableModels?: unknown[];
    thinkingLevels?: string[];
    employees?: unknown[];
  };
  assert.equal(Array.isArray(runtimeBody.availableModels), true);
  assert.equal(runtimeBody.thinkingLevels?.includes("medium"), true);
  assert.equal(Object.hasOwn(runtimeBody, "employees"), false);
  assert.match(runtimeResult.content[0]?.text ?? "", /"availableModels"/);
  assert.match(runtimeResult.content[0]?.text ?? "", /"thinkingLevels"/);

  const realtimeEvents: Array<{ type: string; companyId: string }> = [];
  const unregisterRealtimePublisher = registerTinyOfficeRealtimePublisher({
    publish(event) {
      realtimeEvents.push(event);
      return {
        schema: "tinyoffice-realtime-event",
        version: 1,
        eventId: `event-${realtimeEvents.length}`,
        occurredAt: new Date().toISOString(),
        sequence: realtimeEvents.length,
        ...event,
      };
    },
  });
  let recruitResult: Awaited<ReturnType<RegisteredTool["execute"]>>;
  try {
    recruitResult = await withEnv(
      {
        PI_EMPLOYEE_ID: "nora-automation",
        TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
        TASK_REPO_ROOT: sandboxRoot,
        PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
          conversationId: "conversation-api-check",
          reachableMemberIds: ["nora-automation"],
        }),
      },
      async () =>
        apiRequestTool.execute("tool-api-3", {
          capabilityId: "employee.recruit",
          confirmation: { accepted: true },
          input: {
            companyId: DEFAULT_COMPANY_ID,
            employeeId: "mina-content-test",
            displayName: "Mina Content",
            role: "Content Ops",
            summary: "Runs website content generation, publishing prep, and monitoring.",
            runtime: {
              version: 1,
              modelProvider: "openai",
              modelId: "gpt-5-codex",
              thinkingLevel: "medium",
            },
          },
        }),
    );
  } finally {
    unregisterRealtimePublisher();
  }
  const recruitBody = recruitResult.details.result as {
    employee?: { employeeId?: string };
    localAssets?: { workspacePath?: string };
  };
  assert.equal(recruitBody.employee?.employeeId, "mina-content-test");
  assert.ok(recruitBody.localAssets?.workspacePath);
  assert.match(recruitResult.content[0]?.text ?? "", /"employeeId": "mina-content-test"/);
  assert.deepEqual(realtimeEvents, [{ type: "company.directory.changed", companyId: DEFAULT_COMPANY_ID }]);
});

test("tinyoffice_capability_call describes member profiles without exposing employee config internals", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const capabilityTool = tools.get("tinyoffice_capability_call");
  assert.ok(capabilityTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-member-profile-"));
  await writeEmployeeHomeFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "nora-automation",
    displayName: "Nora",
    role: "automation",
    mountedActions: [],
  });
  await writeCompanyMemberFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    memberId: "xuziho",
    displayName: "Xu Ziho",
    role: "boss",
    summary: "Company operator.",
  });

  const runtimeProfile = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        conversationId: "conversation-member-profile",
        actorMemberId: "xuziho",
        reachableMemberIds: ["nora-automation", "xuziho"],
      }),
    },
    async () =>
      capabilityTool.execute("tool-member-profile-runtime", {
        capabilityId: "member.profile.describe",
        input: {
          companyId: DEFAULT_COMPANY_ID,
          memberId: "nora-automation",
        },
      }),
  );
  const runtimeBody = runtimeProfile.details.result as {
    member?: {
      participantKind?: string;
      memberId?: string;
      displayName?: string;
      role?: string;
      hasRuntimeProfile?: boolean;
      runtime?: { presenceMode?: string; supportsImageInput?: boolean };
      runtimeCapability?: unknown;
      resourcePolicy?: unknown;
      modelProvider?: unknown;
      modelId?: unknown;
    };
  };
  assert.equal(runtimeBody.member?.participantKind, "company_member");
  assert.equal(runtimeBody.member?.memberId, "nora-automation");
  assert.equal(runtimeBody.member?.displayName, "Nora");
  assert.equal(runtimeBody.member?.role, "automation");
  assert.equal(runtimeBody.member?.hasRuntimeProfile, true);
  assert.equal(runtimeBody.member?.runtime?.presenceMode, "resident");
  assert.equal(Object.hasOwn(runtimeBody.member ?? {}, "runtimeCapability"), false);
  assert.equal(Object.hasOwn(runtimeBody.member ?? {}, "resourcePolicy"), false);
  assert.equal(Object.hasOwn(runtimeBody.member ?? {}, "modelProvider"), false);
  assert.equal(Object.hasOwn(runtimeBody.member ?? {}, "modelId"), false);

  const humanProfile = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        conversationId: "conversation-member-profile",
        actorMemberId: "xuziho",
        reachableMemberIds: ["nora-automation", "xuziho"],
      }),
    },
    async () =>
      capabilityTool.execute("tool-member-profile-human", {
        capabilityId: "member.profile.describe",
        input: {
          companyId: DEFAULT_COMPANY_ID,
          memberId: "xuziho",
        },
      }),
  );
  const humanBody = humanProfile.details.result as {
    member?: { memberId?: string; summary?: string; hasRuntimeProfile?: boolean; runtime?: unknown };
  };
  assert.equal(humanBody.member?.memberId, "xuziho");
  assert.equal(humanBody.member?.summary, "Company operator.");
  assert.equal(humanBody.member?.hasRuntimeProfile, false);
  assert.equal(Object.hasOwn(humanBody.member ?? {}, "runtime"), false);
});

test("tinyoffice_capability_call creates confirmed DM or Channel Work through WorkService", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const apiRequestTool = tools.get("tinyoffice_capability_call");
  assert.ok(apiRequestTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-work-api-"));
  for (const employeeId of ["nora-automation", "iris-growth"]) {
    await writeEmployeeHomeFixture({
      repoRoot: sandboxRoot,
      companyId: DEFAULT_COMPANY_ID,
      employeeId,
      displayName: employeeId,
      role: "employee",
      mountedActions: [],
    });
  }
  await writeCompanyMemberFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    memberId: "xuziho",
    displayName: "Xu Ziho",
    role: "boss",
  });

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        channelTopicId: "channel-topic-work-create",
        threadId: "thread-work-create",
        conversationId: "conversation-work-create",
        messageId: "message-work-create",
        chatEntryId: "chat-entry-work-create",
        actorMemberId: "xuziho",
        reachableMemberIds: ["nora-automation", "iris-growth", "xuziho"],
      }),
    },
    async () =>
      apiRequestTool.execute("tool-work-api-1", {
        capabilityId: "work.create",
        confirmation: { accepted: true },
        input: {
          companyId: DEFAULT_COMPANY_ID,
          title: "Publish weekly social update",
          description: "Confirmed from the channel discussion.",
          ownerMemberId: "iris-growth",
          acceptanceCriteria: "A social update is published and linked back to the discussion.",
          trigger: {
            kind: "immediate",
          },
        },
      }),
  );

  assert.equal(result.details.status, "allowed");
  assert.equal(result.details.capabilityId, "work.create");
  const body = result.details.result as {
    task?: { id?: string };
    run?: { id?: string };
  };
  assert.ok(body.task?.id);
  assert.ok(body.run?.id);

  const workRepository = await WorkRepository.open(sandboxRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const task = workRepository.getWorkTask(body.task.id);
    assert.equal(task?.title, "Publish weekly social update");
    assert.equal(task?.createdByMemberId, "xuziho");
    assert.equal(task?.ownerMemberId, "iris-growth");
    assert.equal(task?.sourceKind, "chat_request");
    assert.equal(task?.sourceId, "conversation-work-create");
    assert.equal(task?.sourceChannelTopicId, "channel-topic-work-create");
    assert.equal(task?.metadata?.conversationId, "conversation-work-create");
    assert.equal(task?.metadata?.messageId, "message-work-create");
    assert.equal(task?.metadata?.chatEntryId, "chat-entry-work-create");
    assert.equal(Object.prototype.hasOwnProperty.call(task?.metadata || {}, "kind"), false);
    const run = workRepository.getWorkRun(body.run.id);
    assert.equal(run?.workTaskId, body.task.id);
    assert.equal(run?.assigneeMemberId, "iris-growth");
    assert.equal(run?.status, "queued");
  } finally {
    workRepository.close();
  }
});

test("tinyoffice_capability_call creates scheduled and recurring Work visible to Tasks", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const apiRequestTool = tools.get("tinyoffice_capability_call");
  assert.ok(apiRequestTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-work-schedules-"));
  for (const employeeId of ["nora-automation", "iris-growth"]) {
    await writeEmployeeHomeFixture({
      repoRoot: sandboxRoot,
      companyId: DEFAULT_COMPANY_ID,
      employeeId,
      displayName: employeeId,
      role: "employee",
      mountedActions: [],
    });
  }
  await writeCompanyMemberFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    memberId: "xuziho",
    displayName: "Xu Ziho",
    role: "boss",
  });

  const env = {
    PI_EMPLOYEE_ID: "nora-automation",
    TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
    TASK_REPO_ROOT: sandboxRoot,
    PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
      channelTopicId: "channel-topic-scheduled-work",
      threadId: "thread-scheduled-work",
      conversationId: "conversation-scheduled-work",
      messageId: "message-scheduled-work",
      chatEntryId: "chat-entry-scheduled-work",
      actorMemberId: "xuziho",
      reachableMemberIds: ["nora-automation", "iris-growth", "xuziho"],
    }),
  };

  await withEnv(env, async () => {
    await apiRequestTool.execute("tool-work-api-scheduled", {
      capabilityId: "work.create",
      confirmation: { accepted: true },
      input: {
        companyId: DEFAULT_COMPANY_ID,
        title: "Publish launch reminder",
        ownerMemberId: "iris-growth",
        acceptanceCriteria: "Reminder post is published.",
        trigger: {
          kind: "scheduled_once",
          scheduledFor: "2026-07-07T09:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
      },
    });
    await apiRequestTool.execute("tool-work-api-recurring", {
      capabilityId: "work.create",
      confirmation: { accepted: true },
      input: {
        companyId: DEFAULT_COMPANY_ID,
        title: "Publish daily social update",
        ownerMemberId: "iris-growth",
        acceptanceCriteria: "Daily update is published.",
        trigger: {
          kind: "recurring",
          scheduledFor: "2026-07-07T10:00:00.000Z",
          intervalMs: 86_400_000,
          timezone: "Asia/Shanghai",
        },
        maxRuns: 7,
      },
    });
  });

  const model = await loadTasksViewModel({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    requestUrl: new URL(`http://127.0.0.1/api/companies/${DEFAULT_COMPANY_ID}/tasks/view-model`),
  });
  assert.equal(model.tasks.some((task) =>
    task.title === "Publish launch reminder" &&
    task.schedule.kind === "scheduled_once" &&
    task.schedule.nextRunAt === "2026-07-07T09:00:00.000Z"
  ), true);
  assert.equal(model.tasks.some((task) =>
    task.title === "Publish daily social update" &&
    task.schedule.kind === "recurring" &&
    task.schedule.nextRunAt === "2026-07-07T10:00:00.000Z"
  ), true);
});

test("tinyoffice_capability_call lists Work with mine scope by default and company scope on request", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const capabilityTool = tools.get("tinyoffice_capability_call");
  assert.ok(capabilityTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-work-list-"));
  for (const employeeId of ["nora-automation", "iris-growth"]) {
    await writeEmployeeHomeFixture({
      repoRoot: sandboxRoot,
      companyId: DEFAULT_COMPANY_ID,
      employeeId,
      displayName: employeeId,
      role: "employee",
      mountedActions: [],
    });
  }
  await writeCompanyMemberFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    memberId: "xuziho",
    displayName: "Xu Ziho",
    role: "boss",
  });

  const env = {
    PI_EMPLOYEE_ID: "nora-automation",
    TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
    TASK_REPO_ROOT: sandboxRoot,
    PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
      conversationId: "conversation-work-list",
      actorMemberId: "xuziho",
      reachableMemberIds: ["nora-automation", "iris-growth", "xuziho"],
    }),
  };

  const noraWork = await withEnv(env, async () =>
    capabilityTool.execute("tool-work-list-create-nora", {
      capabilityId: "work.create",
      confirmation: { accepted: true },
      input: {
        companyId: DEFAULT_COMPANY_ID,
        title: "Nora owned workflow",
        ownerMemberId: "nora-automation",
        acceptanceCriteria: "Nora finishes the workflow.",
        trigger: { kind: "immediate" },
      },
    })
  );
  const irisEnv = {
    ...env,
    PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
      conversationId: "conversation-work-list-iris",
      actorMemberId: "xuziho",
      reachableMemberIds: ["nora-automation", "iris-growth", "xuziho"],
    }),
  };
  await withEnv(irisEnv, async () =>
    capabilityTool.execute("tool-work-list-create-iris", {
      capabilityId: "work.create",
      confirmation: { accepted: true },
      input: {
        companyId: DEFAULT_COMPANY_ID,
        title: "Iris owned workflow",
        ownerMemberId: "iris-growth",
        acceptanceCriteria: "Iris finishes the workflow.",
        trigger: { kind: "immediate" },
      },
    })
  );

  const noraBody = noraWork.details.result as { run?: { id?: string } };
  const repository = await WorkRepository.open(sandboxRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const run = noraBody.run?.id ? repository.getWorkRun(noraBody.run.id) : undefined;
    assert.ok(run);
    repository.updateWorkRun({
      ...run,
      status: "blocked",
      blockedReason: "Needs source access from the operator.",
      updatedAt: "2026-07-09T09:00:00.000Z",
    });
    repository.appendWorkRunEvent({
      id: "work-run-event-list-blocked",
      workRunId: run.id,
      timestamp: "2026-07-09T09:00:00.000Z",
      actorMemberId: "nora-automation",
      eventType: "blocked",
      summary: "Blocked while waiting for source access.",
    });
    await repository.save();
  } finally {
    repository.close();
  }

  const mineResult = await withEnv(env, async () =>
    capabilityTool.execute("tool-work-list-mine", {
      capabilityId: "work.list",
      input: {
        companyId: DEFAULT_COMPANY_ID,
      },
    })
  );
  const mineBody = mineResult.details.result as {
    tasks?: Array<{ title?: string; latestRun?: { status?: string }; needsAttention?: boolean }>;
  };
  const noraListedWorkflow = mineBody.tasks?.find((task) =>
    task.title === "Nora owned workflow" &&
    task.latestRun?.status === "blocked" &&
    task.needsAttention === true
  );
  assert.ok(noraListedWorkflow);

  const companyResult = await withEnv(env, async () =>
    capabilityTool.execute("tool-work-list-company", {
      capabilityId: "work.list",
      input: {
        companyId: DEFAULT_COMPANY_ID,
        scope: "company",
      },
    })
  );
  const companyBody = companyResult.details.result as {
    tasks?: Array<{ title?: string }>;
  };
  const companyTaskTitles = new Set(companyBody.tasks?.map((task) => task.title));
  assert.equal(companyTaskTitles.has("Iris owned workflow"), true);
  assert.equal(companyTaskTitles.has("Nora owned workflow"), true);
});

test("tinyoffice_capability_call describes Work detail with runs and latest run events", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const capabilityTool = tools.get("tinyoffice_capability_call");
  assert.ok(capabilityTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-work-describe-"));
  await writeEmployeeHomeFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "nora-automation",
    displayName: "Nora",
    role: "employee",
    mountedActions: [],
  });
  await writeCompanyMemberFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    memberId: "xuziho",
    displayName: "Xu Ziho",
    role: "boss",
  });

  const env = {
    PI_EMPLOYEE_ID: "nora-automation",
    TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
    TASK_REPO_ROOT: sandboxRoot,
    PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
      conversationId: "conversation-work-describe",
      actorMemberId: "xuziho",
      reachableMemberIds: ["nora-automation", "xuziho"],
    }),
  };

  const created = await withEnv(env, async () =>
    capabilityTool.execute("tool-work-describe-create", {
      capabilityId: "work.create",
      confirmation: { accepted: true },
      input: {
        companyId: DEFAULT_COMPANY_ID,
        title: "Describe this workflow",
        ownerMemberId: "nora-automation",
        acceptanceCriteria: "The workflow is inspectable by AI.",
        trigger: { kind: "immediate" },
      },
    })
  );
  const createdBody = created.details.result as { task?: { id?: string }; run?: { id?: string } };

  const repository = await WorkRepository.open(sandboxRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const run = createdBody.run?.id ? repository.getWorkRun(createdBody.run.id) : undefined;
    assert.ok(run);
    repository.updateWorkRun({
      ...run,
      status: "failed",
      failedReason: "External publishing API rejected the request.",
      resultSummary: "Publishing did not complete.",
      updatedAt: "2099-07-09T10:00:00.000Z",
    });
    repository.appendWorkRunEvent({
      id: "work-run-event-describe-failed",
      workRunId: run.id,
      timestamp: "2099-07-09T10:00:00.000Z",
      actorMemberId: "nora-automation",
      eventType: "failed",
      summary: "External publishing API rejected the request.",
    });
    await repository.save();
  } finally {
    repository.close();
  }

  const detail = await withEnv(env, async () =>
    capabilityTool.execute("tool-work-describe", {
      capabilityId: "work.describe",
      input: {
        companyId: DEFAULT_COMPANY_ID,
        workTaskId: createdBody.task?.id,
        includeEvents: true,
      },
    })
  );

  const body = detail.details.result as {
    task?: { title?: string; workTaskId?: string };
    runs?: Array<{ status?: string; reason?: string; resultSummary?: string }>;
    latestRunEvents?: Array<{ eventType?: string; summary?: string }>;
    needsAttention?: boolean;
    suggestedNextStep?: string;
  };
  assert.equal(body.task?.workTaskId, createdBody.task?.id);
  assert.equal(body.task?.title, "Describe this workflow");
  assert.equal(body.runs?.[0]?.status, "failed");
  assert.equal(body.runs?.[0]?.reason, "External publishing API rejected the request.");
  assert.equal(body.runs?.[0]?.resultSummary, "Publishing did not complete.");
  assert.equal(body.latestRunEvents?.[0]?.eventType, "failed");
  assert.equal(body.needsAttention, true);
  assert.equal(body.suggestedNextStep, "review_failed_run");
});

test("tinyoffice_capability_call closes the confirmed Work and schedule lifecycle", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });
  const capabilityTool = tools.get("tinyoffice_capability_call");
  assert.ok(capabilityTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-work-lifecycle-"));
  await writeEmployeeHomeFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "nora-automation",
    displayName: "Nora",
    role: "employee",
    mountedActions: [],
  });
  await writeCompanyMemberFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    memberId: "xuziho",
    displayName: "Xu Ziho",
    role: "boss",
  });
  const env = {
    PI_EMPLOYEE_ID: "nora-automation",
    TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
    TASK_REPO_ROOT: sandboxRoot,
    PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
      conversationId: "conversation-work-lifecycle",
      actorMemberId: "xuziho",
      reachableMemberIds: ["nora-automation", "xuziho"],
    }),
  };
  const call = (toolCallId: string, capabilityId: string, input: Record<string, unknown>) => withEnv(env, () =>
    capabilityTool.execute(toolCallId, {
      capabilityId,
      confirmation: { accepted: true },
      input: { companyId: DEFAULT_COMPANY_ID, ...input },
    })
  );

  const immediate = await call("lifecycle-create", "work.create", {
    title: "Repair failed publisher run",
    ownerMemberId: "nora-automation",
    acceptanceCriteria: "The publisher run completes.",
    trigger: { kind: "immediate" },
  });
  const immediateBody = immediate.details.result as { task: { id: string }; run: { id: string } };
  const workService = new WorkService({ repoRoot: sandboxRoot, companyId: DEFAULT_COMPANY_ID });
  await workService.moveWorkRun({
    workRunId: immediateBody.run.id,
    actorMemberId: "nora-automation",
    status: "in_progress",
  });
  const revised = await withEnv({
    ...env,
    PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
      conversationId: "conversation-work-lifecycle",
      reachableMemberIds: ["nora-automation", "xuziho"],
      workRunId: immediateBody.run.id,
    }),
  }, () => capabilityTool.execute("lifecycle-revise", {
    capabilityId: "work.revise",
    confirmation: { accepted: true },
    input: {
      companyId: DEFAULT_COMPANY_ID,
      workTaskId: immediateBody.task.id,
      title: "Repair publisher run for returning customers",
      acceptanceCriteria: "The returning-customer publisher run completes.",
      reason: "The operator explicitly changed the campaign audience.",
    },
  }));
  const revisedBody = revised.details.result as {
    task: { revision: number };
    runs: Array<{ id: string; taskRevision: number }>;
    revisions: Array<{ revision: number; changedByMemberId: string; sourceWorkRunId?: string }>;
  };
  assert.equal(revisedBody.task.revision, 2);
  assert.equal(revisedBody.runs.find((run) => run.id === immediateBody.run.id)?.taskRevision, 2);
  assert.deepEqual(revisedBody.revisions.map((revision) => revision.revision), [1, 2]);
  assert.equal(revisedBody.revisions[1]?.changedByMemberId, "nora-automation");
  assert.equal(revisedBody.revisions[1]?.sourceWorkRunId, immediateBody.run.id);
  await workService.moveWorkRun({
    workRunId: immediateBody.run.id,
    actorMemberId: "nora-automation",
    status: "failed",
    reason: "Publisher API timed out.",
  });
  const retried = await call("lifecycle-retry", "work.retry", { workRunId: immediateBody.run.id });
  assert.equal((retried.details.result as { run: { status: string } }).run.status, "queued");
  const canceled = await call("lifecycle-cancel", "work.cancel", {
    workTaskId: immediateBody.task.id,
    reason: "The campaign was withdrawn.",
  });
  assert.equal((canceled.details.result as { task: { status: string } }).task.status, "canceled");
  const archived = await call("lifecycle-archive", "work.archive", { workTaskId: immediateBody.task.id });
  assert.equal((archived.details.result as { task: { status: string } }).task.status, "archived");
  const restored = await call("lifecycle-restore", "work.restore", { workTaskId: immediateBody.task.id });
  assert.equal((restored.details.result as { task: { status: string } }).task.status, "canceled");

  const recurring = await call("schedule-create", "work.create", {
    title: "Publish recurring launch report",
    ownerMemberId: "nora-automation",
    acceptanceCriteria: "Each report is published.",
    trigger: {
      kind: "recurring",
      scheduledFor: "2099-07-11T09:00:00.000Z",
      intervalMs: 86_400_000,
    },
  });
  const scheduleId = (recurring.details.result as { schedule: { id: string } }).schedule.id;
  const paused = await call("schedule-pause", "schedule.pause", { workScheduleId: scheduleId, reason: "Launch paused." });
  assert.equal((paused.details.result as { schedule: { status: string } }).schedule.status, "paused");
  const resumed = await call("schedule-resume", "schedule.resume", { workScheduleId: scheduleId });
  assert.equal((resumed.details.result as { schedule: { status: string } }).schedule.status, "enabled");
  const scheduleCanceled = await call("schedule-cancel", "schedule.cancel", {
    workScheduleId: scheduleId,
    reason: "Launch canceled.",
  });
  assert.equal((scheduleCanceled.details.result as { schedule: { status: string } }).schedule.status, "canceled");
  assert.equal((scheduleCanceled.details.result as { task: { status: string } }).task.status, "canceled");
});

test("tinyoffice_capability_call creates channels with the current member as actor", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const apiRequestTool = tools.get("tinyoffice_capability_call");
  assert.ok(apiRequestTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-channel-create-"));
  for (const employee of [
    { employeeId: "employee-hr", displayName: "Mira", role: "hr" },
    { employeeId: "aster", displayName: "Aster", role: "analytics" },
  ]) {
    await writeEmployeeHomeFixture({
      repoRoot: sandboxRoot,
      companyId: DEFAULT_COMPANY_ID,
      employeeId: employee.employeeId,
      displayName: employee.displayName,
      role: employee.role,
      mountedActions: [],
    });
  }
  await writeCompanyMemberFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    memberId: "xuziho",
    displayName: "Xuziho",
    role: "boss",
  });

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "employee-hr",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        conversationId: "conversation-channel-create",
        actorMemberId: "xuziho",
        reachableMemberIds: ["employee-hr", "aster"],
      }),
    },
    async () =>
      apiRequestTool.execute("tool-channel-create", {
        capabilityId: "chat.channel.create",
        confirmation: { accepted: true },
        input: {
          companyId: DEFAULT_COMPANY_ID,
          title: "Analytics onboarding",
          summary: "Coordinate the first analytics workflow.",
          actorMemberId: "intruder",
          actorDisplayName: "Intruder",
          members: [{
            memberId: "aster",
          }],
        },
      }),
  );

  assert.equal(result.details.status, "allowed");
  assert.equal(result.details.capabilityId, "chat.channel.create");
  const body = result.details.result as {
    title?: string;
    members?: Array<{ memberId?: string; displayName?: string; role?: string; hasRuntimeProfile?: boolean }>;
  };
  assert.equal(body.title, "Analytics onboarding");
  assert.equal(body.members?.some((member) =>
    member.memberId === "xuziho" &&
    member.displayName === "Xuziho" &&
    member.role === "boss"
  ), true);
  assert.equal(body.members?.some((member) => member.memberId === "intruder"), false);
  assert.equal(body.members?.some((member) => member.memberId === "employee-hr"), false);
  assert.equal(body.members?.some((member) =>
    member.memberId === "aster" &&
    member.displayName === "Aster" &&
    member.role === "analytics" &&
    member.hasRuntimeProfile === true
  ), true);
});

test("tinyoffice_capability_call rejects system-derived channel member fields", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const apiRequestTool = tools.get("tinyoffice_capability_call");
  assert.ok(apiRequestTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-channel-derived-"));
  await writeEmployeeHomeFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "employee-hr",
    displayName: "Mira",
    role: "hr",
    mountedActions: [],
  });
  await writeCompanyMemberFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    memberId: "xuziho",
    displayName: "Xuziho",
    role: "boss",
  });

  await assert.rejects(
    () =>
      withEnv(
        {
          PI_EMPLOYEE_ID: "employee-hr",
          TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
          TASK_REPO_ROOT: sandboxRoot,
          PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
            conversationId: "conversation-channel-create",
            actorMemberId: "xuziho",
            reachableMemberIds: ["employee-hr"],
          }),
        },
        async () =>
          apiRequestTool.execute("tool-channel-derived-field", {
            capabilityId: "chat.channel.create",
            confirmation: { accepted: true },
            input: {
              companyId: DEFAULT_COMPANY_ID,
              title: "Bad channel",
              members: [{
                memberId: "employee-hr",
                displayName: "Mira",
              }],
            },
          }),
      ),
    /displayName is system-derived/,
  );
});

test("tinyoffice_capability_call can derive company context from capability input", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const apiRequestTool = tools.get("tinyoffice_capability_call");
  assert.ok(apiRequestTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-api-path-company-"));
  await writeEmployeeHomeFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "nora-automation",
    displayName: "Nora",
    role: "automation",
    mountedActions: [],
  });

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      TINYOFFICE_COMPANY_ID: undefined,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        conversationId: "conversation-api-path-company",
        reachableMemberIds: ["nora-automation"],
      }),
    },
    async () =>
      apiRequestTool.execute("tool-api-path-company", {
        capabilityId: "company.member.directory.list",
        input: {
          companyId: DEFAULT_COMPANY_ID,
        },
      }),
  );

  assert.equal(result.details.status, "allowed");
  assert.equal(result.details.capabilityId, "company.member.directory.list");
});

test("tinyoffice_capability_call resolves company placeholder from ambient runtime context", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const apiRequestTool = tools.get("tinyoffice_capability_call");
  assert.ok(apiRequestTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-api-ambient-company-"));
  await writeEmployeeHomeFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "nora-automation",
    displayName: "Nora",
    role: "automation",
    mountedActions: [],
  });

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      TINYOFFICE_COMPANY_ID: undefined,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        companyId: DEFAULT_COMPANY_ID,
        conversationId: "conversation-api-ambient-company",
        reachableMemberIds: ["nora-automation"],
      }),
    },
    async () =>
      apiRequestTool.execute("tool-api-ambient-company", {
        capabilityId: "company.member.directory.list",
      }),
  );

  assert.equal(result.details.status, "allowed");
  assert.equal(result.details.capabilityId, "company.member.directory.list");
});

test("tinyoffice_capability_call rejects capabilities outside the registry or current company", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const apiRequestTool = tools.get("tinyoffice_capability_call");
  assert.ok(apiRequestTool);

  await assert.rejects(
    () => withEnv(
      {
        PI_EMPLOYEE_ID: "nora-automation",
        TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
        TASK_REPO_ROOT: "D:/repo",
        PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({ reachableMemberIds: ["nora-automation"] }),
      },
      async () =>
        apiRequestTool.execute("tool-api-invalid", {
          capabilityId: "company.member.directory.list",
          input: {
            companyId: "other-company",
          },
        }),
    ),
    /companyId mismatch/,
  );

  await assert.rejects(
    () => withEnv(
      {
        PI_EMPLOYEE_ID: "nora-automation",
        TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
        TASK_REPO_ROOT: "D:/repo",
        PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({ reachableMemberIds: ["nora-automation"] }),
      },
      async () =>
        apiRequestTool.execute("tool-api-unregistered", {
          capabilityId: "company.member.delete",
          input: {
            companyId: DEFAULT_COMPANY_ID,
            memberId: "nora-automation",
          },
        }),
    ),
    /not registered in the capability registry/,
  );
});

test("tinyoffice_capability_call rejects capabilities outside the current runtime scene", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const apiRequestTool = tools.get("tinyoffice_capability_call");
  assert.ok(apiRequestTool);

  await assert.rejects(
    () => withEnv(
      {
        PI_EMPLOYEE_ID: "nora-automation",
        TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
        TASK_REPO_ROOT: "D:/repo",
        PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
          workRunId: "work-run-1",
          threadId: "work-run-1",
          reachableMemberIds: ["nora-automation"],
        }),
      },
      async () =>
        apiRequestTool.execute("tool-api-wrong-scene", {
          capabilityId: "employee.recruit",
          confirmation: { accepted: true },
          input: {
            companyId: DEFAULT_COMPANY_ID,
            displayName: "Draft Employee",
            role: "ops",
            summary: "Draft",
            runtime: {
              version: 1,
              modelProvider: "openai",
              modelId: "gpt-5-codex",
              thinkingLevel: "minimal",
            },
          },
        }),
    ),
    /employee\.recruit is not allowed in work_run scene/,
  );
});

test("finish_intake_turn records operating events for no-work intake decisions", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const finishIntakeTurn = tools.get("finish_intake_turn");
  assert.ok(finishIntakeTurn);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-op-event-"));
  const workspacePath = path.join(
    companyEmployeeHomePath({
      repoRoot: sandboxRoot,
      companyId: DEFAULT_COMPANY_ID,
      employeeId: "nora-automation",
    }),
    "workspace",
  );
  await writeEmployeeHomeFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "nora-automation",
    displayName: "Nora",
    mountedActions: [],
  });

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      PI_EMPLOYEE_ROLE: "automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      PI_WORKSPACE_PATH: workspacePath,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        channelTopicId: "channel-topic-op-event-check",
        threadId: "thread-op-event-check",
        actorMemberId: "xuziho",
        reachableMemberIds: ["nora-automation"],
        reachableParticipants: [
          { id: "nora-automation" },
          { id: "xuziho", role: "boss", isFinalReportTarget: true },
        ],
      }),
    },
    async () =>
      finishIntakeTurn.execute("tool-op-event-1", {
        outcome: "record_event",
        message: "The report was reviewed and does not need a task.",
        operatingEvent: {
          title: "Duplicate monitor report ignored",
          message: "The report was reviewed and does not need a task.",
          severity: "info",
        },
      }),
  );

  assert.equal(result.details.status, "allowed");
  assert.equal(result.details.outcome, "record_event");
  const eventId = String(result.details.eventId);

  const repository = await OperatingLogRepository.open(sandboxRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const event = repository.getEvent(eventId);
    assert.equal(event?.title, "Duplicate monitor report ignored");
    assert.equal(event?.actorMemberId, "xuziho");
    assert.equal(event?.source.intakeEventId, "thread-op-event-check");
    assert.equal(event?.category, undefined);
  } finally {
    repository.close();
  }
});

test("finish_intake_turn creates Work for actionable intake decisions", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const finishIntakeTurn = tools.get("finish_intake_turn");
  assert.ok(finishIntakeTurn);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-work-"));
  const workspacePath = path.join(
    companyEmployeeHomePath({
      repoRoot: sandboxRoot,
      companyId: DEFAULT_COMPANY_ID,
      employeeId: "nora-automation",
    }),
    "workspace",
  );
  for (const employeeId of ["nora-automation", "iris-growth"]) {
    await writeEmployeeHomeFixture({
      repoRoot: sandboxRoot,
      companyId: DEFAULT_COMPANY_ID,
      employeeId,
      mountedActions: [],
    });
  }

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      PI_EMPLOYEE_ROLE: "automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      PI_WORKSPACE_PATH: workspacePath,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        channelTopicId: "channel-topic-task-check",
        threadId: "thread-task-check",
        conversationId: "conversation-task-check",
        messageId: "message-task-check",
        chatEntryId: "chat-entry-task-check",
        actorMemberId: "xuziho",
        reachableMemberIds: ["iris-growth"],
        reachableParticipants: [
          { id: "nora-automation" },
          { id: "iris-growth" },
          { id: "xuziho", role: "boss", isFinalReportTarget: true },
        ],
      }),
    },
    async () =>
      finishIntakeTurn.execute("tool-work-1", {
        outcome: "create_work",
        message: "The intake report needs formal repair work.",
        work: {
          title: "Fix missing article image",
          description: "Inbox report says one article is missing media.",
          ownerMemberId: "iris-growth",
          acceptanceCriteria: "Audit rerun passes for the affected article.",
          scheduleKind: "immediate",
          scheduledFor: "",
          timezone: "",
        },
      }),
  );

  assert.equal(result.details.status, "allowed");
  assert.equal(result.details.outcome, "create_work");
  const workTaskId = String(result.details.workTaskId);
  const workRunId = String(result.details.workRunId);
  assert.ok(workRunId);

  const workRepository = await WorkRepository.open(sandboxRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const task = workRepository.getWorkTask(workTaskId);
    assert.equal(task?.createdByMemberId, "xuziho");
    assert.equal(task?.ownerMemberId, "iris-growth");
    assert.equal(task?.sourceId, "conversation-task-check");
    assert.equal(task?.sourceKind, "intake_event");
    assert.equal(task?.metadata?.conversationId, "conversation-task-check");
    assert.equal(task?.metadata?.messageId, "message-task-check");
    assert.equal(task?.metadata?.chatEntryId, "chat-entry-task-check");
    assert.equal(task?.metadata?.channelTopicId, "channel-topic-task-check");
    const run = workRepository.getWorkRun(workRunId);
    assert.equal(run?.workTaskId, workTaskId);
    assert.equal(run?.assigneeMemberId, "iris-growth");
    assert.equal(run?.status, "queued");
    const events = workRepository.listWorkRunEvents(workRunId);
    assert.equal(events[0]?.eventType, "created");
  } finally {
    workRepository.close();
  }
});

test("finish_intake_turn uses the intake event id instead of sessionKey as Work source", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const finishIntakeTurn = tools.get("finish_intake_turn");
  assert.ok(finishIntakeTurn);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-intake-source-"));
  const workspacePath = path.join(
    companyEmployeeHomePath({
      repoRoot: sandboxRoot,
      companyId: DEFAULT_COMPANY_ID,
      employeeId: "nora-automation",
    }),
    "workspace",
  );
  await writeEmployeeHomeFixture({
    repoRoot: sandboxRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "nora-automation",
    mountedActions: [],
  });

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "nora-automation",
      PI_EMPLOYEE_ROLE: "automation",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      PI_WORKSPACE_PATH: workspacePath,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        sessionKey: "nora-automation|intake_event|intake-event-source-check",
        threadId: "intake-event-source-check",
        actorMemberId: "nora-automation",
        reachableMemberIds: ["nora-automation"],
      }),
    },
    async () =>
      finishIntakeTurn.execute("tool-intake-source-1", {
        outcome: "create_work",
        message: "The intake event should become Work.",
        work: {
          title: "Inspect intake source mapping",
          ownerMemberId: "nora-automation",
          acceptanceCriteria: "Work source points to the intake event id.",
          scheduleKind: "immediate",
        },
      }),
  );

  assert.equal(result.details.status, "allowed");
  const workTaskId = String(result.details.workTaskId);
  const workRepository = await WorkRepository.open(sandboxRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const task = workRepository.getWorkTask(workTaskId);
    assert.equal(task?.sourceKind, "intake_event");
    assert.equal(task?.sourceId, "intake-event-source-check");
    assert.equal(task?.metadata?.threadId, "intake-event-source-check");
  } finally {
    workRepository.close();
  }
});

test("collaboration actions extension does not expose retired WorkRun state tool", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const retiredWorkRunStateTool = ["work", "run", "action"].join("_");
  assert.equal(tools.has(retiredWorkRunStateTool), false);
});

test("collaboration actions extension exposes recall_memory as a database-backed read tool", async () => {
  const tools = new Map<string, RegisteredTool>();
  collaborationActionsExtension({
    registerTool(definition) {
      tools.set(definition.name, definition as RegisteredTool);
    },
  });

  const recallMemoryTool = tools.get("recall_memory");
  assert.ok(recallMemoryTool);

  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "collaboration-ext-memory-"));
  await ensureCompanyFixture(sandboxRoot, DEFAULT_COMPANY_ID);
  const repository = await RuntimeSessionRepository.open(sandboxRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    repository.upsertMemorySummary({
      id: "memory-task-1",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
      scopeKind: "task",
      scopeId: "task-1",
      employeeId: "iris-growth",
      sourceKind: "task",
      sourceId: "task-1",
      category: "website.article_audit",
      title: "Task done: Fix missing article image",
      summary: "Image was added and the audit rerun passed.",
      importance: 0.7,
      embeddingStatus: "not_requested",
    });
    await repository.save();
  } finally {
    repository.close();
  }

  const result = await withEnv(
    {
      PI_EMPLOYEE_ID: "iris-growth",
      TINYOFFICE_COMPANY_ID: DEFAULT_COMPANY_ID,
      TASK_REPO_ROOT: sandboxRoot,
      PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
        channelTopicId: "channel-topic-memory",
        threadId: "thread-memory",
        reachableMemberIds: ["iris-growth"],
        reachableParticipants: [{ id: "iris-growth" }],
      }),
    },
    async () =>
      recallMemoryTool.execute("tool-memory-1", {
        employeeId: "iris-growth",
        workRunId: "",
        category: "website.article_audit",
        limit: 5,
      }),
  );

  assert.equal(result.details.status, "allowed");
  const memories = result.details.memories as Array<{ id: string; summary: string }>;
  assert.equal(memories.length, 1);
  assert.equal(memories[0]?.id, "memory-task-1");
  assert.match(memories[0]?.summary || "", /audit rerun passed/);
});
