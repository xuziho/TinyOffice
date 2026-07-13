import type {
  ChatDispatchApiEvent,
  ChatDispatchApiSink,
} from "../../collaboration/api/chat-projection-api-routes.js";
import type { ConversationApiMessageService } from "../../collaboration/api/conversation-api-service.js";
import type {
  ChatRuntimeStatus,
  TinyOfficeRealtimePublisher,
} from "../../collaboration/contracts/tinyoffice-realtime-contract.js";
import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import type {
  NaturalLanguageResponseInput,
  ProcessTraceEventDraft,
} from "../provider/natural-language-responder.js";
import {
  abortNaturalLanguageEmployeeSessions,
} from "../provider/natural-language-responder.js";
import type { EmployeeHome } from "../registry/employee-home.js";
import {
  RuntimeSessionRepository,
  type RuntimeSessionEvent,
  type RuntimeSessionRepositoryLike,
} from "../storage/runtime-session-repository.js";
import type { RuntimeSessionPersistResult } from "../provider/natural-language-responder.js";
import type { SystemAiChatTopicSummaryGenerationRequest } from "../../system-ai/chat-topic-summary-generation.js";
import {
  assembleTinyOfficeChatRoomContext,
  buildTinyOfficeChatStructuredHandoffDispatch,
  executeTinyOfficeChatNaturalLanguageTurn,
  handleTinyOfficeChatExecutionDispatch,
  persistTinyOfficeChatNaturalLanguageReply,
  TinyOfficeChatTurnDispatchBoundary,
  type TinyOfficeChatExecutionStatusRepository,
  updateTinyOfficeChatExecutionDispatchStatus,
  type TinyOfficeChatTurnDispatchDecision,
} from "../realtime/tinyoffice-chat-turn-dispatch.js";
import type { TinyOfficeChatTopicContextCursor } from "../realtime/tinyoffice-chat-room-context.js";

export interface TinyOfficeChatRuntimeProcessTracePublisher {
  publishProcessTrace(event: TinyOfficeChatRuntimeProcessTraceEventInput): Promise<ProcessTraceEvent>;
  publishProcessTraceEvent(event: TinyOfficeChatRuntimeProcessTraceEventInput): Promise<ProcessTraceEvent>;
}

type TinyOfficeChatRuntimeProcessTraceEventInput =
  Omit<ProcessTraceEvent, "id" | "timestamp"> &
  Partial<Pick<ProcessTraceEvent, "id" | "timestamp">>;

export interface TinyOfficeChatRuntimeDispatchContext {
  companyId: string;
  employeeHomesById: Map<string, EmployeeHome>;
  employeeIds: string[];
  processTrace?: TinyOfficeChatRuntimeProcessTracePublisher;
}

export interface TinyOfficeChatRuntimeDispatchTraceEntry extends Record<string, unknown> {
  phase: string;
}

export interface TinyOfficeChatRuntimeDispatchSinkConfig {
  repoRoot: string;
  serviceForCompany(companyId: string): Promise<ConversationApiMessageService>;
  runtimeForCompany(companyId: string): Promise<TinyOfficeChatRuntimeDispatchContext>;
  realtimePublisher?: TinyOfficeRealtimePublisher;
  runtimeProvider?: NaturalLanguageResponseInput["runtimeProvider"];
  runtimeSessionRepositoryForCompany?: (companyId: string) => Promise<{
    repository: RuntimeSessionRepositoryLike;
    close?: () => void;
  }>;
  maxHandoffDepth?: number;
  trace?: (entry: TinyOfficeChatRuntimeDispatchTraceEntry) => void | Promise<void>;
  onRuntimeSessionPersisted?: (persisted: RuntimeSessionPersistResult) => void | Promise<void>;
  topicSummaryGenerationService?: {
    requestTopicSummaryGeneration(request: SystemAiChatTopicSummaryGenerationRequest): void;
  };
  workBlockedRecoveryMessageHandler?: {
    handleParticipantMessage(event: {
      companyId: string;
      conversationId: string;
      messageId: string;
      actorMemberId: string;
      body: string;
    }): Promise<boolean>;
  };
  topicSummaryMinMessageCount?: number;
  topicSummaryRecentMessageLimit?: number;
  runInBackground?: (task: Promise<void>) => void;
  onError?: (error: unknown) => void;
}

