import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

import { resolvePreferredLanguage } from "../language/preferred-language.js";
import {
  PersistentPiEmployeeAgentPool,
} from "../pi/persistent-pi-employee-agent-pool.js";
import {
  toBashShellPath,
} from "../pi/persistent-pi-employee-agent.js";
import type {
  ProcessTraceEventDraft,
  RuntimeProvider,
  RuntimeProviderEvent,
  RuntimeProviderReplyRequest,
  RuntimeTokenUsage,
} from "./contracts.js";
import { appendPiProviderTrace, preparePiPromptImages } from "./pi-runtime-provider-io.js";
export { appendPiProviderTrace, preparePiPromptImages } from "./pi-runtime-provider-io.js";
import {
  loadPiModelState,
  runtimeModelSupportsImageInput,
} from "../company-config/employees-admin.js";

function nowIso() {
  return new Date().toISOString();
}

function tinyOfficeApiBaseUrl(): string {
  return (
    process.env.TINYOFFICE_API_BASE_URL?.trim() ||
    process.env.TINYOFFICE_RUNTIME_ORIGIN?.trim() ||
    "http://127.0.0.1:8095"
  );
}

const piProviderPool = new PersistentPiEmployeeAgentPool({
  sessionRootPath: path.resolve(process.cwd(), ".data", "pi-sessions"),
  resolveSessionRootPath(employee) {
    return path.join(employee.workspacePath, ".scratch", "pi-sessions");
  },
  buildEnv(employee) {
    return {
      PI_EMPLOYEE_ID: employee.employeeId,
      PI_EMPLOYEE_ROLE: employee.profile.role,
      PI_WORKSPACE_PATH: employee.workspacePath,
      PI_WORKSPACE_SHELL_PATH: toBashShellPath(employee.workspacePath),
      TASK_REPO_ROOT: process.cwd(),
      TASK_REPO_ROOT_SHELL_PATH: toBashShellPath(process.cwd()),
      TINYOFFICE_COMPANY_ID: employee.companyId,
      TINYOFFICE_API_BASE_URL: tinyOfficeApiBaseUrl(),
    };
  },
});

export class PiRuntimeProvider implements RuntimeProvider {
  readonly providerId = "pi";

  async warm(employee: RuntimeProviderReplyRequest["employee"]): Promise<void> {
    const agent = piProviderPool.getOrCreate(employee, "warmup");
    await appendPiProviderTrace({
      phase: "warm.start",
      employeeId: employee.employeeId,
    });
    await agent.start();
    await appendPiProviderTrace({
      phase: "warm.ready",
      employeeId: employee.employeeId,
    });
  }

