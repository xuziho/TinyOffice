import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  generateNaturalLanguageEmployeeReply,
  persistNaturalLanguageRuntimeSessionSnapshot,
  shouldRejectEmptyReplyBeforeStructuredReplay,
} from "../../src/runtime/provider/natural-language-responder.js";
import {
  buildProcessEventsFromSessionEvent,
  normalizePiProviderEvent,
  preparePiPromptImages,
  runtimeSessionEventFromPiEvent,
  shouldPersistRuntimeSessionPiEvent,
} from "../../src/runtime/provider/pi-runtime-provider.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { appendProcessTraceEvent } from "../../src/runtime/realtime/process-trace-store.js";
import { RuntimeSessionRepository } from "../../src/runtime/storage/runtime-session-repository.js";
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetRuntimePostgresTables } from "./postgres-test-utils.js";

beforeEach(resetRuntimePostgresTables);

const employee: EmployeeHome = {
  companyId: DEFAULT_COMPANY_ID,
  employeeId: "mira-hr",
  homePath: `/unused/companies/${DEFAULT_COMPANY_ID}/employees/mira-hr`,
  workspacePath: `/unused/companies/${DEFAULT_COMPANY_ID}/employees/mira-hr/workspace`,
  profile: {
    employeeId: "mira-hr",
    role: "hr",
    displayName: "Mira",
    presenceMode: "resident",
    mountedActions: [],
  },
  resourcePolicy: { version: 1, filesystem: {} },
};

const input = {
  employee,
  message: "Please handle this topic",
  sessionKey: "mira-hr|channel_thread|post-3",
  channelTopicId: "topic-1",
  threadId: "post-3",
  preferredLanguage: "en-US",
};

function emitPiTestProviderEvent(
  replyInput: { onProviderEvent?: (event: ReturnType<typeof normalizePiProviderEvent>) => void },
  event: unknown,
) {
  replyInput.onProviderEvent?.(normalizePiProviderEvent(replyInput as never, event));
}

async function waitForCondition(predicate: () => Promise<boolean>, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for condition.");
}

const mojibakePattern = new RegExp("\\uFFFD");

test("PI empty thinking lifecycle events do not become user-visible process trace", () => {
  const events = buildProcessEventsFromSessionEvent(input, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "" }],
    },
    assistantMessageEvent: {
      type: "thinking_start",
      contentIndex: 0,
    },
  });

  assert.deepEqual(events, []);
});

test("PI provider retry lifecycle becomes visible Process Trace evidence", () => {
  const started = buildProcessEventsFromSessionEvent(input, {
    type: "auto_retry_start",
    attempt: 2,
    maxAttempts: 3,
    delayMs: 4000,
    errorMessage: "Provider overloaded",
  });
  const completed = buildProcessEventsFromSessionEvent(input, {
    type: "auto_retry_end",
    attempt: 2,
    success: true,
  });

  assert.deepEqual(started.map((event) => ({ kind: event.kind, status: event.status, metadata: event.metadata })), [{
    kind: "provider_retry",
    status: "running",
    metadata: {
      attempt: 2,
      maxAttempts: 3,
      delayMs: 4000,
      errorMessage: "Provider overloaded",
      finalError: undefined,
    },
  }]);
  assert.equal(completed[0]?.kind, "provider_retry");
  assert.equal(completed[0]?.status, "succeeded");
});

test("PI provider prepares runtime image inputs as PI SDK image prompt options", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-provider-images-"));
  const imagePath = path.join(repoRoot, ".data", "companies", "acme", "chat-attachments", "att-screen", "original");
  await mkdir(path.dirname(imagePath), { recursive: true });
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
  ]);
  await writeFile(imagePath, pngBytes);

  const images = await preparePiPromptImages([{
    attachmentId: "att-screen",
    fileName: "screen.png",
    mimeType: "image/png",
    byteLength: pngBytes.byteLength,
    storageKey: "companies/acme/chat-attachments/att-screen/original",
    contentSha256: "sha",
  }], { repoRoot });

  assert.deepEqual(images, [{
    type: "image",
    data: pngBytes.toString("base64"),
    mimeType: "image/png",
  }]);
});

test("PI thinking stream records only the completed reasoning activity", () => {
  const start = buildProcessEventsFromSessionEvent(input, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "" }],
    },
    assistantMessageEvent: {
      type: "thinking_start",
      contentIndex: 0,
    },
  });
  const delta = buildProcessEventsFromSessionEvent(input, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Checking reachable channel members" }],
    },
    assistantMessageEvent: {
      type: "thinking_delta",
      contentIndex: 0,
      delta: "Checking reachable channel members",
    },
  });
  const end = buildProcessEventsFromSessionEvent(input, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Checking reachable channel members before choosing a tool." }],
    },
    assistantMessageEvent: {
      type: "thinking_end",
      contentIndex: 0,
      content: "Checking reachable channel members before choosing a tool.",
    },
  });

  assert.equal(start.length, 0);
  assert.equal(delta.length, 0);
  assert.equal(end.length, 1);
  assert.equal(end[0].metadata?.streamEventKey, "stream:thinking:0");
  assert.equal(end[0].summary, "Checking reachable channel members before choosing a tool.");
  assert.equal(end[0].status, "succeeded");
});

test("PI reasoning process trace labels use stable ASCII titles for Chinese sessions", () => {
  const events = buildProcessEventsFromSessionEvent({
    ...input,
    preferredLanguage: "zh-CN",
  }, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Checking available members" }],
    },
    assistantMessageEvent: {
      type: "thinking_end",
      contentIndex: 0,
      content: "Checking available members",
    },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "mira-hr prepared its approach");
  assert.ok(events[0].summary);
  assert.doesNotMatch(events[0].title || "", mojibakePattern);
  assert.doesNotMatch(events[0].summary || "", mojibakePattern);
});

test("PI streaming final-result tool call completion becomes immediate process trace activity", () => {
  const events = buildProcessEventsFromSessionEvent(input, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{
        type: "toolCall",
        name: "finish_intake_turn",
        arguments: {
          outcome: "create_work",
          message: "Create follow-up work.",
          work: {
            title: "Fix the issue",
            ownerMemberId: "mira-hr",
            acceptanceCriteria: "The issue is fixed",
          },
        },
      }],
    },
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: {
        name: "finish_intake_turn",
        arguments: {
          outcome: "create_work",
          message: "Create follow-up work.",
          work: {
            title: "Fix the issue",
            ownerMemberId: "mira-hr",
            acceptanceCriteria: "The issue is fixed",
          },
        },
      },
    },
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "tool_activity");
  assert.equal(events[0].status, "succeeded");
  assert.equal(events[0].metadata?.toolName, "finish_intake_turn");
  assert.match(events[0].title, /Finished intake/);
  assert.equal(events[1].kind, "model_tool_call");
  assert.equal(events[1].metadata?.streamEventType, "toolcall_end");
});