export class ChatRetryTargetUnavailableError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "ChatRetryTargetUnavailableError";
  }
}

export function createTinyOfficeChatRuntimeDispatchSink(
  config: TinyOfficeChatRuntimeDispatchSinkConfig,
): ChatDispatchApiSink {
  const activeRuns = new Map<string, ActiveChatRun>();
  const sink: ChatDispatchApiSink = {
    async handleChatDispatchEvent(event: ChatDispatchApiEvent) {
      try {
        if (await tryHandleWorkBlockedRecoveryMessage(config, event)) {
          await trace(config, {
            phase: "tinyoffice_chat_runtime_dispatch.work_blocked_recovery_consumed",
            companyId: event.companyId,
            roomId: event.roomId,
            messageId: event.messageId,
            actorMemberId: event.actorMemberId,
          });
          return;
        }
        const runtime = await config.runtimeForCompany(event.companyId);
        const messageService = await config.serviceForCompany(event.companyId);
        const boundary = new TinyOfficeChatTurnDispatchBoundary({
          resolver: {
            getConversation: (companyId, roomId) => messageService.getConversation(companyId, roomId),
          },
          employeeIds: () => runtime.employeeIds,
        });
        const decisions = await boundary.decide(event);
        for (const decision of decisions) {
          await trace(config, decision.kind === "routable"
            ? {
                phase: "tinyoffice_chat_runtime_dispatch.routable",
                source: decision.source,
                companyId: decision.companyId,
                roomId: decision.roomId,
                messageId: decision.messageId,
                actorMemberId: decision.actorMemberId,
                targetMemberId: decision.targetMemberId,
                reason: decision.reason,
                eventKey: decision.eventKey,
                sceneType: decision.sceneType,
                sessionKey: decision.sessionKey,
                preferredLanguage: decision.preferredLanguage,
              }
            : {
                phase: "tinyoffice_chat_runtime_dispatch.ignored",
                source: decision.source,
                companyId: decision.companyId,
                roomId: decision.roomId,
                messageId: decision.messageId,
                actorMemberId: decision.actorMemberId,
                targetMemberId: decision.targetMemberId,
                reason: decision.reason,
                eventKey: decision.eventKey,
              });
        }

        for (const decision of decisions) {
          if (decision.kind !== "routable") {
            continue;
          }
          publishRuntimeStatus(config.realtimePublisher, decision, {
            status: "queued",
            runtimeProviderId: config.runtimeProvider?.providerId,
          });
          activeRuns.set(decision.eventKey, {
            decision,
            status: "queued",
            cancelRequested: false,
            sequenceInRun: 0,
            streamedContent: "",
          });
          const task = executeTinyOfficeChatRuntimeDecision({
            config,
            runtime,
            messageService,
            decision,
            activeRuns,
            depth: 0,
          });
          if (config.runInBackground) {
            config.runInBackground(task);
          } else {
            await task;
          }
        }
      } catch (error) {
        await trace(config, {
          phase: "tinyoffice_chat_runtime_dispatch.failed",
          companyId: event.companyId,
          roomId: event.roomId,
          messageId: event.messageId,
          error: error instanceof Error ? error.stack || error.message : String(error),
        }).catch(() => undefined);
        config.onError?.(error);
      }
    },
    async cancelChatRun(companyId, input) {
      const run = activeRuns.get(input.runId);
      if (!run || run.decision.companyId !== companyId) {
        return {
          companyId,
          runId: input.runId,
          status: "not_found",
          canceledCount: 0,
        };
      }

      run.cancelRequested = true;
      run.status = "cancel_requested";
      publishRuntimeStatus(config.realtimePublisher, run.decision, {
        status: "cancel_requested",
        runtimeProviderId: config.runtimeProvider?.providerId,
      });
      const canceledCount = await abortChatRuntime(config, run);
      run.status = canceledCount > 0 ? "canceled" : "cancel_requested";
      if (canceledCount > 0) {
        publishRuntimeStatus(config.realtimePublisher, run.decision, {
          status: "canceled",
          runtimeProviderId: config.runtimeProvider?.providerId,
        });
        activeRuns.delete(input.runId);
      }
      return {
        companyId,
        runId: input.runId,
        status: run.status,
        canceledCount,
      };
    },
    async retryChatRun(companyId, input) {
      const messageService = await config.serviceForCompany(companyId);
      const conversation = await messageService.getConversation(companyId, input.roomId);
      if (!conversation || !conversation.participants.some((participant) => participant.memberId === input.actor.memberId)) {
        throw new Error("Chat retry room is not available to the current member.");
      }
      if (!conversation.participants.some((participant) => participant.memberId === input.targetMemberId)) {
        throw new ChatRetryTargetUnavailableError("Chat retry target is not a participant in the original room.");
      }
      const runtime = await config.runtimeForCompany(companyId);
      if (!runtime.employeeIds.includes(input.targetMemberId)) {
        throw new ChatRetryTargetUnavailableError("Chat retry target is not an active runtime-capable member.");
      }
      const messages = await messageService.listMessages(companyId, input.roomId, { limit: 500 });
      const source = messages.messages.find((message) => message.messageId === input.sourceMessageId);
      if (!source || source.sender.memberId !== input.actor.memberId) {
        throw new Error("Original user Message is not available for retry.");
      }
      await sink.handleChatDispatchEvent({
        source: "chat_room_message",
        companyId,
        roomId: input.roomId,
        actorMemberId: input.actor.memberId,
        messageId: source.messageId,
        body: source.body,
        mentionedMemberIds: [input.targetMemberId],
        attemptId: `retry-${Date.now()}`,
      });
      return { companyId, roomId: input.roomId, sourceMessageId: source.messageId, status: "retry_queued" };
    },
  };
  return sink;
}