  async reply(input: RuntimeProviderReplyRequest) {
    const agent = piProviderPool.getOrCreate(input.employee, input.sessionKey);
    if (input.imageInputs?.length) {
      const modelState = await loadPiModelState();
      if (!runtimeModelSupportsImageInput({
        runtime: input.employee.runtime,
        availableModels: modelState.availableModels,
      })) {
        throw new Error(`Employee ${input.employee.employeeId} cannot inspect images with model ${input.employee.runtime?.modelProvider || "unknown"}/${input.employee.runtime?.modelId || "unknown"}. Select a model with image input support before sending image attachments.`);
      }
    }
    const imageInputs = await preparePiPromptImages(input.imageInputs);
    const emittedSessionEventKeys = new Set<string>();
    const replyStartedAt = nowIso();
    let transcriptPollInterval: NodeJS.Timeout | undefined;
    let transcriptPollRunning = false;

    const emitProviderEvent = (event: RuntimeProviderEvent) => input.onProviderEvent?.(event);
    const emitProcessEvents = (events: ProcessTraceEventDraft[]) => {
      for (const processEvent of events) {
        const eventKey = getSessionProcessEventKey(processEvent);
        if (eventKey && emittedSessionEventKeys.has(eventKey)) {
          continue;
        }
        if (eventKey) {
          emittedSessionEventKeys.add(eventKey);
        }
        emitProviderEvent({
          provider: this.providerId,
          processTraceEvents: [processEvent],
        });
      }
    };
    const pollTranscriptEvents = async () => {
      if (!input.onProviderEvent || transcriptPollRunning) {
        return;
      }
      transcriptPollRunning = true;
      try {
        await emitTranscriptBackfillEvents({
          input,
          sinceIso: replyStartedAt,
          emitProcessEvents,
        });
      } finally {
        transcriptPollRunning = false;
      }
    };

    await appendPiProviderTrace({
      phase: "reply.start",
      employeeId: input.employee.employeeId,
      sessionKey: input.sessionKey,
      channelTopicId: input.channelTopicId || null,
      threadId: input.threadId || null,
      reachableMemberIds: input.reachableMemberIds || [],
      reachableParticipants: input.reachableParticipants || [],
      preferredLanguage: input.preferredLanguage,
      activeToolNames: input.activeToolNames || null,
      imageInputCount: imageInputs.length,
    });

    try {
      transcriptPollInterval = setInterval(() => {
        void pollTranscriptEvents().catch((error) => {
          void appendPiProviderTrace({
            phase: "reply.transcript_poll_error",
            employeeId: input.employee.employeeId,
            sessionKey: input.sessionKey,
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
        });
      }, 750);

      const reply = await agent.reply({
        message: input.message,
        sessionKey: input.sessionKey,
        imageInputs,
        channelTopicId: input.channelTopicId,
        threadId: input.threadId,
        roomId: input.roomId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        chatEntryId: input.chatEntryId,
        actorMemberId: input.actorMemberId,
        reachableMemberIds: input.reachableMemberIds,
        reachableParticipants: input.reachableParticipants,
        contextBlocks: input.contextBlocks,
        requesterUsername: input.requesterUsername,
        preferredLanguage: input.preferredLanguage,
        activeToolNames: input.activeToolNames,
        onTextDelta: input.onTextDelta,
        onSessionEvent: (event) => {
          emitProviderEvent(normalizePiProviderEvent(input, event));
        },
      });

      if (transcriptPollInterval) {
        clearInterval(transcriptPollInterval);
        transcriptPollInterval = undefined;
      }
      await pollTranscriptEvents();
      await appendPiProviderTrace({
        phase: "reply.success",
        employeeId: input.employee.employeeId,
        sessionKey: input.sessionKey,
        replyPreview: reply.message.slice(0, 160),
      });
      return reply;
    } catch (error) {
      if (transcriptPollInterval) {
        clearInterval(transcriptPollInterval);
      }
      await appendPiProviderTrace({
        phase: "reply.error",
        employeeId: input.employee.employeeId,
        sessionKey: input.sessionKey,
        error: error instanceof Error ? error.stack || error.message : String(error),
      }).catch(() => undefined);
      throw error;
    }
  }

  abortWhere(predicate: (input: { companyId: string; employeeId: string; sessionKey: string }) => boolean): Promise<number> {
    return piProviderPool.abortWhere((status) =>
      predicate({ companyId: status.companyId, employeeId: status.employeeId, sessionKey: status.sessionKey })
    );
  }

  reloadWhere(predicate: (input: { companyId: string; employeeId: string; sessionKey: string }) => boolean) {
    return piProviderPool.reloadWhere((status) =>
      predicate({ companyId: status.companyId, employeeId: status.employeeId, sessionKey: status.sessionKey })
    );
  }
}

export const defaultRuntimeProvider = new PiRuntimeProvider();

export function normalizePiProviderEvent(
  input: RuntimeProviderReplyRequest,
  event: unknown,
): RuntimeProviderEvent {
  return {
    provider: "pi",
    rawEvent: event,
    usage: extractUsageFromPiSessionEvent(event),
    runtimeSessionEvent: shouldPersistRuntimeSessionPiEvent(event)
      ? runtimeSessionEventFromPiEvent(event)
      : undefined,
    processTraceEvents: buildProcessEventsFromPiSessionEvent(input, event),
  };
}

export function extractUsageFromPiSessionEvent(event: unknown): RuntimeTokenUsage | undefined {
  const usage = event && typeof event === "object"
    ? (event as { message?: { usage?: unknown } }).message?.usage
    : undefined;
  return normalizeUsage(usage);
}

function normalizeUsage(usage: unknown): RuntimeTokenUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const record = usage as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    totalTokens?: unknown;
    cost?: {
      total?: unknown;
    };
  };
  const normalized: RuntimeTokenUsage = {
    input: numberFrom(record.input),
    output: numberFrom(record.output),
    cacheRead: numberFrom(record.cacheRead),
    cacheWrite: numberFrom(record.cacheWrite),
    totalTokens: numberFrom(record.totalTokens),
    cost: {
      total: numberFrom(record.cost?.total),
    },
  };