test("PI completed tool calls and results preserve one shared tool call identity", () => {
  const callEvents = buildProcessEventsFromSessionEvent(input, {
    type: "message",
    id: "assistant-record-1",
    message: {
      role: "assistant",
      content: [{
        type: "toolCall",
        id: "tool-call-1",
        name: "bash",
        arguments: { command: "pwd" },
      }],
    },
  });
  const resultEvents = buildProcessEventsFromSessionEvent(input, {
    type: "message",
    id: "result-record-1",
    message: {
      role: "toolResult",
      toolCallId: "tool-call-1",
      toolName: "bash",
      content: [{ type: "text", text: "/workspace" }],
    },
  });

  assert.equal(callEvents.length, 2);
  assert.equal(callEvents[0].metadata?.toolCallId, "tool-call-1");
  assert.equal(callEvents[1].metadata?.toolCallId, "tool-call-1");
  assert.equal(resultEvents.length, 1);
  assert.equal(resultEvents[0].metadata?.toolCallId, "tool-call-1");
});

test("PI tool activity process trace labels use stable ASCII titles for Chinese sessions", () => {
  const zhInput = {
    ...input,
    preferredLanguage: "zh-CN",
  };
  const cases = [
    {
      toolName: "read",
      args: { path: "C:\\repo\\TinyOffice\\src\\runtime\\index.ts" },
      expectedTitle: "璇诲彇 src/runtime/index.ts",
    },
    {
      toolName: "ls",
      args: { path: "C:\\repo\\TinyOffice\\docs" },
      expectedTitle: "鍒楀嚭 docs",
    },
    {
      toolName: "grep",
      args: { pattern: "ProcessTrace", path: "C:\\repo\\TinyOffice\\src" },
      expectedTitle: "鎼滅储 \"ProcessTrace\"锛岃寖鍥?src",
    },
    {
      toolName: "bash",
      args: { command: "npm test -- tests/runtime/pi-natural-language-responder.test.ts" },
      expectedTitle: "杩愯 npm test -- tests/runtime/pi-natural-language-responder.test.ts",
    },
    {
      toolName: "finish_intake_turn",
      args: { outcome: "record_event", message: "Process Trace label repaired" },
      expectedTitle: "鎻愪氦 Intake 缁撴灉",
    },
  ];
  const expectedAsciiTitles = new Map([
    ["read", "Read src/runtime/index.ts"],
    ["ls", "Listed docs"],
    ["grep", "Searched \"ProcessTrace\" in src"],
    ["bash", "Ran npm test -- tests/runtime/pi-natural-language-responder.test.ts"],
    ["finish_intake_turn", "Finished intake"],
  ]);

  for (const testCase of cases) {
    const events = buildProcessEventsFromSessionEvent(zhInput, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{
          type: "toolCall",
          name: testCase.toolName,
          arguments: testCase.args,
        }],
      },
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
      },
    });

    assert.equal(events.length, 2);
    assert.equal(events[0].kind, "tool_activity");
    assert.equal(events[0].title, expectedAsciiTitles.get(testCase.toolName));
    assert.doesNotMatch(events[0].title, mojibakePattern);
  }
});

test("PI process trace runtime labels stay stable for Chinese preferred language", () => {
  const events = buildProcessEventsFromSessionEvent({
    ...input,
    preferredLanguage: "zh-CN",
  }, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{
        type: "toolCall",
        name: "finish_intake_turn",
        arguments: {
          outcome: "create_work",
          message: "Create follow-up work.",
          work: {
            title: "Check article image gap",
            ownerMemberId: "iris-growth",
            acceptanceCriteria: "Article image status has been verified and repaired.",
          },
        },
      }],
    },
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
    },
  });

  assert.equal(events.length, 2);
  assert.match(events[0].title, /Finished intake/);
  assert.match(events[1].title, /finish_intake_turn/);
});

test("PI raw session events become redacted runtime session events", () => {
  const event = runtimeSessionEventFromPiEvent({
    type: "message",
    authorization: "Bearer secret-token-value",
    message: {
      role: "assistant",
      content: [{
        type: "text",
        text: "Here is the answer.",
        apiKey: "sk-abcdefghijklmnop",
      }],
    },
  });

  assert.equal(event.kind, "message");
  assert.equal(event.role, "assistant");
  assert.match(event.title || "", /PI assistant message/);
  assert.match(event.preview || "", /Here is the answer/);
  assert.equal(event.payload?.authorization, "<redacted>");
  const payloadText = JSON.stringify(event.payload);
  assert.doesNotMatch(payloadText, /secret-token-value/);
  assert.doesNotMatch(payloadText, /sk-abcdefghijklmnop/);
});

test("natural language runtime session snapshot preserves independent process trace writes", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-snapshot-"));
  const record = {
    id: "runtime-session-1",
    employeeId: "mira-hr",
    sessionKey: "mira-hr|dm_thread|root-1",
    sessionId: "mira-hr|dm_thread|root-1",
    sceneType: "dm_thread" as const,
    channelTopicId: "channel-topic-root-1",
    requesterId: "xuziho",
    status: "running" as const,
    title: "Mira DM session",
    summary: "Employee reply started.",
    startedAt: "2026-06-12T10:15:00.000Z",
    updatedAt: "2026-06-12T10:15:01.000Z",
  };
  const userEvent = {
    id: "runtime-session-1-event-000001",
    sessionRecordId: "runtime-session-1",
    sequence: 1,
    timestamp: "2026-06-12T10:15:01.000Z",
    kind: "user_message",
    role: "user",
    title: "User prompt",
    summary: "test",
    preview: "test",
    payload: { threadId: "root-1" },
    byteSize: 6,
  };

  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, record, [userEvent]);
  await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
    sessionKey: "mira-hr|dm_thread|root-1",
    channelTopicId: "channel-topic-root-1",
    employeeId: "mira-hr",
    kind: "employee_reply_started",
    title: "mira-hr started working",
    status: "running",
  });
  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, {
    ...record,
    status: "failed",
    summary: "PI returned an empty reply for mira-hr",
    updatedAt: "2026-06-12T10:15:17.000Z",
  }, [
    userEvent,
    {
      id: "runtime-session-1-event-000002",
      sessionRecordId: "runtime-session-1",
      sequence: 2,
      timestamp: "2026-06-12T10:15:17.000Z",
      kind: "error",
      title: "Employee reply failed",
      summary: "PI returned an empty reply for mira-hr",
      preview: "PI returned an empty reply for mira-hr",
      byteSize: 39,
    },
  ]);

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail("runtime-session-1");
    assert.equal(detail?.record.status, "failed");
    assert.equal(detail?.events.length, 2);
    assert.equal(repository.listProcessTraceEvents({ sessionKey: "mira-hr|dm_thread|root-1" }).length, 1);
  } finally {
    repository.close();
  }
});

