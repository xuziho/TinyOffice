import { randomUUID } from "node:crypto";

import { resolvePreferredLanguage } from "../language/preferred-language.js";
import type { EmployeeHome } from "../registry/employee-home.js";
import {
  buildPromptInputPackage,
  type PromptInputPackage,
} from "../provider/prompt-input-package.js";
import {
  buildRuntimeSceneTurn,
} from "../orchestration/runtime-scene-turn.js";
import type {
  NaturalLanguageResponse,
  NaturalLanguageResponseInput,
} from "./natural-language-responder-contracts.js";
import { normalizeProviderReplyResult } from "./natural-language-responder-output.js";
import { updateRuntimeSessionCompletionMemory } from "./natural-language-responder-runtime-completion-memory.js";
import { createRuntimeProcessEventDispatcher } from "./natural-language-responder-runtime-process-events.js";
import { NaturalLanguageRuntimeSessionWriter } from "./natural-language-responder-runtime-session-writer.js";
import { createRuntimeTextDeltaEmitter } from "./natural-language-responder-runtime-text-deltas.js";
import { appendRuntimeResponderTrace, nowIso } from "./natural-language-responder-trace.js";
import { defaultRuntimeProvider } from "./pi-runtime-provider.js";

export async function warmNaturalLanguageEmployeeSession(
  employee: EmployeeHome,
): Promise<void> {
  await defaultRuntimeProvider.warm(employee);
}

export async function abortNaturalLanguageEmployeeSessions(
  predicate: (input: { companyId: string; employeeId: string; sessionKey: string }) => boolean,
): Promise<number> {
  return defaultRuntimeProvider.abortWhere(predicate);
}

export async function reloadNaturalLanguageEmployeeSessions(
  predicate: (input: { companyId: string; employeeId: string; sessionKey: string }) => boolean,
): Promise<{
  reloadedCount: number;
  sessionKeys: string[];
}> {
  return defaultRuntimeProvider.reloadWhere(predicate);
}