  return normalized.input !== undefined ||
    normalized.output !== undefined ||
    normalized.cacheRead !== undefined ||
    normalized.cacheWrite !== undefined ||
    normalized.totalTokens !== undefined
    ? normalized
    : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function runtimeSessionEventFromPiEvent(event: unknown) {
  const payload = sanitizeRuntimeSessionPayload(event);
  const record = event && typeof event === "object" ? event as {
    type?: string;
    id?: string;
    message?: {
      role?: string;
      content?: unknown;
      toolName?: string;
      isError?: boolean;
    };
    assistantMessageEvent?: {
      type?: string;
      contentIndex?: number;
    };
  } : {};
  const role = record.message?.role;
  const eventType = record.type || "unknown";
  const contentText = extractTextFromContent(getRuntimeSessionContentItems(record.message?.content));
  const streamType = record.assistantMessageEvent?.type;
  const title = streamType
    ? `PI ${eventType} ${streamType}`
    : role
      ? `PI ${role} ${eventType}`
      : `PI ${eventType}`;
  const summary = buildRuntimeSessionEventSummary({
    eventType,
    streamType,
    role,
    contentText,
    payload,
  });
  const preview = contentText || (
    eventType === "message_update" || isProviderLifecycleSessionEvent(eventType)
    ? undefined
    : JSON.stringify(payload).slice(0, 1200)
  );
  const payloadJson = JSON.stringify(payload);
  return {
    kind: eventType === "message_update" ? "stream_event" : eventType,
    role,
    rawEventKind: eventType,
    title,
    summary,
    preview: preview?.slice(0, 1200),
    payload,
    byteSize: Buffer.byteLength(payloadJson, "utf8"),
    truncated: payloadJson.length > 1200,
  };
}

export function shouldPersistRuntimeSessionPiEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") {
    return true;
  }
  const record = event as {
    type?: string;
    assistantMessageEvent?: {
      type?: string;
    };
  };
  if (record.type !== "message_update") {
    return true;
  }
  return !["thinking_delta", "toolcall_delta", "text_delta"].includes(
    record.assistantMessageEvent?.type || "",
  );
}

function sanitizeRuntimeSessionPayload(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return { value };
  }
  if (depth > 4) {
    return { truncated: true };
  }
  if (Array.isArray(value)) {
    return {
      items: value.slice(0, 25).map((item) =>
        typeof item === "object" && item !== null
          ? sanitizeRuntimeSessionPayload(item, depth + 1)
          : sanitizeRuntimeSessionScalar(item)
      ),
      truncated: value.length > 25,
    };
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 60)) {
    if (/token|secret|password|api[_-]?key|authorization/i.test(key)) {
      output[key] = "<redacted>";
      continue;
    }
    if (item && typeof item === "object") {
      output[key] = sanitizeRuntimeSessionPayload(item, depth + 1);
      continue;
    }
    output[key] = sanitizeRuntimeSessionScalar(item);
  }
  if (Object.keys(value).length > 60) {
    output.truncated = true;
  }
  return output;
}

function sanitizeRuntimeSessionScalar(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer <redacted>")
    .slice(0, 2000);
}

function buildBaseProcessTraceEvent(input: RuntimeProviderReplyRequest) {
  return {
    sessionKey: input.sessionKey,
    channelTopicId: input.channelTopicId,
    employeeId: input.employee.employeeId,
  };
}

function prefersChinese(input: RuntimeProviderReplyRequest) {
  return resolvePreferredLanguage({
    explicit: input.preferredLanguage,
    text: input.message,
    env: process.env,
  }).toLowerCase().startsWith("zh");
}

function localized(input: RuntimeProviderReplyRequest, text: { zh: string; en: string }) {
  return prefersChinese(input) ? text.zh : text.en;
}