test("natural language runtime session snapshot makes repeated flushes idempotent within a turn", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-snapshot-idempotent-"));
  const structured = {
    sceneId: "mira-hr|dm_thread|root-1",
    turnId: "mira-hr|dm_thread|root-1|turn-1",
    runId: "runtime-session-idempotent-1",
    modelCallId: "runtime-session-idempotent-1|model_call|primary",
  };
  const record = {
    id: "runtime-session-idempotent-1",
    employeeId: "mira-hr",
    sessionKey: "mira-hr|dm_thread|root-1",
    sessionId: "mira-hr|dm_thread|root-1",
    sceneType: "dm_thread" as const,
    requesterId: "xuziho",
    status: "running" as const,
    title: "Mira DM session",
    summary: "Employee reply started.",
    startedAt: "2026-06-12T10:15:00.000Z",
    updatedAt: "2026-06-12T10:15:01.000Z",
  };
  const events = [
    {
      id: "runtime-session-idempotent-1-event-000001",
      sessionRecordId: "runtime-session-idempotent-1",
      sequence: 1,
      timestamp: "2026-06-12T10:15:01.000Z",
      kind: "user_message",
      role: "user",
      title: "User prompt",
      summary: "first prompt",
      preview: "first prompt",
      payload: {
        ...structured,
        source: "tinyoffice.chat.user_message",
        visibility: "user_visible",
        semanticRole: "user_message",
        rawEventKind: "user_message",
      },
      byteSize: 12,
    },
    {
      id: "runtime-session-idempotent-1-event-000002",
      sessionRecordId: "runtime-session-idempotent-1",
      sequence: 2,
      timestamp: "2026-06-12T10:15:02.000Z",
      kind: "model_call_started",
      title: "Model call started",
      summary: "Primary model call started.",
      preview: "Primary model call started.",
      payload: {
        ...structured,
        source: "runtime.model_call",
        visibility: "diagnostic",
        semanticRole: "model_call_lifecycle",
        rawEventKind: "model_call_started",
      },
      byteSize: 27,
    },
    {
      id: "runtime-session-idempotent-1-event-000003",
      sessionRecordId: "runtime-session-idempotent-1",
      sequence: 3,
      timestamp: "2026-06-12T10:15:02.500Z",
      kind: "prompt_context",
      role: "user",
      visibility: "prompt_context",
      semanticRole: "work_run_context",
      rawEventKind: "prompt_context",
      title: "WorkRun context",
      summary: "structured context",
      preview: "structured context",
      payload: structured,
      byteSize: 18,
    },
    {
      id: "runtime-session-idempotent-1-event-000004",
      sessionRecordId: "runtime-session-idempotent-1",
      sequence: 4,
      timestamp: "2026-06-12T10:15:02.600Z",
      kind: "assistant_message",
      role: "assistant",
      visibility: "diagnostic",
      semanticRole: "model_output",
      rawEventKind: "assistant_message",
      title: "Assistant lifecycle wrapper",
      summary: "message_end",
      preview: "message_end",
      payload: structured,
      byteSize: 11,
    },
  ];

  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, record, events);
  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, {
    ...record,
    updatedAt: "2026-06-12T10:15:03.000Z",
  }, [
    events[0],
    {
      ...events[1],
      timestamp: "2026-06-12T10:15:03.000Z",
      summary: "Primary model call started during retry flush.",
      preview: "Primary model call started during retry flush.",
    },
    events[2],
    events[3],
  ]);

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail("runtime-session-idempotent-1");
    assert.equal(detail?.record.eventCount, 4);
    assert.equal(detail?.record.userMessageCount, 1);
    assert.equal(detail?.record.assistantMessageCount, 0);
    assert.deepEqual(detail?.events.map((event) => event.id), [
      "runtime-session-idempotent-1-event-000001",
      "runtime-session-idempotent-1-event-000002",
      "runtime-session-idempotent-1-event-000003",
      "runtime-session-idempotent-1-event-000004",
    ]);
    assert.deepEqual(detail?.events.map((event) => event.sequence), [1, 2, 3, 4]);
  } finally {
    repository.close();
  }
});

test("natural language responder forwards prompt context and active tools to the reply agent", async () => {
  let captured: {
    message: string;
    contextBlocks?: Array<{ role: string; text: string }>;
    activeToolNames?: string[];
  } | undefined;
  const runtimeProvider = {
    async reply(replyInput: {
      message: string;
      contextBlocks?: Array<{ role: string; text: string }>;
      activeToolNames?: string[];
    }) {
      captured = replyInput;
      return "handoff emitted";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot: await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-context-policy-")),
    runtimeProvider,
    contextBlocks: [{
      role: "channel_thread_context",
      source: "tinyoffice.channel_topic_context",
      label: "TinyOffice Channel/Topic context",
      text: "Room thread evidence.",
    }],
    activeToolNames: ["handoff_topic_turn"],
  });

  assert.equal(captured?.message, input.message);
  assert.equal(captured?.contextBlocks?.[0]?.role, "channel_thread_context");
  assert.equal(captured?.contextBlocks?.[0]?.text, "Room thread evidence.");
  assert.deepEqual(captured?.activeToolNames, ["handoff_topic_turn"]);
  assert.equal(Object.prototype.hasOwnProperty.call(captured || {}, "completionPolicy"), false);
});

test("natural language responder traces successful runtime session persistence", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-persist-trace-"));
  const sessionKey = `mira-hr|dm_thread|persist-trace-${Date.now()}`;
  const runtimeProvider = {
    async reply() {
      return "persisted reply";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "persist-trace-root",
    channelTopicId: undefined,
    runtimeProvider,
  });

  const tracePath = path.resolve(process.cwd(), ".scratch", "runtime-provider-responder.jsonl");
  const traceLines = (await readFile(tracePath, "utf8")).split(/\r?\n/).filter(Boolean);
  const matchingTrace = traceLines
    .map((line) => JSON.parse(line) as { phase?: string; sessionKey?: string; appendedEventCount?: number })
    .find((entry) => entry.sessionKey === sessionKey && entry.phase === "reply.session_persisted");

  assert.ok(matchingTrace);
  assert.ok(Number(matchingTrace.appendedEventCount) > 0);
});

test("natural language responder persists intake context as a prompt context event", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-intake-context-"));
  const sessionKey = "quality-editor|intake_event|intake-context-1";
  const runtimeProvider = {
    async reply() {
      return "intake recorded";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "intake-context-1",
    runtimeProvider,
    contextBlocks: [{
      role: "intake_event_context",
      source: "external_intake.event_payload",
      label: "External intake event context",
      text: "External intake event evidence:\nmissing_featured_image",
    }],
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const [session] = repository.listSessionRecords();
    assert.ok(session);
    const detail = repository.getSessionDetail(session.id);
    const contextEvent = detail?.events.find((event) => event.semanticRole === "intake_event_context");
    assert.ok(contextEvent);
    assert.equal(contextEvent.kind, "prompt_context");
    assert.equal(contextEvent.visibility, "prompt_context");
    assert.equal(contextEvent.source, "external_intake.event_payload");
    assert.equal(contextEvent.preview, "External intake event evidence:\nmissing_featured_image");
  } finally {
    repository.close();
  }
});

test("natural language responder does not persist a separate completion policy boundary", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-no-completion-policy-"));
  const sessionKey = "mira-hr|channel_thread|root-no-completion-policy-1";
  const runtimeProvider = {
    async reply() {
      return "handoff emitted";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "root-no-completion-policy-1",
    channelTopicId: "channel-topic-root-no-completion-policy-1",
    runtimeProvider,
    activeToolNames: ["handoff_topic_turn"],
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const [session] = repository.listSessionRecords();
    assert.ok(session);
    const detail = repository.getSessionDetail(session.id);
    assert.equal(detail?.events.some((event) =>
      event.kind === "completion_policy" || event.semanticRole === "completion_policy"
    ), false);
    const promptPackageEvent = detail?.events.find((event) => event.kind === "prompt_input_package");
    const tools = (promptPackageEvent?.payload as { tools?: Array<{ name?: string }> } | undefined)?.tools || [];
    assert.equal(tools.some((tool) => tool.name === "handoff_topic_turn"), true);
  } finally {
    repository.close();
  }
});

