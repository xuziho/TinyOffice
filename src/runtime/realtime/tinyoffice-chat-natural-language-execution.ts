import { assertNoForbiddenPublicCarrierFields } from "../../collaboration/contracts/conversation-message-contract.js";
import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import type { EmployeeHome } from "../registry/employee-home.js";
import {
  generateNaturalLanguageEmployeeReply,
  reloadNaturalLanguageEmployeeSessions,
  type NaturalLanguageResponse,
  type NaturalLanguageResponseInput,
  type ProcessTraceEventDraft,
  type RuntimeSessionPersistResult,
} from "../provider/natural-language-responder.js";
import { consumeDeferredRuntimeReloads } from "../capabilities/deferred-runtime-reload.js";
import {
  buildChatTurnActiveToolNames,
  resolveChatTurnStateAction,
  type ChatAssistantOutput,
  type ChatTurnStateAction,
} from "./chat-turn-state-action.js";
import {
  buildTinyOfficeChatTurnDispatchEventKey,
  type TinyOfficeChatTurnDispatchReady,
} from "./tinyoffice-chat-dispatch-decision.js";
import {
  formatTinyOfficeChatTopicContextForExecution,
  type TinyOfficeChatRoomContext,
} from "./tinyoffice-chat-room-context.js";
import {
  finalOutputReachableParticipants,
  finalOutputSceneTypeFromChatScene,
} from "./tinyoffice-chat-turn-utils.js";

export interface TinyOfficeChatNaturalLanguageExecutionInput {
  context: TinyOfficeChatRoomContext;
  employee: EmployeeHome;
  repoRoot?: string;
  runtimeProvider?: NaturalLanguageResponseInput["runtimeProvider"];
  runtimeSessionRepository?: NaturalLanguageResponseInput["runtimeSessionRepository"];
  allowEmptyReply?: boolean;
  onProcessEvent?: NaturalLanguageResponseInput["onProcessEvent"];
  onRuntimeSessionPersisted?: (input: RuntimeSessionPersistResult) => void | Promise<void>;
}

export interface TinyOfficeChatNaturalLanguageExecutionResult {
  kind: "executed";
  executionState: "natural_language_reply_ready";
  companyId: string;
  roomId: string;
  conversationId: string;
  entryId?: string;
  messageId: string;
  employeeId: string;
  actorMemberId?: string;
  targetMemberId: string;
  sessionKey: string;
  inheritedImageMessageIds?: string[];
  runtimeEvidence?: {
    sessionRecordId: string;
    appendedEventCount: number;
    processTraceId?: string;
    processTraceLabel?: string;
  };
  chatOutput: ChatAssistantOutput;
  stateAction?: ChatTurnStateAction;
  response: NaturalLanguageResponse;
}

export function buildNaturalLanguageInputFromTinyOfficeChatRoomContext(
  input: TinyOfficeChatNaturalLanguageExecutionInput,
): NaturalLanguageResponseInput {
  const context = input.context;
  assertNoForbiddenPublicCarrierFields(context);
  if (input.employee.companyId !== context.companyId) {
    throw new Error("Owned Chat execution employee companyId mismatch");
  }
  if (input.employee.employeeId !== context.targetMemberId) {
    throw new Error("Owned Chat execution employeeId must match targetMemberId");
  }
  const currentMessage = context.currentMessage ||
    context.recentMessages.find((message) => message.messageId === context.messageId);
  if (!currentMessage) {
    throw new Error(`Owned Chat execution current message not found: ${context.messageId}`);
  }
  const imageInputMessageIds = new Set(context.imageInputMessageIds);
  const imageAttachments = context.recentMessages
    .filter((message) => imageInputMessageIds.has(message.messageId))
    .flatMap((message) => message.imageAttachments);
  const sceneType = finalOutputSceneTypeFromChatScene(context.sceneType);
  const contextBlocks: NonNullable<NaturalLanguageResponseInput["contextBlocks"]> = sceneType === "channel"
    ? [{
        role: "channel_thread_context",
        source: "tinyoffice.chat_topic_context",
        label: "Topic context",
        text: formatTinyOfficeChatTopicContextForExecution(context),
        metadata: {
          kind: "chat_topic_context_window",
          mode: context.topicContextWindow.mode,
          messageCount: context.topicContextWindow.messages.length,
          ...(context.topicContextWindow.cursor
            ? {
                cursorMessageId: context.topicContextWindow.cursor.messageId,
                cursorCreatedAt: context.topicContextWindow.cursor.createdAt,
              }
            : {}),
          ...(context.topicContextWindow.lastMessageId
            ? {
                lastMessageId: context.topicContextWindow.lastMessageId,
                lastCreatedAt: context.topicContextWindow.lastCreatedAt,
              }
            : {}),
        },
      }]
    : [];
  const userMessagePayload = {
    companyId: context.companyId,
    roomId: context.roomId,
    conversationId: context.conversationId,
    ...(context.entryId ? { entryId: context.entryId } : {}),
    messageId: context.messageId,
    actorMemberId: context.actorMemberId,
    targetMemberId: context.targetMemberId,
    source: context.source,
    reason: context.reason,
    sceneType: context.sceneType,
    sessionKey: context.sessionKey,
  };
  assertNoForbiddenPublicCarrierFields(userMessagePayload);

  const responseInput: NaturalLanguageResponseInput = {
    employee: input.employee,
    message: currentMessage.body,
    sessionKey: context.sessionKey,
    threadId: context.conversationId,
    roomId: context.roomId,
    conversationId: context.conversationId,
    messageId: context.messageId,
    ...(context.entryId ? { chatEntryId: context.entryId } : {}),
    imageInputs: imageAttachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      byteLength: attachment.byteLength,
      previewUrl: attachment.previewUrl,
      downloadUrl: attachment.downloadUrl,
      storageKey: attachment.storageKey,
      contentSha256: attachment.contentSha256,
    })),
    actorMemberId: context.actorMemberId,
    reachableMemberIds: sceneType === "channel" ? context.conversation.runtimeParticipantIds : undefined,
    reachableParticipants: sceneType === "channel" ? finalOutputReachableParticipants(context) : undefined,
    contextBlocks,
    preferredLanguage: context.preferredLanguage,
    activeToolNames: buildChatTurnActiveToolNames(sceneType),
    userMessageSource: "tinyoffice.chat_room_message",
    userMessagePayload,
    allowEmptyReply: false,
    onProcessEvent: input.onProcessEvent,
    onRuntimeSessionPersisted: input.onRuntimeSessionPersisted,
    repoRoot: input.repoRoot,
    runtimeProvider: input.runtimeProvider,
    runtimeSessionRepository: input.runtimeSessionRepository,
    enableTextDeltas: true,
  };
  assertNoForbiddenPublicCarrierFields(responseInput.userMessagePayload || {});
  return responseInput;
}