async function tryHandleWorkBlockedRecoveryMessage(
  config: TinyOfficeChatRuntimeDispatchSinkConfig,
  event: ChatDispatchApiEvent,
): Promise<boolean> {
  if (!config.workBlockedRecoveryMessageHandler) {
    return false;
  }
  if (event.source !== "chat_room_message" || !event.actorMemberId) {
    return false;
  }
  return config.workBlockedRecoveryMessageHandler.handleParticipantMessage({
    companyId: event.companyId,
    conversationId: event.roomId,
    messageId: event.messageId,
    actorMemberId: event.actorMemberId,
    body: event.body,
  });
}

interface ActiveChatRun {
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>;
  status: ChatRuntimeStatus;
  cancelRequested: boolean;
  sequenceInRun: number;
  streamedContent: string;
}

function findPriorTopicContextCursor(
  repository: RuntimeSessionRepositoryLike,
  input: {
    sessionKey: string;
    excludeSessionRecordId?: string;
  },
): TinyOfficeChatTopicContextCursor | undefined {
  const records = repository
    .listSessionRecords({ sessionKey: input.sessionKey, limit: 25 })
    .filter((record) => record.id !== input.excludeSessionRecordId);
  for (const record of records) {
    const events = repository
      .listSessionEvents(record.id)
      .slice()
      .sort((left, right) => right.sequence - left.sequence || right.timestamp.localeCompare(left.timestamp));
    for (const event of events) {
      const cursor = topicContextCursorFromRuntimeSessionEvent(event);
      if (cursor) {
        return cursor;
      }
    }
  }
  return undefined;
}