test("natural language responder persists first-class model call lifecycle events", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-model-call-events-"));
  const sessionKey = "mira-hr|channel_thread|root-model-call-1";
  const runtimeProvider = {
    async reply(replyInput: {
      onTextDelta?: (text: string) => void;
    }) {
      replyInput.onTextDelta?.("Drafting");
      return "Model reply completed.";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "root-model-call-1",
    runtimeProvider,
    enableTextDeltas: true,
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const [session] = repository.listSessionRecords();
    assert.ok(session);
    const detail = repository.getSessionDetail(session.id);
    const lifecycleEvents = detail?.events.filter((event) => event.kind.startsWith("model_call_")) ?? [];
    assert.deepEqual(lifecycleEvents.map((event) => event.kind), [
      "model_call_started",
      "model_call_completed",
    ]);
    assert.equal(new Set(lifecycleEvents.map((event) => event.modelCallId)).size, 1);
    assert.equal(lifecycleEvents[0]?.source, "runtime.model_call");
    assert.equal(lifecycleEvents[0]?.visibility, "diagnostic");
    assert.equal(lifecycleEvents[0]?.semanticRole, "model_call_lifecycle");
    assert.equal(lifecycleEvents[1]?.preview, "Model reply completed.");
  } finally {
    repository.close();
  }
});

test("natural language responder returns structured usage from PI session events", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-usage-metadata-"));
  const sessionKey = "mira-hr|dm_thread|root-usage-metadata-1";
  const runtimeProvider = {
    async reply(replyInput: {
      onProviderEvent?: (event: ReturnType<typeof normalizePiProviderEvent>) => void;
    }) {
      emitPiTestProviderEvent(replyInput, {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I am Mira." }],
          usage: {
            input: 3320,
            output: 36,
            cacheRead: 7,
            cacheWrite: 5,
            totalTokens: 3356,
            cost: {
              total: 0.00884,
            },
          },
        },
      });
      return "I am Mira.";
    },
  };

  const reply = await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "root-usage-metadata-1",
    runtimeProvider,
  });

  assert.equal(reply.message, "I am Mira.");
  assert.deepEqual(reply.usage, {
    input: 3320,
    output: 36,
    cacheRead: 7,
    cacheWrite: 5,
    totalTokens: 3356,
    cost: {
      total: 0.00884,
    },
  });
  assert.equal(reply.runtimeSceneTurn.modelCall.purpose, "primary");

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const [session] = repository.listSessionRecords();
    assert.ok(session);
    assert.equal(session.tokenInputTotal, 3320);
    assert.equal(session.tokenOutputTotal, 36);
    assert.equal(session.tokenCacheTotal, 12);
  } finally {
    repository.close();
  }
});

test("natural language responder waits for async final tool process events before returning", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-final-tool-process-events-"));
  const sessionKey = "mira-hr|channel_thread|root-final-tool-events-1";
  const processEvents: Array<{ kind?: string; status?: string; metadata?: { toolName?: string; arguments?: unknown } }> = [];
  const runtimeProvider = {
    async reply(replyInput: {
      onProviderEvent?: (event: ReturnType<typeof normalizePiProviderEvent>) => void;
    }) {
      emitPiTestProviderEvent(replyInput, {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{
            type: "toolCall",
            name: "handoff_topic_turn",
            arguments: {
              toId: "nora-automation",
              message: "Nora should refine the intake workflow wording.",
            },
          }],
        },
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: {
            name: "handoff_topic_turn",
            arguments: {
              toId: "nora-automation",
              message: "Nora should refine the intake workflow wording.",
            },
          },
        },
      });
      return "";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "root-final-tool-events-1",
    channelTopicId: "channel-topic-root-final-tool-events-1",
    activeToolNames: ["handoff_topic_turn"],
    allowEmptyReply: true,
    runtimeProvider,
    onProcessEvent: async (event) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      processEvents.push(event);
    },
  });

  assert.ok(processEvents.some((event) =>
    event.kind === "model_tool_call" &&
    event.status === "succeeded" &&
    event.metadata?.toolName === "handoff_topic_turn" &&
    (event.metadata.arguments as { toId?: string } | undefined)?.toId === "nora-automation"
  ));
});

test("natural language responder keeps each follow-up message as a separate runtime turn", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-followup-turns-"));
  const sessionKey = "mira-hr|dm_thread|root-followup-turns-1";
  const sessionRecordId = `runtime-session-${Buffer.from(`${employee.employeeId}|${sessionKey}`).toString("base64url").slice(0, 96)}`;
  let replyIndex = 0;
  const runtimeProvider = {
    async reply(replyInput: {
      message: string;
      onProviderEvent?: (event: ReturnType<typeof normalizePiProviderEvent>) => void;
    }) {
      replyIndex += 1;
      emitPiTestProviderEvent(replyInput, {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: `reply ${replyIndex}` }],
          usage: {
            input: 100 + replyIndex,
            output: 10 + replyIndex,
            cacheRead: replyIndex,
            cacheWrite: replyIndex + 1,
          },
        },
      });
      return `reply ${replyIndex}: ${replyInput.message}`;
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "root-followup-turns-1",
    message: "first user message",
    runtimeProvider,
  });
  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "root-followup-turns-1",
    message: "second user message",
    runtimeProvider,
  });
  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "root-followup-turns-1",
    message: "third user message",
    runtimeProvider,
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail(sessionRecordId);
    assert.ok(detail);
    assert.equal(detail.record.userMessageCount, 3);
    assert.equal(detail.record.assistantMessageCount, 3);
    assert.equal(detail.record.tokenInputTotal, 306);
    assert.equal(detail.record.tokenOutputTotal, 36);
    assert.equal(detail.record.tokenCacheTotal, 15);
    assert.deepEqual(
      detail.events.filter((event) => event.kind === "user_message").map((event) => event.preview),
      ["first user message", "second user message", "third user message"],
    );
    assert.equal(new Set(detail.events.map((event) => event.turnId).filter(Boolean)).size, 3);
    assert.equal(new Set(detail.events.map((event) => event.modelCallId).filter(Boolean)).size, 3);
    for (const event of detail.events) {
      assert.ok(event.turnId);
      assert.match(event.id, new RegExp(`^${sessionRecordId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|${event.turnId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|event\\|\\d{6}$`));
    }
  } finally {
    repository.close();
  }
});

test("natural language responder persists the same final usage that is returned to the product caller", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-final-usage-single-source-"));
  const sessionKey = "mira-hr|dm_thread|dm-final-usage-single-source-1";
  const runtimeProvider = {
    async reply(replyInput: {
      onProviderEvent?: (event: ReturnType<typeof normalizePiProviderEvent>) => void;
    }) {
      emitPiTestProviderEvent(replyInput, {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I checked the workspace." }],
          usage: {
            input: 3573,
            output: 86,
            cacheRead: 0,
            cacheWrite: 0,
          },
        },
      });
      emitPiTestProviderEvent(replyInput, {
        type: "turn_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I checked the workspace." }],
          usage: {
            input: 3573,
            output: 86,
            cacheRead: 0,
            cacheWrite: 0,
          },
        },
      });
      emitPiTestProviderEvent(replyInput, {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta" },
        message: {
          role: "assistant",
          content: [{ type: "text", text: "" }],
          usage: {
            input: 5984,
            output: 310,
            cacheRead: 3584,
            cacheWrite: 0,
          },
        },
      });
      return "I checked the workspace.";
    },
  };

  const response = await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "dm-final-usage-single-source-1",
    message: "Please check your workspace.",
    runtimeProvider,
  });

  assert.deepEqual(response.usage, {
    input: 5984,
    output: 310,
    cacheRead: 3584,
    cacheWrite: 0,
    cost: {
      total: undefined,
    },
    totalTokens: undefined,
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const [session] = repository.listSessionRecords();
    assert.ok(session);
    assert.equal(session.tokenInputTotal, 5984);
    assert.equal(session.tokenOutputTotal, 310);
    assert.equal(session.tokenCacheTotal, 3584);
  } finally {
    repository.close();
  }
});