export async function executeTinyOfficeChatNaturalLanguageTurn(
  input: TinyOfficeChatNaturalLanguageExecutionInput,
): Promise<TinyOfficeChatNaturalLanguageExecutionResult> {
  let runtimeEvidence: TinyOfficeChatNaturalLanguageExecutionResult["runtimeEvidence"];
  const finalOutputEvents: ProcessTraceEvent[] = [];
  const responseInput = buildNaturalLanguageInputFromTinyOfficeChatRoomContext({
    ...input,
    onProcessEvent: async (event) => {
      const normalized = normalizeTinyOfficeChatProcessEventDraft(event, input.context);
      finalOutputEvents.push(normalized);
      await input.onProcessEvent?.(normalized);
    },
    onRuntimeSessionPersisted: async (persisted) => {
      runtimeEvidence = {
        sessionRecordId: persisted.record.id,
        appendedEventCount: persisted.appendedEventCount,
      };
      await input.onRuntimeSessionPersisted?.(persisted);
    },
  });
  const response = await generateNaturalLanguageEmployeeReply(responseInput);
  const reloadMemberIds = consumeDeferredRuntimeReloads(input.context.companyId, input.context.sessionKey);
  if (reloadMemberIds.length > 0) {
    const memberIdSet = new Set(reloadMemberIds);
    const predicate = (session: { employeeId: string; sessionKey: string }) => memberIdSet.has(session.employeeId);
    if (input.runtimeProvider) {
      await input.runtimeProvider.reloadWhere(predicate);
    } else {
      await reloadNaturalLanguageEmployeeSessions(predicate);
    }
  }
  const chatOutput: ChatAssistantOutput = {
    source: "assistant_message",
    message: response.message,
  };
  const stateAction = resolveChatTurnStateAction({
    sceneType: finalOutputSceneTypeFromChatScene(input.context.sceneType),
    events: finalOutputEvents,
    assistantMessage: response.message,
    topicId: input.context.conversation.topicId || input.context.conversation.conversationId,
    reachableParticipants: finalOutputReachableParticipants(input.context),
    reachableMemberIds: input.context.conversation.runtimeParticipantIds,
  });
  if (!stateAction.ok) {
    throw new Error(`Invalid ${input.context.sceneType} state action: ${stateAction.error}`);
  }
  if (runtimeEvidence) {
    const processTraceSummary = summarizeTinyOfficeChatProcessTrace(finalOutputEvents);
    if (processTraceSummary) {
      runtimeEvidence = {
        ...runtimeEvidence,
        processTraceId: processTraceSummary.id,
        processTraceLabel: processTraceSummary.label,
      };
    }
  }
  const result: TinyOfficeChatNaturalLanguageExecutionResult = {
    kind: "executed",
    executionState: "natural_language_reply_ready",
    companyId: input.context.companyId,
    roomId: input.context.roomId,
    conversationId: input.context.conversationId,
    ...(input.context.entryId ? { entryId: input.context.entryId } : {}),
    messageId: input.context.messageId,
    employeeId: input.context.targetMemberId,
    actorMemberId: input.context.actorMemberId,
    targetMemberId: input.context.targetMemberId,
    sessionKey: input.context.sessionKey,
    ...(input.context.imageInputMessageIds.length > 0
      ? { inheritedImageMessageIds: input.context.imageInputMessageIds }
      : {}),
    ...(runtimeEvidence ? { runtimeEvidence } : {}),
    chatOutput,
    ...(stateAction.stateAction ? { stateAction: stateAction.stateAction } : {}),
    response,
  };
  assertNoForbiddenPublicCarrierFields(result);
  return result;
}