export function buildProcessEventsFromPiSessionEvent(
  input: RuntimeProviderReplyRequest,
  event: unknown,
): ProcessTraceEventDraft[] {
  if (!event || typeof event !== "object") {
    return [];
  }

  const record = event as {
    type?: string;
    id?: string;
    timestamp?: string;
    attempt?: number;
    maxAttempts?: number;
    delayMs?: number;
    errorMessage?: string;
    success?: boolean;
    finalError?: string;
    message?: {
      role?: string;
      content?: unknown[];
      isError?: boolean;
      toolName?: string;
    };
    assistantMessageEvent?: {
      type?: string;
      contentIndex?: number;
      delta?: string;
      content?: string;
      toolCall?: {
        name?: string;
        arguments?: unknown;
      };
      reason?: string;
    };
  };

  if (record.type === "auto_retry_start" || record.type === "auto_retry_end") {
    const base = buildBaseProcessTraceEvent(input);
    const started = record.type === "auto_retry_start";
    return [{
      ...base,
      kind: "provider_retry",
      title: started ? "Provider retry scheduled" : record.success ? "Provider retry succeeded" : "Provider retry failed",
      summary: record.errorMessage || record.finalError || (started ? "A transient provider error will be retried." : undefined),
      status: started ? "running" : record.success ? "succeeded" : "failed",
      timestamp: record.timestamp,
      metadata: {
        attempt: record.attempt,
        maxAttempts: record.maxAttempts,
        delayMs: record.delayMs,
        errorMessage: record.errorMessage,
        finalError: record.finalError,
      },
    }];
  }

  if (record.type === "message_update") {
    return buildProcessEventsFromAssistantMessageUpdate(input, record);
  }

  if (record.type !== "message" || !record.message) {
    return [];
  }

  const base = buildBaseProcessTraceEvent(input);
  const role = record.message.role;
  const content = Array.isArray(record.message.content)
    ? record.message.content
    : [];

  if (role === "assistant") {
    const events: ProcessTraceEventDraft[] = [];
    content.forEach((item, contentIndex) => {
      if (!item || typeof item !== "object") {
        return;
      }
      const candidate = item as {
        type?: string;
        text?: string;
        thinking?: string;
        name?: string;
        arguments?: unknown;
      };

      if (candidate.type === "thinking") {
        return;
      }

      if (candidate.type === "toolCall" && candidate.name) {
        const activity = formatToolActivity(candidate.name, candidate.arguments, input);
        events.push({
          ...base,
          timestamp: record.timestamp,
          kind: "tool_activity",
          title: activity.title,
          summary: activity.summary,
          status: "running",
          metadata: {
            sessionRecordId: record.id,
            contentIndex,
            toolName: candidate.name,
            activityKind: activity.activityKind,
            activityTarget: activity.activityTarget,
          },
        });

        events.push({
          ...base,
          timestamp: record.timestamp,
          kind: "model_tool_call",
          title: `${input.employee.employeeId} called ${candidate.name}`,
          summary: summarizeToolArguments(candidate.arguments, input),
          status: "running",
          metadata: {
            sessionRecordId: record.id,
            contentIndex,
            toolName: candidate.name,
            arguments: candidate.arguments ?? {},
          },
        });
        return;
      }

      if (candidate.type === "text" && candidate.text?.trim()) {
        events.push({
          ...base,
          timestamp: record.timestamp,
          kind: "model_reply_observed",
          title: localized(input, {
            zh: `${input.employee.employeeId} drafted a reply`,
            en: `${input.employee.employeeId} drafted a reply`,
          }),
          preview: candidate.text.trim().slice(0, 800),
          status: "succeeded",
          metadata: {
            sessionRecordId: record.id,
            contentIndex,
          },
        });
      }
    });
    return events;
  }

  if (role === "toolResult") {
    const toolName = record.message.toolName || "tool";
    const text = extractTextFromContent(content);
    return [{
      ...base,
      timestamp: record.timestamp,
      kind: "model_tool_result",
      title: localized(input, {
        zh: `${toolName} returned a result`,
        en: `${toolName} returned a result`,
      }),
      summary: text ? text.slice(0, 900) : localized(input, {
        zh: "The tool returned no text output.",
        en: "The tool returned no text output.",
      }),
      status: record.message.isError ? "failed" : "succeeded",
      metadata: {
        sessionRecordId: record.id,
        contentIndex: 0,
        toolName,
      },
    }];
  }

  return [];
}