test("natural language responder persists WorkRun id for work_run_execution sessions", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-work-run-session-"));
  const sessionKey = "mira-hr|work_run_execution|work-run-usage-1";
  const runtimeProvider = {
    async reply() {
      return "WorkRun usage recorded.";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "work-run-usage-1",
    runtimeProvider,
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const [session] = repository.listSessionRecords({ workRunId: "work-run-usage-1" });
    assert.ok(session);
    assert.equal(session.sceneType, "work_run_execution");
    assert.equal(session.workRunId, "work-run-usage-1");
  } finally {
    repository.close();
  }
});

test("natural language responder persists a running session before the reply completes", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-running-session-"));
  const sessionKey = "mira-hr|channel_thread|root-running-1";
  const sessionRecordId = `runtime-session-${Buffer.from(`${employee.employeeId}|${sessionKey}`).toString("base64url").slice(0, 96)}`;
  let releaseReply: ((value: string) => void) | undefined;
  let replyStarted: (() => void) | undefined;
  const replyStartedPromise = new Promise<void>((resolve) => {
    replyStarted = resolve;
  });
  const runtimeProvider = {
    async reply(replyInput: {
      onProviderEvent?: (event: ReturnType<typeof normalizePiProviderEvent>) => void;
    }) {
      emitPiTestProviderEvent(replyInput, {
        type: "message_start",
        message: {
          role: "assistant",
        },
      });
      replyStarted?.();
      return new Promise<string>((resolve) => {
        releaseReply = resolve;
      });
    },
  };

  const replyPromise = generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "root-running-1",
    channelTopicId: "channel-topic-root-running-1",
    requesterUsername: "xuziho",
    runtimeProvider,
  });

  await replyStartedPromise;
  await waitForCondition(async () => {
    const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
    try {
      const detail = repository.getSessionDetail(sessionRecordId);
      return detail?.record.status === "running" &&
        detail.events.some((event) => event.kind === "user_message" && event.preview === input.message);
    } finally {
      repository.close();
    }
  });

  releaseReply?.("The onboarding checklist is in the People handbook.");
  await replyPromise;

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail(sessionRecordId);
    assert.equal(detail?.record.status, "completed");
    assert.ok(detail?.events.some((event) => event.kind === "assistant_message"));
  } finally {
    repository.close();
  }
});

test("natural language responder incrementally persists filtered PI session events before reply completion", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-incremental-session-event-"));
  const sessionKey = "mira-hr|channel_thread|root-incremental-1";
  const sessionRecordId = `runtime-session-${Buffer.from(`${employee.employeeId}|${sessionKey}`).toString("base64url").slice(0, 96)}`;
  let releaseReply: ((value: string) => void) | undefined;
  let eventEmitted: (() => void) | undefined;
  const eventEmittedPromise = new Promise<void>((resolve) => {
    eventEmitted = resolve;
  });
  const runtimeProvider = {
    async reply(replyInput: {
      onProviderEvent?: (event: ReturnType<typeof normalizePiProviderEvent>) => void;
    }) {
      emitPiTestProviderEvent(replyInput, {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "private scratchpad text" }],
        },
        assistantMessageEvent: {
          type: "thinking_start",
          contentIndex: 0,
        },
      });
      eventEmitted?.();
      return new Promise<string>((resolve) => {
        releaseReply = resolve;
      });
    },
  };

  const replyPromise = generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "root-incremental-1",
    runtimeProvider,
  });

  try {
    await eventEmittedPromise;
    await waitForCondition(async () => {
      const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
      try {
        const detail = repository.getSessionDetail(sessionRecordId);
        const incrementalEvent = detail?.events.find((event) =>
          event.kind === "stream_event" &&
          event.rawEventKind === "message_update" &&
          event.semanticRole === "model_delta" &&
          event.title === "PI message_update thinking_start"
        );
        assert.doesNotMatch(incrementalEvent?.summary || "", /private scratchpad text/);
        assert.doesNotMatch(incrementalEvent?.preview || "", /private scratchpad text/);
        return detail?.record.status === "running" && Boolean(incrementalEvent);
      } finally {
        repository.close();
      }
    });
  } finally {
    releaseReply?.("I captured the runtime event before finishing the reply.");
  }
  await replyPromise;
});

test("natural language responder records configured model metadata on runtime sessions", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-model-"));
  const modelEmployee = {
    ...employee,
    runtime: {
      version: 1 as const,
      modelProvider: "openai-codex",
      modelId: "gpt-5.4",
      thinkingLevel: "minimal" as const,
    },
  };
  const sessionKey = "mira-hr|channel_thread|root-model-1";
  const sessionRecordId = `runtime-session-${Buffer.from(`${employee.employeeId}|${sessionKey}`).toString("base64url").slice(0, 96)}`;
  const runtimeProvider = {
    async reply() {
      return "I checked the hiring plan and will prepare the next interview notes.";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    employee: modelEmployee,
    repoRoot,
    sessionKey,
    threadId: "root-model-1",
    channelTopicId: "channel-topic-root-model-1",
    requesterUsername: "xuziho",
    activeToolNames: ["finish_intake_turn"],
    runtimeProvider,
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail(sessionRecordId);
    assert.equal(detail?.record.modelProvider, "openai-codex");
    assert.equal(detail?.record.modelId, "gpt-5.4");
    assert.deepEqual(detail?.record.runtimeMetadata?.model, {
      state: "recorded",
      provider: "openai-codex",
      id: "gpt-5.4",
      source: "employee.runtime",
    });
    assert.deepEqual(detail?.record.runtimeMetadata?.cwd, {
      state: "recorded",
      value: employee.workspacePath,
      source: "employee.workspacePath",
    });
    assert.deepEqual(detail?.record.runtimeMetadata?.tools?.activeToolNames, ["finish_intake_turn"]);
    const promptPackageEvent = detail?.events.find((event) => event.kind === "prompt_input_package");
    assert.equal(promptPackageEvent?.semanticRole, "prompt_input_package");
    const payload = promptPackageEvent?.payload as {
      source?: string;
      tools?: Array<{ name: string }>;
      systemPrompt?: { text?: string };
      runtimePrompt?: { userPrompt?: string };
    } | undefined;
    assert.equal(payload?.source, "tinyoffice_prompt_input_package");
    assert.deepEqual(payload?.tools?.map((tool) => tool.name), ["finish_intake_turn"]);
    assert.match(payload?.systemPrompt?.text || "", /Employee id: mira-hr/);
    assert.match(payload?.runtimePrompt?.userPrompt || "", /User Message:/);
  } finally {
    repository.close();
  }
});