export async function generateNaturalLanguageEmployeeReply(
  input: NaturalLanguageResponseInput,
): Promise<NaturalLanguageResponse> {
  const runtimeProvider = input.runtimeProvider || defaultRuntimeProvider;
  const repoRoot = input.repoRoot || process.cwd();
  const replyStartedAt = nowIso();
  const runtimeSceneTurn = buildRuntimeSceneTurn({
    employeeId: input.employee.employeeId,
    sessionKey: input.sessionKey,
    turnKey: `${replyStartedAt}:${randomUUID()}`,
  });
  const { emitProcessEvent, waitForProcessEvents } = createRuntimeProcessEventDispatcher({
    employeeId: input.employee.employeeId,
    sessionKey: input.sessionKey,
    onProcessEvent: input.onProcessEvent,
  });
  const runtimeSession = new NaturalLanguageRuntimeSessionWriter({
    responseInput: input,
    repoRoot,
    runtimeSceneTurn,
    replyStartedAt,
    waitForProcessEvents,
  });
  const preferredLanguage = resolvePreferredLanguage({
    explicit: input.preferredLanguage,
    text: input.message,
    env: process.env,
  });
  const textDeltas = createRuntimeTextDeltaEmitter({
    responseInput: input,
    preferredLanguage,
    emitProcessEvent,
    appendModelCallLifecycleEvent: (event) =>
      runtimeSession.appendModelCallLifecycleEvent("model_call_delta", event),
    scheduleRuntimeSessionFlush: () => runtimeSession.scheduleRuntimeSessionFlush(),
  });
  const fallbackPromptInputPackage = buildFallbackPromptInputPackage(input, {
    replyStartedAt,
    turnId: runtimeSession.turnId,
    modelCallId: runtimeSession.modelCallId,
  });

  try {
    runtimeSession.upsertRuntimeSession("running", "Employee reply started.");
    appendPromptContextEvents(input, runtimeSession);
    appendUserMessageEvent(input, runtimeSession);
    runtimeSession.appendModelCallLifecycleEvent("model_call_started", {
      title: "Model call started",
      summary: "Primary model call started.",
      preview: "Primary model call started.",
      payload: {
        activeToolNames: input.activeToolNames || [],
      },
    });
    await runtimeSession.scheduleRuntimeSessionFlush();
    await appendRuntimeResponderTrace({
      phase: "reply.start",
      employeeId: input.employee.employeeId,
      sessionKey: input.sessionKey,
      channelTopicId: input.channelTopicId || null,
      threadId: input.threadId || null,
      reachableMemberIds: input.reachableMemberIds || [],
      reachableParticipants: input.reachableParticipants || [],
      preferredLanguage,
      activeToolNames: input.activeToolNames || null,
    });
    const replyResult = await runtimeProvider.reply({
      employee: input.employee,
      message: input.message,
      sessionKey: input.sessionKey,
      imageInputs: input.imageInputs,
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
      preferredLanguage,
      activeToolNames: input.activeToolNames,
      onTextDelta(delta) {
        textDeltas.appendTextDelta(delta);
      },
      onProviderEvent(event) {
        runtimeSession.updateLatestUsage(event.usage);
        if (event.runtimeSessionEvent) {
          runtimeSession.appendRuntimeSessionEvent(event.runtimeSessionEvent);
          void runtimeSession.scheduleRuntimeSessionFlush();
        }
        if (!input.onProcessEvent) {
          return;
        }
        if (event.processTraceEvents?.some((processEvent) =>
          processEvent.kind === "provider_retry" && processEvent.status === "running"
        )) {
          textDeltas.resetTextDelta();
        }
        for (const processEvent of event.processTraceEvents || []) {
          emitProcessEvent(processEvent);
        }
      },
    });
    const normalizedReply = normalizeProviderReplyResult(replyResult, fallbackPromptInputPackage);
    const promptInputPackage: PromptInputPackage = {
      ...normalizedReply.promptInputPackage,
      turnId: runtimeSession.turnId,
      modelCallId: runtimeSession.modelCallId,
      createdAt: normalizedReply.promptInputPackage.createdAt || replyStartedAt,
    };
    const reply = normalizedReply.message;
    appendPromptInputPackageEvent(runtimeSession, promptInputPackage);
    textDeltas.flushTextDelta(true);
    await waitForProcessEvents();
    await runtimeSession.waitForScheduledFlushes();
    if (!input.allowEmptyReply && !reply.trim()) {
      throw new Error(`Runtime provider returned an empty reply for ${input.employee.employeeId}`);
    }
    runtimeSession.appendModelCallLifecycleEvent("model_call_completed", {
      title: "Model call completed",
      summary: reply.slice(0, 900),
      preview: reply.slice(0, 1200),
      byteSize: Buffer.byteLength(reply, "utf8"),
    });
    runtimeSession.appendRuntimeSessionEvent({
      kind: "assistant_message",
      role: "assistant",
      visibility: "user_visible",
      semanticRole: "assistant_visible_message",
      title: "Assistant reply",
      summary: reply.slice(0, 900),
      preview: reply.slice(0, 1200),
      byteSize: Buffer.byteLength(reply, "utf8"),
    });
    runtimeSession.upsertRuntimeSession("completed", "Employee reply completed.");
    await runtimeSession.flushRuntimeSessionWrites();
    await updateRuntimeSessionCompletionMemory({
      responseInput: input,
      repoRoot,
      sessionRecordId: runtimeSession.sessionRecordId,
    });
    await appendRuntimeResponderTrace({
      phase: "reply.success",
      employeeId: input.employee.employeeId,
      sessionKey: input.sessionKey,
      replyPreview: reply.slice(0, 160),
    });
    const latestUsage = runtimeSession.getLatestUsage();
    return {
      message: reply,
      ...(latestUsage ? { usage: latestUsage } : {}),
    };
  } catch (error) {
    textDeltas.flushTextDelta(true);
    await runtimeSession.waitForScheduledFlushes();
    await appendRuntimeResponderTrace({
      phase: "reply.error",
      employeeId: input.employee.employeeId,
      sessionKey: input.sessionKey,
      error: error instanceof Error ? error.stack || error.message : String(error),
    }).catch(() => undefined);
    runtimeSession.appendModelCallLifecycleEvent("model_call_failed", {
      title: "Model call failed",
      summary: error instanceof Error ? error.message : String(error),
      preview: error instanceof Error ? (error.stack || error.message).slice(0, 1200) : String(error).slice(0, 1200),
      byteSize: Buffer.byteLength(error instanceof Error ? error.message : String(error), "utf8"),
    });
    runtimeSession.appendRuntimeSessionEvent({
      kind: "error",
      visibility: "diagnostic",
      semanticRole: "runtime_error",
      title: "Employee reply failed",
      summary: error instanceof Error ? error.message : String(error),
      preview: error instanceof Error ? (error.stack || error.message).slice(0, 1200) : String(error).slice(0, 1200),
      byteSize: Buffer.byteLength(error instanceof Error ? error.message : String(error), "utf8"),
    });
    runtimeSession.upsertRuntimeSession("failed", error instanceof Error ? error.message : String(error));
    await runtimeSession.flushRuntimeSessionWrites().catch((flushError) =>
      appendRuntimeResponderTrace({
        phase: "reply.session_flush_error",
        employeeId: input.employee.employeeId,
        sessionKey: input.sessionKey,
        error: flushError instanceof Error ? flushError.stack || flushError.message : String(flushError),
      }).catch(() => undefined),
    );
    throw error;
  }
}