export const buildProcessEventsFromSessionEvent = buildProcessEventsFromPiSessionEvent;

function buildProcessEventsFromAssistantMessageUpdate(
  input: RuntimeProviderReplyRequest,
  record: {
    type?: string;
    message?: {
      role?: string;
      content?: unknown[];
    };
    assistantMessageEvent?: {
      type?: string;
      contentIndex?: number;
      delta?: string;
      content?: string;
      toolCall?: {
        name?: string;
        arguments?: unknown;
      };
      reason?: string;
    };
  },
): ProcessTraceEventDraft[] {
  const assistantEvent = record.assistantMessageEvent;
  if (!assistantEvent?.type) {
    return [];
  }

  const contentIndex = typeof assistantEvent.contentIndex === "number"
    ? assistantEvent.contentIndex
    : 0;
  const streamEventKey = `stream:${assistantEvent.type}:${contentIndex}`;
  const logicalThinkingKey = `stream:thinking:${contentIndex}`;
  const base = buildBaseProcessTraceEvent(input);

  if (
    assistantEvent.type === "thinking_start" ||
    assistantEvent.type === "thinking_delta" ||
    assistantEvent.type === "thinking_end"
  ) {
    const isEnd = assistantEvent.type === "thinking_end";
    const thinkingText = isEnd
      ? firstString(
          assistantEvent.content,
          thinkingTextFromContent(record.message?.content, contentIndex),
        )
      : "";
    if (!thinkingText) {
      return [];
    }
    return [{
      ...base,
      kind: "model_reasoning_observed",
      title: `${input.employee.employeeId} prepared its approach`,
      summary: thinkingText,
      status: isEnd ? "succeeded" : "running",
      metadata: {
        contentIndex,
        streamEventType: assistantEvent.type,
        streamEventKey: logicalThinkingKey,
        streamEventEmissionKey: `${logicalThinkingKey}:end`,
        sourceEventFamily: "pi_thinking",
      },
    }];
  }

  if (
    assistantEvent.type !== "toolcall_start" &&
    assistantEvent.type !== "toolcall_end"
  ) {
    return [];
  }

  const toolCall = getStreamingToolCall(record, contentIndex);
  const toolName = toolCall.name || "tool";
  const toolArguments = toolCall.arguments ?? {};
  const activity = formatToolActivity(toolName, toolArguments, input);
  const status = assistantEvent.type === "toolcall_end" ? "succeeded" : "running";

  return [
    {
      ...base,
      kind: "tool_activity",
      title: activity.title || `Prepared ${toolName}`,
      summary: activity.summary,
      status,
      metadata: {
        contentIndex,
        toolName,
        activityKind: activity.activityKind,
        activityTarget: activity.activityTarget,
        streamEventType: assistantEvent.type,
        streamEventKey: `${streamEventKey}:activity`,
      },
    },
    {
      ...base,
      kind: "model_tool_call",
      title: `${input.employee.employeeId} called ${toolName}`,
      summary: summarizeToolArguments(toolArguments, input),
      status,
      metadata: {
        contentIndex,
        toolName,
        arguments: toolArguments,
        streamEventType: assistantEvent.type,
        streamEventKey: `${streamEventKey}:call`,
      },
    },
  ];
}

function getStreamingToolCall(
  record: {
    message?: {
      content?: unknown[];
    };
    assistantMessageEvent?: {
      toolCall?: {
        name?: string;
        arguments?: unknown;
      };
    };
  },
  contentIndex: number,
) {
  const content = Array.isArray(record.message?.content) ? record.message.content : [];
  const contentItem = content[contentIndex];
  if (contentItem && typeof contentItem === "object") {
    const candidate = contentItem as {
      type?: string;
      name?: string;
      arguments?: unknown;
    };
    if (candidate.type === "toolCall" && candidate.name) {
      return {
        name: candidate.name,
        arguments: candidate.arguments,
      };
    }
  }

  return {
    name: record.assistantMessageEvent?.toolCall?.name,
    arguments: record.assistantMessageEvent?.toolCall?.arguments,
  };
}