test("natural language responder persists a per-turn prompt input package", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-prompt-package-"));
  const sessionKey = "mira-hr|dm_thread|prompt-package-1";
  const sessionRecordId = `runtime-session-${Buffer.from(`${employee.employeeId}|${sessionKey}`).toString("base64url").slice(0, 96)}`;
  const runtimeProvider = {
    async reply() {
      return "I am Mira.";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    repoRoot,
    sessionKey,
    threadId: "prompt-package-1",
    requesterUsername: "xuziho",
    message: "Who are you?",
    activeToolNames: ["finish_intake_turn"],
    runtimeProvider,
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail(sessionRecordId);
    const promptPackageEvent = detail?.events.find((event) => event.kind === "prompt_input_package");
    assert.equal(promptPackageEvent?.visibility, "model_input");
    assert.equal(promptPackageEvent?.semanticRole, "prompt_input_package");
    assert.equal(
      promptPackageEvent?.modelCallId,
      detail?.events.find((event) => event.kind === "assistant_message")?.modelCallId,
    );
    const payload = promptPackageEvent?.payload as {
      source?: string;
      systemPrompt?: { text?: string; sha256?: string };
      runtimePrompt?: { userPrompt?: string; sha256?: string };
      userMessage?: { text?: string };
      tools?: Array<{ name: string }>;
      cacheEvidence?: {
        fullInputSha256?: string;
        stablePrefixSha256?: string;
        estimatedStablePrefixChars?: number;
      };
    } | undefined;
    assert.equal(payload?.source, "tinyoffice_prompt_input_package");
    assert.match(payload?.systemPrompt?.text || "", /Employee id: mira-hr/);
    assert.match(payload?.runtimePrompt?.userPrompt || "", /User Message:\nWho are you\?/);
    assert.equal(payload?.userMessage?.text, "Who are you?");
    assert.deepEqual(payload?.tools?.map((tool) => tool.name), ["finish_intake_turn"]);
    assert.equal(typeof payload?.systemPrompt?.sha256, "string");
    assert.equal(typeof payload?.runtimePrompt?.sha256, "string");
    assert.equal(typeof payload?.cacheEvidence?.fullInputSha256, "string");
    assert.equal(typeof payload?.cacheEvidence?.stablePrefixSha256, "string");
    assert.equal(typeof payload?.cacheEvidence?.estimatedStablePrefixChars, "number");
  } finally {
    repository.close();
  }
});

test("natural language responder does not use PI local prompt files as session metadata source", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-default-model-"));
  const workspacePath = await mkdtemp(path.join(tmpdir(), "tinyoffice-mira-workspace-"));
  const sessionKey = "mira-hr|dm_thread|default-model-1";
  const snapshotDir = path.join(
    workspacePath,
    ".scratch",
    "pi-sessions",
    "mira-hr",
    sessionKey.replace(/[^a-zA-Z0-9._-]+/g, "_"),
  );
  await mkdir(snapshotDir, { recursive: true });
  await writeFile(
    path.join(snapshotDir, "prompt-snapshot.json"),
    JSON.stringify({
      version: 1,
      employeeId: "mira-hr",
      sessionKey: "mira-hr|dm_thread|default-model-1",
      cwd: workspacePath,
      systemPromptAppend: "redacted by test",
      effectiveModel: {
        provider: "openai-codex",
        id: "snapshot-model-should-not-win",
      },
      activeToolNames: ["handoff"],
      updatedAt: "2026-06-16T00:00:00.000Z",
      promptHistory: [],
    }, null, 2),
    "utf8",
  );
  const missingExplicitModelEmployee = {
    ...employee,
    workspacePath,
    runtime: {
      version: 1 as const,
      thinkingLevel: "minimal" as const,
    },
  };
  const sessionRecordId = `runtime-session-${Buffer.from(`${employee.employeeId}|${sessionKey}`).toString("base64url").slice(0, 96)}`;
  const runtimeProvider = {
    async reply() {
      return "I ran without an explicit employee runtime model.";
    },
  };

  await generateNaturalLanguageEmployeeReply({
    ...input,
    employee: missingExplicitModelEmployee,
    repoRoot,
    sessionKey,
    threadId: "default-model-1",
    requesterUsername: "xuziho",
    activeToolNames: ["handoff"],
    runtimeProvider,
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail(sessionRecordId);
    assert.equal(detail?.record.modelProvider, undefined);
    assert.equal(detail?.record.modelId, undefined);
    assert.deepEqual(detail?.record.runtimeMetadata?.model, {
      state: "not_recorded",
      source: "employee.runtime",
      diagnostic: "No explicit employee runtime model was configured.",
    });
    const promptPackageEvent = detail?.events.find((event) => event.kind === "prompt_input_package");
    const payload = promptPackageEvent?.payload as { source?: string; systemPrompt?: { text?: string } } | undefined;
    assert.equal(payload?.source, "tinyoffice_prompt_input_package");
    assert.match(payload?.systemPrompt?.text || "", /Employee id: mira-hr/);
  } finally {
    repository.close();
  }
});

test("natural language responder does not create a secondary model summary session", async () => {
  const source = await naturalLanguageResponderRuntimeSource();

  assert.doesNotMatch(source, /\|trace_summary/);
  assert.doesNotMatch(source, /visible action summary/i);
  assert.doesNotMatch(source, /model_generated_live/);
});

test("natural language responder runtime stays split into focused modules", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/runtime/provider/natural-language-responder-runtime.ts"),
    "utf8",
  );

  assert.match(source, /natural-language-responder-runtime-session-writer/);
  assert.match(source, /natural-language-responder-runtime-process-events/);
  assert.match(source, /natural-language-responder-runtime-text-deltas/);
  assert.match(source, /natural-language-responder-runtime-completion-memory/);
  assert.doesNotMatch(source, /RuntimeSessionRepository/);
  assert.doesNotMatch(source, /upsertSessionCompletionMemory/);
  assert.ok(source.split(/\r?\n/).length <= 420);
});

test("natural language responder public entry stays thin", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src/runtime/provider/natural-language-responder.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /runtimeProvider\.reply/);
  assert.doesNotMatch(source, /buildPromptInputPackage/);
  assert.doesNotMatch(source, /appendRuntimeSessionEvent/);
  assert.doesNotMatch(source, /persistNaturalLanguageRuntimeSessionSnapshotIntoRepository\(/);
  assert.ok(source.split(/\r?\n/).length <= 120);
});

test("natural language responder source keeps text-delta process trace titles ASCII-stable", async () => {
  const source = await naturalLanguageResponderRuntimeSource();

  assert.match(source, /is generating/);
  assert.doesNotMatch(source, /title: input.preferredLanguage/);
  assert.doesNotMatch(source, mojibakePattern);
});

async function naturalLanguageResponderRuntimeSource() {
  const moduleNames = [
    "natural-language-responder-runtime.ts",
    "natural-language-responder-runtime-text-deltas.ts",
  ];
  const sources = await Promise.all(moduleNames.map((moduleName) =>
    readFile(path.join(process.cwd(), "src/runtime/provider", moduleName), "utf8")
  ));
  return sources.join("\n");
}