function buildFallbackPromptInputPackage(
  input: NaturalLanguageResponseInput,
  runtime: {
    replyStartedAt: string;
    turnId: string;
    modelCallId: string;
  },
) {
  return buildPromptInputPackage({
    employee: input.employee,
    sessionKey: input.sessionKey,
    turnId: runtime.turnId,
    modelCallId: runtime.modelCallId,
    createdAt: runtime.replyStartedAt,
    message: input.message,
    userPrompt: `User Message:\n${input.message}`,
    systemPromptAppend: [
      `Employee id: ${input.employee.employeeId}`,
      `Employee role: ${input.employee.profile.role}`,
    ].join("\n"),
    requesterUsername: input.requesterUsername,
    threadId: input.threadId,
    roomId: input.roomId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    chatEntryId: input.chatEntryId,
    channelTopicId: input.channelTopicId,
    reachableParticipants: input.reachableParticipants,
    contextBlocks: input.contextBlocks,
    activeToolNames: input.activeToolNames,
  });
}

function appendPromptContextEvents(
  input: NaturalLanguageResponseInput,
  runtimeSession: NaturalLanguageRuntimeSessionWriter,
) {
  for (const block of input.contextBlocks || []) {
    runtimeSession.appendRuntimeSessionEvent({
      kind: "prompt_context",
      source: block.source,
      visibility: "prompt_context",
      semanticRole: block.role,
      rawEventKind: "prompt_context",
      title: block.label,
      summary: block.text.slice(0, 900),
      preview: block.text.slice(0, 1200),
      payload: {
        sessionKey: input.sessionKey,
        sceneId: runtimeSession.sceneId,
        turnId: runtimeSession.turnId,
        runId: runtimeSession.runId,
        modelCallId: runtimeSession.modelCallId,
        label: block.label,
        source: block.source,
        metadata: block.metadata,
      },
      byteSize: Buffer.byteLength(block.text, "utf8"),
    });
  }
}

function appendUserMessageEvent(
  input: NaturalLanguageResponseInput,
  runtimeSession: NaturalLanguageRuntimeSessionWriter,
) {
  runtimeSession.appendRuntimeSessionEvent({
    kind: "user_message",
    role: "user",
    source: input.userMessageSource || "tinyoffice.chat.user_message",
    visibility: "user_visible",
    semanticRole: "user_message",
    rawEventKind: "user_message",
    title: "User prompt",
    summary: input.message.slice(0, 900),
    preview: input.message.slice(0, 1200),
    payload: {
      sessionKey: input.sessionKey,
      sceneId: runtimeSession.sceneId,
      turnId: runtimeSession.turnId,
      runId: runtimeSession.runId,
      modelCallId: runtimeSession.modelCallId,
      imageInputs: input.imageInputs || [],
      channelTopicId: input.channelTopicId,
      threadId: input.threadId,
      roomId: input.roomId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      chatEntryId: input.chatEntryId,
      requesterUsername: input.requesterUsername,
      ...(input.userMessagePayload || {}),
    },
    byteSize: Buffer.byteLength(input.message, "utf8"),
  });
}

function appendPromptInputPackageEvent(
  runtimeSession: NaturalLanguageRuntimeSessionWriter,
  promptInputPackage: PromptInputPackage,
) {
  runtimeSession.appendRuntimeSessionEvent({
    kind: "prompt_input_package",
    role: "user",
    source: "tinyoffice.prompt_input_package",
    visibility: "model_input",
    semanticRole: "prompt_input_package",
    rawEventKind: "prompt_input_package",
    title: "Sent to AI",
    summary: promptInputPackage.runtimePrompt.userPrompt.slice(0, 900),
    preview: promptInputPackage.runtimePrompt.userPrompt.slice(0, 1200),
    payload: promptInputPackage as unknown as Record<string, unknown>,
    byteSize: Buffer.byteLength(JSON.stringify(promptInputPackage), "utf8"),
  });
}