async function emitTranscriptBackfillEvents(input: {
  input: RuntimeProviderReplyRequest;
  sinceIso: string;
  emitProcessEvents: (events: ProcessTraceEventDraft[]) => void;
}) {
  if (!input.input.onProviderEvent) {
    return;
  }

  const sessionDir = getEmployeeSessionDir(input.input);
  const transcriptFiles = await readdir(sessionDir)
    .then((entries) =>
      entries
        .filter((entry) => entry.endsWith(".jsonl"))
        .sort()
        .map((entry) => path.join(sessionDir, entry)),
    )
    .catch(() => []);

  for (const transcriptFile of transcriptFiles) {
    const raw = await readFile(transcriptFile, "utf8").catch(() => "");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let record: unknown;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const timestamp = typeof (record as { timestamp?: unknown }).timestamp === "string"
        ? (record as { timestamp: string }).timestamp
        : "";
      if (timestamp && timestamp < input.sinceIso) {
        continue;
      }

      input.emitProcessEvents(buildProcessEventsFromPiSessionEvent(input.input, record));
    }
  }
}

function getEmployeeSessionDir(input: RuntimeProviderReplyRequest) {
  return path.join(
    input.employee.workspacePath,
    ".scratch",
    "pi-sessions",
    input.employee.employeeId,
    input.sessionKey.replace(/[^a-zA-Z0-9._-]+/g, "_"),
  );
}

function getSessionProcessEventKey(event: ProcessTraceEventDraft) {
  const streamEventEmissionKey = event.metadata?.streamEventEmissionKey;
  if (typeof streamEventEmissionKey === "string") {
    return [
      event.sessionKey,
      event.employeeId ?? "",
      event.kind,
      streamEventEmissionKey,
    ].join(":");
  }

  const streamEventKey = event.metadata?.streamEventKey;
  if (typeof streamEventKey === "string") {
    return [
      event.sessionKey,
      event.employeeId ?? "",
      event.kind,
      streamEventKey,
    ].join(":");
  }

  const sessionRecordId = event.metadata?.sessionRecordId;
  if (typeof sessionRecordId !== "string") {
    return "";
  }
  return [
    event.sessionKey,
    sessionRecordId,
    event.kind,
    String(event.metadata?.contentIndex ?? ""),
  ].join(":");
}

function thinkingTextFromContent(content: unknown[] | undefined, contentIndex: number) {
  const item = content?.[contentIndex];
  if (!item || typeof item !== "object") {
    return "";
  }
  const candidate = item as {
    type?: string;
    thinking?: string;
  };
  return candidate.type === "thinking" ? candidate.thinking?.trim() || "" : "";
}

function summarizeToolArguments(value: unknown, input: RuntimeProviderReplyRequest) {
  if (value === undefined || value === null) {
    return localized(input, {
      zh: "No arguments.",
      en: "No arguments.",
    });
  }
  try {
    return JSON.stringify(value).slice(0, 900);
  } catch {
    return String(value).slice(0, 900);
  }
}