test("natural language runtime session snapshot appends follow-up turns for the same thread session", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-snapshot-followup-"));
  const baseRecord = {
    id: "runtime-session-thread-1",
    employeeId: "mira-hr",
    sessionKey: "mira-hr|channel_thread|root-thread-1",
    sessionId: "mira-hr|channel_thread|root-thread-1",
    sceneType: "channel_thread" as const,
    channelTopicId: "channel-topic-root-thread-1",
    requesterId: "xuziho",
    status: "completed" as const,
    title: "Mira channel thread session",
    summary: "Employee reply completed.",
    startedAt: "2026-06-12T10:15:00.000Z",
    updatedAt: "2026-06-12T10:15:04.000Z",
  };

  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, baseRecord, [
    {
      id: "runtime-session-thread-1-event-000001",
      sessionRecordId: "runtime-session-thread-1",
      sequence: 1,
      timestamp: "2026-06-12T10:15:01.000Z",
      kind: "user_message",
      role: "user",
      title: "User prompt",
      summary: "first prompt",
      preview: "first prompt",
      byteSize: 12,
    },
    {
      id: "runtime-session-thread-1-event-000002",
      sessionRecordId: "runtime-session-thread-1",
      sequence: 2,
      timestamp: "2026-06-12T10:15:04.000Z",
      kind: "assistant_message",
      role: "assistant",
      title: "Assistant reply",
      summary: "first reply",
      preview: "first reply",
      byteSize: 11,
    },
  ]);

  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, {
    ...baseRecord,
    startedAt: "2026-06-12T10:20:00.000Z",
    updatedAt: "2026-06-12T10:20:04.000Z",
  }, [
    {
      id: "runtime-session-thread-1-event-000001",
      sessionRecordId: "runtime-session-thread-1",
      sequence: 1,
      timestamp: "2026-06-12T10:20:01.000Z",
      kind: "user_message",
      role: "user",
      title: "User prompt",
      summary: "follow-up prompt",
      preview: "follow-up prompt",
      byteSize: 16,
    },
    {
      id: "runtime-session-thread-1-event-000002",
      sessionRecordId: "runtime-session-thread-1",
      sequence: 2,
      timestamp: "2026-06-12T10:20:04.000Z",
      kind: "assistant_message",
      role: "assistant",
      title: "Assistant reply",
      summary: "follow-up reply",
      preview: "follow-up reply",
      byteSize: 15,
    },
  ]);

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail("runtime-session-thread-1");
    assert.equal(detail?.record.startedAt, "2026-06-12T10:15:00.000Z");
    assert.equal(detail?.record.updatedAt, "2026-06-12T10:20:04.000Z");
    assert.equal(detail?.record.eventCount, 4);
    assert.deepEqual(detail?.events.map((event) => event.sequence), [1, 2, 3, 4]);
    assert.deepEqual(detail?.events.map((event) => event.summary), [
      "first prompt",
      "first reply",
      "follow-up prompt",
      "follow-up reply",
    ]);
  } finally {
    repository.close();
  }
});

test("natural language runtime session snapshot preserves conflicting final visible events", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-snapshot-conflict-"));
  const record = {
    id: "runtime-session-conflict-1",
    employeeId: "mira-hr",
    sessionKey: "mira-hr|dm_thread|root-conflict-1",
    sessionId: "mira-hr|dm_thread|root-conflict-1",
    sceneType: "dm_thread" as const,
    requesterId: "xuziho",
    status: "running" as const,
    title: "Mira DM session",
    summary: "Employee reply running.",
    startedAt: "2026-06-12T10:15:00.000Z",
    updatedAt: "2026-06-12T10:15:02.000Z",
  };

  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, record, [
    {
      id: "runtime-session-conflict-1-event-000001",
      sessionRecordId: "runtime-session-conflict-1",
      sequence: 1,
      timestamp: "2026-06-12T10:15:01.000Z",
      kind: "user_message",
      role: "user",
      visibility: "user_visible",
      semanticRole: "user_message",
      title: "User prompt",
      summary: "Who are you?",
      preview: "Who are you?",
      byteSize: 12,
    },
    {
      id: "runtime-session-conflict-1-event-000002",
      sessionRecordId: "runtime-session-conflict-1",
      sequence: 2,
      timestamp: "2026-06-12T10:15:02.000Z",
      kind: "message_end",
      role: "assistant",
      visibility: "raw",
      semanticRole: "assistant_raw_message",
      rawEventKind: "message_end",
      title: "PI message_end",
      summary: "raw assistant event",
      preview: "raw assistant event",
      byteSize: 19,
    },
    {
      id: "runtime-session-conflict-1-event-000004",
      sessionRecordId: "runtime-session-conflict-1",
      sequence: 3,
      timestamp: "2026-06-12T10:15:02.500Z",
      kind: "agent_end",
      visibility: "raw_evidence",
      semanticRole: "raw_model_event",
      rawEventKind: "agent_end",
      title: "PI agent_end",
      summary: "raw agent end",
      preview: "raw agent end",
      byteSize: 13,
    },
  ]);

  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, {
    ...record,
    status: "completed",
    summary: "Employee reply completed.",
    updatedAt: "2026-06-12T10:15:04.000Z",
  }, [
    {
      id: "runtime-session-conflict-1-event-000002",
      sessionRecordId: "runtime-session-conflict-1",
      sequence: 2,
      timestamp: "2026-06-12T10:15:03.000Z",
      kind: "model_call_completed",
      visibility: "diagnostic",
      semanticRole: "model_call_completed",
      title: "Model call completed",
      summary: "visible reply finalizing",
      preview: "visible reply finalizing",
      byteSize: 24,
    },
    {
      id: "runtime-session-conflict-1-event-000003",
      sessionRecordId: "runtime-session-conflict-1",
      sequence: 3,
      timestamp: "2026-06-12T10:15:04.000Z",
      kind: "assistant_message",
      role: "assistant",
      visibility: "user_visible",
      semanticRole: "assistant_visible_message",
      title: "Assistant reply",
      summary: "I am Mira.",
      preview: "I am Mira.",
      byteSize: 10,
    },
  ]);

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail("runtime-session-conflict-1");
    assert.deepEqual(detail?.events.map((event) => [event.sequence, event.id, event.kind, event.summary]), [
      [1, "runtime-session-conflict-1-event-000001", "user_message", "Who are you?"],
      [2, "runtime-session-conflict-1-event-000002", "message_end", "raw assistant event"],
      [3, "runtime-session-conflict-1-event-000004", "agent_end", "raw agent end"],
      [4, "runtime-session-conflict-1-event-000005", "model_call_completed", "visible reply finalizing"],
      [5, "runtime-session-conflict-1-event-000003", "assistant_message", "I am Mira."],
    ]);
    assert.equal(detail?.record.assistantMessageCount, 1);
  } finally {
    repository.close();
  }
});