function topicContextCursorFromRuntimeSessionEvent(event: RuntimeSessionEvent): TinyOfficeChatTopicContextCursor | undefined {
  if (event.kind !== "prompt_context" || event.source !== "tinyoffice.chat_topic_context") {
    return undefined;
  }
  const payload = event.payload || {};
  const metadata = payload.metadata;
  if (!isRecord(metadata) || metadata.kind !== "chat_topic_context_window") {
    throw new Error(`Topic context event ${event.id} is missing chat_topic_context_window metadata`);
  }
  if (typeof metadata.lastMessageId !== "string" || typeof metadata.lastCreatedAt !== "string") {
    throw new Error(`Topic context event ${event.id} is missing last message cursor metadata`);
  }
  return {
    messageId: metadata.lastMessageId,
    createdAt: metadata.lastCreatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureActiveChatRun(
  activeRuns: Map<string, ActiveChatRun>,
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>,
): ActiveChatRun {
  const existing = activeRuns.get(decision.eventKey);
  if (existing) {
    return existing;
  }
  const run: ActiveChatRun = {
    decision,
    status: "queued",
    cancelRequested: false,
    sequenceInRun: 0,
    streamedContent: "",
  };
  activeRuns.set(decision.eventKey, run);
  return run;
}

async function executeTinyOfficeChatRuntimeDecision(input: {
  config: TinyOfficeChatRuntimeDispatchSinkConfig;
  runtime: TinyOfficeChatRuntimeDispatchContext;
  messageService: ConversationApiMessageService;
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>;
  activeRuns: Map<string, ActiveChatRun>;
  depth: number;
}): Promise<void> {
  const { config, runtime, messageService, decision } = input;
  const activeRun = ensureActiveChatRun(input.activeRuns, decision);
  const maxHandoffDepth = config.maxHandoffDepth ?? 8;
  if (input.depth > maxHandoffDepth) {
    await trace(config, {
      phase: "tinyoffice_chat_runtime_execution.handoff_depth_exhausted",
      eventKey: decision.eventKey,
      companyId: decision.companyId,
      roomId: decision.roomId,
      messageId: decision.messageId,
      targetMemberId: decision.targetMemberId,
      maxHandoffDepth,
    });
    const failedTraceEvent = await publishTurnFailed(runtime, decision, "Structured Chat handoff depth limit was reached.", "Chat handoff stopped");
    publishChatProcessTraceAppended(config.realtimePublisher, decision, failedTraceEvent);
    publishRuntimeStatus(config.realtimePublisher, decision, {
      status: "failed",
      runtimeProviderId: config.runtimeProvider?.providerId,
      errorMessage: "Structured Chat handoff depth limit was reached.",
    });
    return;
  }

  const employee = runtime.employeeHomesById.get(decision.targetMemberId);
  if (!employee) {
    await trace(config, {
      phase: "tinyoffice_chat_runtime_execution.missing_employee_home",
      eventKey: decision.eventKey,
      companyId: decision.companyId,
      targetMemberId: decision.targetMemberId,
    });
    const failedTraceEvent = await publishTurnFailed(
      runtime,
      decision,
      "Employee home was not available for TinyOffice Chat execution.",
      "Chat turn failed",
    );
    publishChatProcessTraceAppended(config.realtimePublisher, decision, failedTraceEvent);
    publishRuntimeStatus(config.realtimePublisher, decision, {
      status: "failed",
      runtimeProviderId: config.runtimeProvider?.providerId,
      errorMessage: "Employee home was not available for TinyOffice Chat execution.",
    });
    return;
  }

  const repositoryHandle = config.runtimeSessionRepositoryForCompany
    ? await config.runtimeSessionRepositoryForCompany(decision.companyId)
    : {
        repository: await RuntimeSessionRepository.open(config.repoRoot, { companyId: decision.companyId }),
        close() {
          this.repository.close();
        },
      };
  const repository = repositoryHandle.repository;
  try {
    const intent = await handleTinyOfficeChatExecutionDispatch({
      decision,
      repository,
    });
    if (intent.kind === "started") {
      publishRuntimeStatus(config.realtimePublisher, decision, {
        status: "received",
        runtimeProviderId: config.runtimeProvider?.providerId,
        sessionRecordId: intent.sessionRecordId,
      });
      await trace(config, {
        phase: "tinyoffice_chat_runtime_execution.intent_recorded",
        eventKey: intent.eventKey,
        companyId: intent.companyId,
        targetMemberId: intent.targetMemberId,
        sessionKey: intent.sessionKey,
        sessionRecordId: intent.sessionRecordId,
        sessionEventId: intent.sessionEventId,
      });
    }

    const context = await assembleTinyOfficeChatRoomContext({
      decision,
      resolver: messageService,
      participantProfiles: Array.from(runtime.employeeHomesById.values()).map((home) => ({
        id: home.employeeId,
        displayName: home.profile.displayName,
        role: home.profile.role,
        runtimeCapable: true,
      })),
      priorTopicContextCursor: decision.sceneType === "chat_topic_room"
        ? findPriorTopicContextCursor(repository, {
            sessionKey: decision.sessionKey,
            excludeSessionRecordId: intent.kind === "started" ? intent.sessionRecordId : undefined,
          })
        : undefined,
    });
    publishRuntimeStatus(config.realtimePublisher, decision, {
      status: "thinking",
      runtimeProviderId: config.runtimeProvider?.providerId,
    });
    const startedTraceEvent = await publishChatRunStartedTrace(runtime, decision, {
      runtimeProviderId: config.runtimeProvider?.providerId,
      sessionRecordId: intent.kind === "started" ? intent.sessionRecordId : undefined,
    });
    publishChatProcessTraceAppended(config.realtimePublisher, decision, startedTraceEvent);
    const result = await executeTinyOfficeChatNaturalLanguageTurn({
      context,
      employee,
      repoRoot: config.repoRoot,
      runtimeSessionRepository: repository,
      runtimeProvider: config.runtimeProvider,
      onRuntimeSessionPersisted: config.onRuntimeSessionPersisted,
      onProcessEvent: async (event) => {
        const status = runtimeStatusFromProcessEvent(event);
        if (status) {
          publishRuntimeStatus(config.realtimePublisher, decision, {
            status,
            runtimeProviderId: config.runtimeProvider?.providerId,
            sessionRecordId: resultSessionRecordId(event),
          });
        }
        if (event.kind === "model_text_delta") {
          publishReplyDeltaFromProcessEvent(config.realtimePublisher, decision, event, activeRun);
          return;
        }
        const processTraceEvent = await runtime.processTrace?.publishProcessTraceEvent({
          ...event,
          metadata: {
            ...(event.metadata || {}),
            companyId: decision.companyId,
            conversationId: decision.roomId,
            messageId: decision.messageId,
            sourceMessageId: decision.messageId,
            chatEntryId: decision.entryId,
            runId: decision.eventKey,
            eventKey: decision.eventKey,
            targetMemberId: decision.targetMemberId,
          },
        });
        publishChatProcessTraceAppended(config.realtimePublisher, decision, processTraceEvent);
      },
    });
    if (activeRun.cancelRequested) {
      await finishCanceledChatRun({
        config,
        runtime,
        decision,
        repository,
        runtimeSessionRecordId: result.runtimeEvidence?.sessionRecordId,
        providerReplyObserved: true,
      });
      return;
    }
    publishChatReplySnapshot(config.realtimePublisher, decision, result.response.message, activeRun);
    publishRuntimeStatus(config.realtimePublisher, decision, {
      status: "replying",
      runtimeProviderId: config.runtimeProvider?.providerId,
      sessionRecordId: result.runtimeEvidence?.sessionRecordId,
    });
    const persisted = await persistTinyOfficeChatNaturalLanguageReply({
      result,
      messageService,
      realtimePublisher: config.realtimePublisher,
    });
    publishRuntimeStatus(config.realtimePublisher, decision, {
      status: "completed",
      runtimeProviderId: config.runtimeProvider?.providerId,
      sessionRecordId: result.runtimeEvidence?.sessionRecordId,
      replyMessageId: persisted.message.messageId,
    });
    await updateTinyOfficeChatExecutionDispatchStatus({
      decision,
      repository,
      status: "completed",
      summary: `Owned Chat reply ${persisted.message.messageId} was persisted.`,
    });
    await trace(config, {
      phase: "tinyoffice_chat_runtime_execution.reply.persisted",
      kind: persisted.kind,
      eventKey: decision.eventKey,
      companyId: persisted.companyId,
      conversationId: persisted.conversationId,
      sourceMessageId: persisted.sourceMessageId,
      replyMessageId: persisted.message.messageId,
      targetMemberId: persisted.targetMemberId,
      stateActionToolName: result.stateAction?.toolName,
      handoffTargetMemberId: result.stateAction?.targetMemberId,
      runtimeSessionRecordId: result.runtimeEvidence?.sessionRecordId,
    });
    const completedTraceEvent = await runtime.processTrace?.publishProcessTrace({
      kind: "turn_completed",
      sessionKey: result.sessionKey,
      employeeId: result.targetMemberId,
      title: `${result.targetMemberId} posted a Chat reply`,
      summary: `Reply message ${persisted.message.messageId} was written to the TinyOffice Conversation.`,
      status: "succeeded",
      metadata: {
        companyId: result.companyId,
        conversationId: result.conversationId,
        messageId: persisted.message.messageId,
        sourceMessageId: result.messageId,
        replyMessageId: persisted.message.messageId,
        chatEntryId: result.entryId,
        runId: decision.eventKey,
        eventKey: decision.eventKey,
        targetMemberId: result.targetMemberId,
        stateActionToolName: result.stateAction?.toolName,
        handoffTargetMemberId: result.stateAction?.targetMemberId,
        runtimeSessionRecordId: result.runtimeEvidence?.sessionRecordId,
      },
    });
    publishChatProcessTraceAppended(config.realtimePublisher, decision, completedTraceEvent, {
      replyMessageId: persisted.message.messageId,
    });
    await requestTopicSummaryRefresh({
      config,
      messageService,
      decision,
    });

    const handoffDecision = buildTinyOfficeChatStructuredHandoffDispatch({
      priorDecision: decision,
      result,
      replyMessageId: persisted.message.messageId,
    });
    if (handoffDecision) {
      await trace(config, {
        phase: "tinyoffice_chat_runtime_execution.structured_handoff",
        eventKey: handoffDecision.eventKey,
        companyId: handoffDecision.companyId,
        roomId: handoffDecision.roomId,
        messageId: handoffDecision.messageId,
        actorMemberId: handoffDecision.actorMemberId,
        targetMemberId: handoffDecision.targetMemberId,
        reason: handoffDecision.reason,
        sessionKey: handoffDecision.sessionKey,
      });
      await executeTinyOfficeChatRuntimeDecision({
        config,
        runtime,
        messageService,
        decision: handoffDecision,
        activeRuns: input.activeRuns,
        depth: input.depth + 1,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await trace(config, {
      phase: "tinyoffice_chat_runtime_execution.failed",
      eventKey: decision.eventKey,
      companyId: decision.companyId,
      roomId: decision.roomId,
      messageId: decision.messageId,
      targetMemberId: decision.targetMemberId,
      error: error instanceof Error ? error.stack || error.message : String(error),
    }).catch(() => undefined);
    if (activeRun?.cancelRequested) {
      await finishCanceledChatRun({
        config,
        runtime,
        decision,
        repository,
        errorMessage,
      }).catch(() => undefined);
    } else {
      await updateTinyOfficeChatExecutionDispatchStatus({
        decision,
        repository,
        status: "failed",
        summary: errorMessage,
      }).catch(() => undefined);
      publishRuntimeStatus(config.realtimePublisher, decision, {
        status: "failed",
        runtimeProviderId: config.runtimeProvider?.providerId,
        errorMessage,
      });
      const failedTraceEvent = await publishTurnFailed(runtime, decision, errorMessage, "Chat turn failed").catch(() => undefined);
      publishChatProcessTraceAppended(config.realtimePublisher, decision, failedTraceEvent);
      config.onError?.(error);
    }
  } finally {
    input.activeRuns.delete(decision.eventKey);
    repositoryHandle.close?.();
  }
}

async function finishCanceledChatRun(input: {
  config: TinyOfficeChatRuntimeDispatchSinkConfig;
  runtime: TinyOfficeChatRuntimeDispatchContext;
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>;
  repository: TinyOfficeChatExecutionStatusRepository;
  runtimeSessionRecordId?: string;
  errorMessage?: string;
  providerReplyObserved?: boolean;
}): Promise<void> {
  const summary = input.providerReplyObserved
    ? "Owned Chat execution was canceled before a late provider reply could be persisted."
    : "Owned Chat execution was canceled before a reply was persisted.";
  await updateTinyOfficeChatExecutionDispatchStatus({
    decision: input.decision,
    repository: input.repository,
    status: "canceled",
    summary,
  }).catch((statusError) => trace(input.config, {
    phase: "tinyoffice_chat_runtime_execution.cancel_status_persist_failed",
    eventKey: input.decision.eventKey,
    companyId: input.decision.companyId,
    roomId: input.decision.roomId,
    messageId: input.decision.messageId,
    targetMemberId: input.decision.targetMemberId,
    error: statusError instanceof Error ? statusError.stack || statusError.message : String(statusError),
  }).catch(() => undefined));
  publishRuntimeStatus(input.config.realtimePublisher, input.decision, {
    status: "canceled",
    runtimeProviderId: input.config.runtimeProvider?.providerId,
    sessionRecordId: input.runtimeSessionRecordId,
    errorMessage: input.errorMessage,
  });
  const canceledTraceEvent = await input.runtime.processTrace?.publishProcessTrace({
    kind: "turn_failed",
    sessionKey: input.decision.sessionKey,
    employeeId: input.decision.targetMemberId,
    title: `${input.decision.targetMemberId} Chat run canceled`,
    summary,
    status: "canceled",
    metadata: {
      companyId: input.decision.companyId,
      conversationId: input.decision.roomId,
      messageId: input.decision.messageId,
      sourceMessageId: input.decision.messageId,
      chatEntryId: input.decision.entryId,
      runId: input.decision.eventKey,
      eventKey: input.decision.eventKey,
      targetMemberId: input.decision.targetMemberId,
      runtimeSessionRecordId: input.runtimeSessionRecordId,
      providerReplyObserved: input.providerReplyObserved || false,
    },
  });
  publishChatProcessTraceAppended(input.config.realtimePublisher, input.decision, canceledTraceEvent);
}

async function requestTopicSummaryRefresh(input: {
  config: TinyOfficeChatRuntimeDispatchSinkConfig;
  messageService: ConversationApiMessageService;
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>;
}): Promise<void> {
  const summaryService = input.config.topicSummaryGenerationService;
  if (!summaryService || input.decision.sceneType !== "chat_topic_room") {
    return;
  }
  const conversation = await input.messageService.getConversation(input.decision.companyId, input.decision.roomId);
  if (!conversation?.topic) {
    return;
  }
  const recent = await input.messageService.listRecentMessages(input.decision.companyId, input.decision.roomId, {
    limit: input.config.topicSummaryRecentMessageLimit ?? 20,
  });
  const minMessageCount = input.config.topicSummaryMinMessageCount ?? 20;
  if (recent.messages.length < minMessageCount) {
    return;
  }
  summaryService.requestTopicSummaryGeneration({
    companyId: input.decision.companyId,
    topicId: conversation.topic.topicId,
    roomId: input.decision.roomId,
    existingSummary: conversation.topic.summary?.text,
    sourceMessages: recent.messages.map((message) => ({
      messageId: message.messageId,
      senderDisplayName: message.sender.displayName,
      body: message.body,
      createdAt: message.createdAt,
    })),
  });
}

async function abortChatRuntime(
  config: TinyOfficeChatRuntimeDispatchSinkConfig,
  run: ActiveChatRun,
): Promise<number> {
  const predicate = ({ employeeId, sessionKey }: { employeeId: string; sessionKey: string }) =>
    employeeId === run.decision.targetMemberId && sessionKey === run.decision.sessionKey;
  if (config.runtimeProvider) {
    return config.runtimeProvider.abortWhere(predicate);
  }
  return abortNaturalLanguageEmployeeSessions(predicate);
}

function publishRuntimeStatus(
  publisher: TinyOfficeRealtimePublisher | undefined,
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>,
  input: {
    status: ChatRuntimeStatus;
    runtimeProviderId?: string;
    sessionRecordId?: string;
    replyMessageId?: string;
    errorMessage?: string;
  },
): void {
  publisher?.publish({
    type: "chat.runtime_status.changed",
    companyId: decision.companyId,
    conversationId: decision.roomId,
    roomId: decision.roomId,
    sourceMessageId: decision.messageId,
    targetMemberId: decision.targetMemberId,
    status: input.status,
    runId: decision.eventKey,
    sessionKey: decision.sessionKey,
    ...(input.sessionRecordId ? { sessionRecordId: input.sessionRecordId } : {}),
    ...(input.runtimeProviderId ? { runtimeProviderId: input.runtimeProviderId } : {}),
    ...(input.replyMessageId ? { replyMessageId: input.replyMessageId } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
  });
}

function publishChatProcessTraceAppended(
  publisher: TinyOfficeRealtimePublisher | undefined,
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>,
  event: ProcessTraceEvent | undefined,
  input: {
    replyMessageId?: string;
  } = {},
): void {
  if (!publisher || !event) {
    return;
  }
  publisher.publish({
    type: "chat.process_trace.appended",
    companyId: decision.companyId,
    conversationId: decision.roomId,
    roomId: decision.roomId,
    runId: decision.eventKey,
    sourceMessageId: decision.messageId,
    targetMemberId: decision.targetMemberId,
    sessionKey: event.sessionKey,
    ...(input.replyMessageId ? { replyMessageId: input.replyMessageId } : {}),
    processTraceEvent: event,
  });
}

async function publishChatRunStartedTrace(
  runtime: TinyOfficeChatRuntimeDispatchContext,
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>,
  input: {
    runtimeProviderId?: string;
    sessionRecordId?: string;
  },
): Promise<ProcessTraceEvent | undefined> {
  return runtime.processTrace?.publishProcessTrace({
    kind: "employee_reply_started",
    sessionKey: decision.sessionKey,
    employeeId: decision.targetMemberId,
    title: `${decision.targetMemberId} started Chat reply`,
    summary: `Chat runtime accepted ${decision.messageId} and started preparing a reply.`,
    status: "running",
    metadata: {
      companyId: decision.companyId,
      conversationId: decision.roomId,
      messageId: decision.messageId,
      sourceMessageId: decision.messageId,
      chatEntryId: decision.entryId,
      runId: decision.eventKey,
      eventKey: decision.eventKey,
      targetMemberId: decision.targetMemberId,
      ...(input.runtimeProviderId ? { runtimeProviderId: input.runtimeProviderId } : {}),
      ...(input.sessionRecordId ? { runtimeSessionRecordId: input.sessionRecordId } : {}),
    },
  });
}

function publishReplyDeltaFromProcessEvent(
  publisher: TinyOfficeRealtimePublisher | undefined,
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>,
  event: ProcessTraceEventDraft,
  activeRun: ActiveChatRun | undefined,
): void {
  const delta = typeof event.preview === "string" ? event.preview : "";
  if (!publisher || !delta.trim() || !activeRun) {
    return;
  }
  if (activeRun.status !== "streaming") {
    activeRun.status = "streaming";
    publishRuntimeStatus(publisher, decision, {
      status: "streaming",
    });
  }
  activeRun.sequenceInRun += 1;
  activeRun.streamedContent += delta;
  publisher.publish({
    type: "chat.reply.delta",
    companyId: decision.companyId,
    conversationId: decision.roomId,
    roomId: decision.roomId,
    runId: decision.eventKey,
    sourceMessageId: decision.messageId,
    targetMemberId: decision.targetMemberId,
    sessionKey: decision.sessionKey,
    delta,
    sequenceInRun: activeRun.sequenceInRun,
  });
}

function publishChatReplySnapshot(
  publisher: TinyOfficeRealtimePublisher | undefined,
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>,
  content: string,
  activeRun: ActiveChatRun | undefined,
): void {
  if (!publisher || !content.trim() || !activeRun) {
    return;
  }
  activeRun.sequenceInRun += 1;
  publisher.publish({
    type: "chat.reply.snapshot",
    companyId: decision.companyId,
    conversationId: decision.roomId,
    roomId: decision.roomId,
    runId: decision.eventKey,
    sourceMessageId: decision.messageId,
    targetMemberId: decision.targetMemberId,
    sessionKey: decision.sessionKey,
    content,
    sequenceInRun: activeRun.sequenceInRun,
  });
}

function runtimeStatusFromProcessEvent(event: ProcessTraceEventDraft): ChatRuntimeStatus | undefined {
  if (event.kind === "tool_activity" && event.status === "running") {
    return "tool_calling";
  }
  if (event.kind === "model_reasoning_observed" && event.status === "running") {
    return "thinking";
  }
  return undefined;
}

function resultSessionRecordId(event: ProcessTraceEventDraft): string | undefined {
  return typeof event.metadata?.sessionRecordId === "string" ? event.metadata.sessionRecordId : undefined;
}

async function publishTurnFailed(
  runtime: TinyOfficeChatRuntimeDispatchContext,
  decision: Extract<TinyOfficeChatTurnDispatchDecision, { kind: "routable" }>,
  summary: string,
  titleSuffix: string,
): Promise<ProcessTraceEvent | undefined> {
  return runtime.processTrace?.publishProcessTrace({
    kind: "turn_failed",
    sessionKey: decision.sessionKey,
    employeeId: decision.targetMemberId,
    title: `${decision.targetMemberId} ${titleSuffix}`,
    summary,
    status: "failed",
    metadata: {
      companyId: decision.companyId,
      conversationId: decision.roomId,
      messageId: decision.messageId,
      sourceMessageId: decision.messageId,
      chatEntryId: decision.entryId,
      runId: decision.eventKey,
      eventKey: decision.eventKey,
      targetMemberId: decision.targetMemberId,
    },
  });
}

async function trace(
  config: TinyOfficeChatRuntimeDispatchSinkConfig,
  entry: TinyOfficeChatRuntimeDispatchTraceEntry,
): Promise<void> {
  await config.trace?.(entry);
}