function formatToolActivity(toolName: string, value: unknown, input: RuntimeProviderReplyRequest) {
  const args = isRecord(value) ? value : {};
  const zh = prefersChinese(input);
  const pathValue = firstString(args.path, args.filePath);
  const commandValue = firstString(args.cmd, args.command);
  const patternValue = firstString(args.pattern, args.query);
  const recipient = firstString(args.toId, args.recipient);

  if (toolName === "read") {
    const label = formatPathLabel(pathValue);
    return {
      title: label ? `Read ${label}` : "Read a file",
      activityKind: "read",
      activityTarget: label,
    };
  }

  if (toolName === "ls") {
    const label = formatPathLabel(pathValue);
    return {
      title: label ? `Listed ${label}` : "Listed files",
      activityKind: "list",
      activityTarget: label,
    };
  }

  if (toolName === "grep" || toolName === "find" || toolName === "websearch") {
    const pattern = patternValue || (toolName === "websearch" ? firstString(args.q) : "");
    const target = formatPathLabel(pathValue);
    const title = pattern
      ? `Searched "${truncateInline(pattern, 40)}"${target ? ` in ${target}` : ""}`
      : "Searched content";
    return {
      title,
      activityKind: "search",
      activityTarget: target || pattern,
    };
  }

  if (toolName === "bash") {
    const command = commandValue ? truncateInline(commandValue, 120) : "";
    return {
      title: command ? `Ran ${command}` : "Ran a command",
      activityKind: "command",
      activityTarget: command,
    };
  }

  if (toolName === "edit") {
    const label = formatPathLabel(pathValue);
    return {
      title: label ? `Edited ${label}` : "Edited a file",
      activityKind: "edit",
      activityTarget: label,
    };
  }

  if (toolName === "write") {
    const label = formatPathLabel(pathValue);
    return {
      title: label ? `Write ${label}` : "Write a file",
      activityKind: "write",
      activityTarget: label,
    };
  }

  if (toolName === "handoff_topic_turn") {
    const target = recipient ? formatParticipantLabel(recipient) : "";
    return {
      title: `Handed off topic${target ? ` to ${target}` : ""}`,
      activityKind: "topic_handoff",
      activityTarget: target,
    };
  }

  if (toolName === "finish_work_turn") {
    const status = firstString(args.status);
    return {
      title: `Finished WorkRun${status ? `: ${status}` : ""}`,
      summary: firstString(args.summary, args.reason),
      activityKind: "finish_work_turn",
      activityTarget: status,
    };
  }


  if (toolName === "finish_intake_turn") {
    const outcome = firstString(args.outcome);
    const title = firstString(args.title);
    const ownerMemberId = firstString(args.ownerMemberId);
    const target = ownerMemberId ? formatParticipantLabel(ownerMemberId) : "";
    return {
      title: title
        ? `Finished intake${target ? ` for ${target}` : ""}: ${truncateInline(title, 80)}`
        : `Finished intake${target ? ` for ${target}` : ""}`,
      summary: firstString(args.summary, args.reason, args.description),
      activityKind: "intake_turn_result",
      activityTarget: target || outcome,
    };
  }

  return {
    title: `Used ${toolName}`,
    activityKind: "tool",
    activityTarget: toolName,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function formatPathLabel(value: string) {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalized.endsWith("/TinyOffice") || normalized === "TinyOffice") {
    return "repository root";
  }
  const repoMarker = "/TinyOffice/";
  const repoIndex = normalized.indexOf(repoMarker);
  if (repoIndex >= 0) {
    return normalized.slice(repoIndex + repoMarker.length) || "repository root";
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || normalized;
}

function formatParticipantLabel(value: string) {
  if (!value) {
    return "";
  }
  return value
    .split("-")
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function truncateInline(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

function buildRuntimeSessionEventSummary(input: {
  eventType: string;
  streamType?: string;
  role?: string;
  contentText: string;
  payload: Record<string, unknown>;
}) {
  if (input.contentText) {
    return input.contentText.slice(0, 900);
  }
  if (input.eventType === "message_update") {
    const roleLabel = input.role === "assistant" ? "Assistant" : "Model";
    if (input.streamType) {
      return roleLabel + " stream update: " + input.streamType + ".";
    }
    return roleLabel + " stream update.";
  }
  if (isProviderLifecycleSessionEvent(input.eventType)) {
    const roleLabel = input.role === "assistant" ? "Assistant" : "Model";
    return roleLabel + " lifecycle event: " + input.eventType + ".";
  }
  return JSON.stringify(input.payload).slice(0, 900);
}

function isProviderLifecycleSessionEvent(eventType: string) {
  return [
    "agent_start",
    "turn_start",
    "message_start",
    "message_end",
    "turn_end",
    "agent_end",
    "tool_execution_start",
    "tool_execution_end",
    "auto_retry_start",
    "auto_retry_end",
  ].includes(eventType);
}

function getRuntimeSessionContentItems(content: unknown): unknown[] {
  if (Array.isArray(content)) {
    return content;
  }
  if (!content || typeof content !== "object") {
    return [];
  }
  const candidate = content as { items?: unknown[] };
  return Array.isArray(candidate.items) ? candidate.items : [];
}

function extractTextFromContent(content: unknown[]) {
  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const candidate = item as { type?: string; text?: string; content?: string };
      if (candidate.type === "thinking") {
        return "";
      }
      return candidate.text || candidate.content || "";
    })
    .filter((value) => value.trim())
    .join("\n");
}