export function buildTinyOfficeChatStructuredHandoffDispatch(input: {
  priorDecision: TinyOfficeChatTurnDispatchReady;
  result: TinyOfficeChatNaturalLanguageExecutionResult;
  replyMessageId: string;
}): TinyOfficeChatTurnDispatchReady | undefined {
  if (
    input.priorDecision.sceneType === "chat_direct_room" ||
    input.result.stateAction?.toolName !== "handoff_topic_turn" ||
    !input.result.stateAction.targetMemberId
  ) {
    return undefined;
  }
  const targetMemberId = input.result.stateAction.targetMemberId;
  if (targetMemberId === input.result.targetMemberId) {
    return undefined;
  }
  return {
    kind: "routable",
    source: "chat_room_message",
    reason: "formal_structured_handoff",
    eventKey: buildTinyOfficeChatTurnDispatchEventKey({
      source: "chat_room_message",
      companyId: input.result.companyId,
      roomId: input.result.roomId,
      messageId: input.replyMessageId,
    }, targetMemberId),
    companyId: input.result.companyId,
    roomId: input.result.roomId,
    ...(input.result.entryId ? { entryId: input.result.entryId } : {}),
    messageId: input.replyMessageId,
    ...(input.result.inheritedImageMessageIds
      ? { inheritedImageMessageIds: input.result.inheritedImageMessageIds }
      : {}),
    actorMemberId: input.result.targetMemberId,
    targetMemberId,
    normalizedMessage: input.result.response.message,
    preferredLanguage: input.priorDecision.preferredLanguage,
    prefersChinese: input.priorDecision.prefersChinese,
    sceneType: input.priorDecision.sceneType,
    sessionKey: `${targetMemberId}|${input.priorDecision.sceneType}|${input.result.roomId}`,
  };
}

function normalizeTinyOfficeChatProcessEventDraft(
  event: ProcessTraceEventDraft,
  context: TinyOfficeChatRoomContext,
): ProcessTraceEvent {
  const timestamp = event.timestamp || new Date().toISOString();
  return {
    id: `tinyoffice-chat-process:${context.sessionKey}:${context.messageId}:${finalOutputEventsKey(event, timestamp)}`,
    timestamp,
    sessionKey: event.sessionKey || context.sessionKey,
    kind: event.kind,
    employeeId: event.employeeId || context.targetMemberId,
    title: event.title,
    summary: event.summary,
    preview: event.preview,
    status: event.status,
    metadata: {
      ...(event.metadata || {}),
      conversationId: context.conversationId,
      roomId: context.roomId,
      messageId: context.messageId,
      sourceMessageId: context.messageId,
      targetMemberId: context.targetMemberId,
      runId: buildTinyOfficeChatTurnDispatchEventKey({
        source: context.source,
        companyId: context.companyId,
        roomId: context.roomId,
        messageId: context.messageId,
      }, context.targetMemberId),
      ...(context.entryId ? { chatEntryId: context.entryId } : {}),
    },
  };
}

function summarizeTinyOfficeChatProcessTrace(events: ProcessTraceEvent[]): { id: string; label: string } | undefined {
  const persistedEvents = events.filter((event) => event.kind !== "model_text_delta");
  if (!persistedEvents.length) {
    return undefined;
  }
  const firstEvent = persistedEvents[0];
  const lastEvent = persistedEvents.at(-1);
  if (!firstEvent || !lastEvent) {
    return undefined;
  }
  return {
    id: firstEvent.id,
    label: `Worked for ${processTraceDurationLabel(firstEvent.timestamp, lastEvent.timestamp)}`,
  };
}

function processTraceDurationLabel(start: string, end: string): string {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return "<1s";
  }
  const durationMs = Math.max(0, endMs - startMs);
  if (durationMs < 1000) {
    return "<1s";
  }
  return `${Math.round(durationMs / 1000)}s`;
}

function finalOutputEventsKey(event: ProcessTraceEventDraft, timestamp: string): string {
  const streamEventEmissionKey = typeof event.metadata?.streamEventEmissionKey === "string"
    ? event.metadata.streamEventEmissionKey.trim()
    : "";
  if (streamEventEmissionKey) {
    return streamEventEmissionKey;
  }
  const toolName = typeof event.metadata?.toolName === "string" ? event.metadata.toolName : "";
  return [
    timestamp,
    event.kind,
    event.status || "",
    toolName,
  ].join(":");
}