test("natural language runtime session snapshot retries stale save after concurrent trace write", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-snapshot-stale-"));
  const record = {
    id: "runtime-session-stale-1",
    employeeId: "mira-hr",
    sessionKey: "mira-hr|dm_thread|root-stale-1",
    sessionId: "mira-hr|dm_thread|root-stale-1",
    sceneType: "dm_thread" as const,
    requesterId: "xuziho",
    status: "completed" as const,
    title: "Mira DM session",
    summary: "Employee reply completed.",
    startedAt: "2026-06-12T10:41:34.000Z",
    updatedAt: "2026-06-12T10:41:44.000Z",
  };
  const userEvent = {
    id: "runtime-session-stale-1-event-000001",
    sessionRecordId: "runtime-session-stale-1",
    sequence: 1,
    timestamp: "2026-06-12T10:41:34.000Z",
    kind: "user_message",
    role: "user",
    title: "User prompt",
    summary: "Hello, who are you?",
    preview: "Hello, who are you?",
    byteSize: 30,
  };
  const assistantEvent = {
    id: "runtime-session-stale-1-event-000002",
    sessionRecordId: "runtime-session-stale-1",
    sequence: 2,
    timestamp: "2026-06-12T10:41:44.000Z",
    kind: "assistant_message",
    role: "assistant",
    title: "Assistant reply",
    summary: "Hello, I am Mira.",
    preview: "Hello, I am Mira.",
    byteSize: 23,
  };

  let wroteConcurrentTrace = false;
  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, record, [userEvent, assistantEvent], {
    beforeSave: async () => {
      if (wroteConcurrentTrace) {
        return;
      }
      wroteConcurrentTrace = true;
      await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
        sessionKey: "mira-hr|dm_thread|root-stale-1",
        employeeId: "mira-hr",
        kind: "model_text_delta",
        title: "mira-hr is generating",
        preview: "test",
        status: "running",
      });
    },
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail("runtime-session-stale-1");
    assert.equal(detail?.record.status, "completed");
    assert.equal(detail?.events.length, 2);
    assert.equal(repository.listProcessTraceEvents({ sessionKey: "mira-hr|dm_thread|root-stale-1" }).length, 1);
  } finally {
    repository.close();
  }
});

test("natural language runtime session snapshot preserves concurrent trace writes without stale-save retries", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-session-snapshot-repeat-stale-"));
  const record = {
    id: "runtime-session-repeat-stale-1",
    employeeId: "mira-hr",
    sessionKey: "mira-hr|dm_thread|root-repeat-stale-1",
    sessionId: "mira-hr|dm_thread|root-repeat-stale-1",
    sceneType: "dm_thread" as const,
    requesterId: "xuziho",
    status: "completed" as const,
    title: "Mira DM session",
    summary: "Employee reply completed.",
    startedAt: "2026-06-12T11:09:24.000Z",
    updatedAt: "2026-06-12T11:09:39.000Z",
  };
  const events = [
    {
      id: "runtime-session-repeat-stale-1-event-000001",
      sessionRecordId: "runtime-session-repeat-stale-1",
      sequence: 1,
      timestamp: "2026-06-12T11:09:24.000Z",
      kind: "user_message",
      role: "user",
      title: "User prompt",
      summary: "Hello, who are you?",
      preview: "Hello, who are you?",
      byteSize: 27,
    },
    {
      id: "runtime-session-repeat-stale-1-event-000002",
      sessionRecordId: "runtime-session-repeat-stale-1",
      sequence: 2,
      timestamp: "2026-06-12T11:09:39.000Z",
      kind: "assistant_message",
      role: "assistant",
      title: "Assistant reply",
      summary: "Hello, I am Mira and I handle HR work.",
      preview: "Hello, I am Mira and I handle HR work.",
      byteSize: 49,
    },
  ];
  let concurrentWrites = 0;

  await persistNaturalLanguageRuntimeSessionSnapshot(repoRoot, DEFAULT_COMPANY_ID, record, events, {
    beforeSave: async () => {
      if (concurrentWrites >= 2) {
        return;
      }
      concurrentWrites += 1;
      await appendProcessTraceEvent(repoRoot, DEFAULT_COMPANY_ID, {
        sessionKey: "mira-hr|dm_thread|root-repeat-stale-1",
        employeeId: "mira-hr",
        kind: "model_text_delta",
        title: "mira-hr is generating",
        preview: `delta ${concurrentWrites}`,
        status: "running",
      });
    },
  });

  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const detail = repository.getSessionDetail("runtime-session-repeat-stale-1");
    assert.equal(detail?.record.status, "completed");
    assert.equal(detail?.events.length, 2);
    assert.equal(repository.listProcessTraceEvents({ sessionKey: "mira-hr|dm_thread|root-repeat-stale-1" }).length, 1);
  } finally {
    repository.close();
  }
});

test("PI stream session events summarize assistant updates without raw provider JSON", () => {
  const event = runtimeSessionEventFromPiEvent({
    type: "message_update",
    assistantMessageEvent: {
      type: "thinking_start",
      contentIndex: 0,
      partial: {
        role: "assistant",
        content: { items: [{ type: "thinking", thinking: "" }], truncated: false },
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-5.4",
        responseId: "resp_123",
      },
    },
    message: {
      role: "assistant",
      content: { items: [{ type: "thinking", thinking: "" }], truncated: false },
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.4",
      responseId: "resp_123",
    },
  });

  assert.equal(event.kind, "stream_event");
  assert.equal(event.role, "assistant");
  assert.equal(event.summary, "Assistant stream update: thinking_start.");
  assert.equal(event.preview, undefined);
  assert.doesNotMatch(event.summary || "", /openai-codex-responses|responseId|message_update/);
});

test("PI lifecycle session events keep raw provider JSON out of summary and preview", () => {
  for (const eventType of [
    "agent_start",
    "turn_start",
    "message_start",
    "message_end",
    "turn_end",
    "agent_end",
    "tool_execution_start",
    "tool_execution_end",
  ]) {
    const event = runtimeSessionEventFromPiEvent({
      type: eventType,
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.4",
      responseId: `resp_${eventType}`,
      message: {
        role: "assistant",
        content: {
          items: [],
          truncated: false,
        },
      },
      debug: {
        raw: {
          nested: {
            responseId: `resp_${eventType}`,
            output: "x".repeat(2000),
          },
        },
      },
    });

    assert.equal(event.kind, eventType);
    assert.equal(event.role, "assistant");
    assert.equal(event.summary, `Assistant lifecycle event: ${eventType}.`);
    assert.equal(event.preview, undefined);
    assert.doesNotMatch(event.summary || "", /openai-codex-responses|responseId|debug|raw/);
    assert.doesNotMatch(event.preview || "", /openai-codex-responses|responseId|debug|raw/);
    assert.equal(event.payload?.responseId, `resp_${eventType}`);
  }
});

test("PI high-frequency stream deltas are not persisted as runtime session events", () => {
  for (const streamType of ["thinking_delta", "toolcall_delta", "text_delta"]) {
    assert.equal(shouldPersistRuntimeSessionPiEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: streamType,
        contentIndex: 0,
      },
    }), false);
  }

  for (const streamType of ["thinking_start", "thinking_end", "toolcall_start", "toolcall_end", "text_start", "text_end"]) {
    assert.equal(shouldPersistRuntimeSessionPiEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: streamType,
        contentIndex: 0,
      },
    }), true);
  }
});

test("empty DM reply does not accept handoff structured replay", () => {
  assert.equal(shouldRejectEmptyReplyBeforeStructuredReplay({
    reply: "",
    sceneType: "dm_thread",
    replayableStructuredActionCount: 1,
  }), true);
  assert.equal(shouldRejectEmptyReplyBeforeStructuredReplay({
    reply: "",
    sceneType: "dm_thread",
    replayableStructuredActionCount: 0,
  }), true);
  assert.equal(shouldRejectEmptyReplyBeforeStructuredReplay({
    reply: "",
    sceneType: "channel_thread",
    replayableStructuredActionCount: 0,
  }), false);
});
