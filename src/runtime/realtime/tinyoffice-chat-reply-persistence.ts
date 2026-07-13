import {
  type ConversationDto,
  assertNoForbiddenPublicCarrierFields,
  type MessageDto,
  type SendMessageResult,
} from "../../collaboration/contracts/conversation-message-contract.js";
import type { MessageServiceParticipantSelector } from "../../collaboration/message/message-service.js";
import type {
  TinyOfficeRealtimeEvent,
  TinyOfficeRealtimePublisher,
} from "../../collaboration/contracts/tinyoffice-realtime-contract.js";
import type { TinyOfficeChatNaturalLanguageExecutionResult } from "./tinyoffice-chat-natural-language-execution.js";
import { participantMemberIds, trimRequired } from "./tinyoffice-chat-turn-utils.js";

export interface TinyOfficeChatReplyPersistenceMessageService {
  getConversation(companyId: string, conversationId: string): Promise<ConversationDto | undefined>;
  listMessages(
    companyId: string,
    conversationId: string,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<{ messages: MessageDto[] }>;
  sendMessage(
    companyId: string,
    conversationId: string,
    sender: MessageServiceParticipantSelector,
    body: string,
    options?: {
      runtimeLinks?: Array<{
        linkId?: string;
        targetKind: "session" | "work_run" | "process_trace" | "session_event";
        targetId: string;
        label?: string;
        sourceMessageId?: string;
      }>;
      topicOwnerId?: string;
    },
  ): Promise<SendMessageResult>;
}

export type TinyOfficeChatReplyPersistenceResult =
  | {
      kind: "persisted";
      idempotencyKey: string;
      companyId: string;
      conversationId: string;
      roomId: string;
      sourceMessageId: string;
      targetMemberId: string;
      message: MessageDto;
      sendResult: SendMessageResult;
      realtimeEvents: TinyOfficeRealtimeEvent[];
    }
  | {
      kind: "already_persisted";
      idempotencyKey: string;
      companyId: string;
      conversationId: string;
      roomId: string;
      sourceMessageId: string;
      targetMemberId: string;
      message: MessageDto;
    };

export async function persistTinyOfficeChatNaturalLanguageReply(input: {
  result: TinyOfficeChatNaturalLanguageExecutionResult;
  messageService: TinyOfficeChatReplyPersistenceMessageService;
  realtimePublisher?: TinyOfficeRealtimePublisher;
}): Promise<TinyOfficeChatReplyPersistenceResult> {
  assertNoForbiddenPublicCarrierFields(input.result);
  const idempotencyKey = buildTinyOfficeChatReplyIdempotencyKey(input.result);
  const existing = await findExistingTinyOfficeChatReply({
    messageService: input.messageService,
    result: input.result,
    idempotencyKey,
  });
  if (existing) {
    const alreadyPersisted: TinyOfficeChatReplyPersistenceResult = {
      kind: "already_persisted",
      idempotencyKey,
      companyId: input.result.companyId,
      conversationId: input.result.conversationId,
      roomId: input.result.roomId,
      sourceMessageId: input.result.messageId,
      targetMemberId: input.result.targetMemberId,
      message: existing,
    };
    assertNoForbiddenPublicCarrierFields(alreadyPersisted);
    return alreadyPersisted;
  }

  const sendResult = await input.messageService.sendMessage(
    input.result.companyId,
    input.result.conversationId,
    await replySenderIdentity(input),
    input.result.response.message,
    {
      runtimeLinks: buildTinyOfficeChatReplyRuntimeLinks(input.result, idempotencyKey),
      ...(input.result.stateAction?.toolName === "handoff_topic_turn"
        ? { topicOwnerId: input.result.stateAction.recipientParticipantId }
        : {}),
    },
  );
  const persisted: TinyOfficeChatReplyPersistenceResult = {
    kind: "persisted",
    idempotencyKey,
    companyId: input.result.companyId,
    conversationId: input.result.conversationId,
    roomId: input.result.roomId,
    sourceMessageId: input.result.messageId,
    targetMemberId: input.result.targetMemberId,
    message: sendResult.message,
    sendResult,
    realtimeEvents: publishTinyOfficeChatReplyRealtimeEvents(input.realtimePublisher, sendResult),
  };
  assertNoForbiddenPublicCarrierFields(persisted);
  return persisted;
}

async function replySenderIdentity(input: {
  result: TinyOfficeChatNaturalLanguageExecutionResult;
  messageService: TinyOfficeChatReplyPersistenceMessageService;
}): Promise<MessageServiceParticipantSelector> {
  const conversation = await input.messageService.getConversation(input.result.companyId, input.result.conversationId);
  if (!conversation) {
    throw new Error(`Chat reply conversation was not found: ${input.result.conversationId}`);
  }
  const targetMemberId = trimRequired(input.result.targetMemberId, "targetMemberId");
  const participant = conversation.participants.find((candidate) =>
    candidate.memberId === targetMemberId
  );
  if (!participant) {
    throw new Error(`targetMember ${targetMemberId} is not a participant in conversation ${input.result.conversationId}`);
  }
  if (participant.memberId) {
    return { participantKind: "company_member", memberId: participant.memberId };
  }
  throw new Error(`targetMember ${targetMemberId} participant has no sender identity in conversation ${input.result.conversationId}`);
}

function publishTinyOfficeChatReplyRealtimeEvents(
  publisher: TinyOfficeRealtimePublisher | undefined,
  sendResult: SendMessageResult,
): TinyOfficeRealtimeEvent[] {
  if (!publisher) {
    return [];
  }
  const events = [
    publisher.publish({
      type: "chat.message.created",
      companyId: sendResult.message.companyId,
      conversationId: sendResult.message.conversationId,
      roomId: sendResult.message.conversationId,
      messageId: sendResult.message.messageId,
    }),
  ];
  for (const memberId of participantMemberIds(sendResult.conversation)) {
    events.push(publisher.publish({
      type: "chat.projection.changed",
      companyId: sendResult.message.companyId,
      viewerMemberId: memberId,
    }));
  }
  assertNoForbiddenPublicCarrierFields(events);
  return events;
}

function buildTinyOfficeChatReplyIdempotencyKey(result: TinyOfficeChatNaturalLanguageExecutionResult): string {
  return [
    "tinyoffice-chat-reply",
    trimRequired(result.companyId, "companyId"),
    trimRequired(result.conversationId, "conversationId"),
    trimRequired(result.messageId, "messageId"),
    trimRequired(result.targetMemberId, "targetMemberId"),
  ].join(":");
}

function buildTinyOfficeChatReplyRuntimeLinks(
  result: TinyOfficeChatNaturalLanguageExecutionResult,
  idempotencyKey: string,
): NonNullable<Parameters<TinyOfficeChatReplyPersistenceMessageService["sendMessage"]>[4]>["runtimeLinks"] {
  const links: NonNullable<NonNullable<Parameters<TinyOfficeChatReplyPersistenceMessageService["sendMessage"]>[4]>["runtimeLinks"]> = [{
    linkId: idempotencyKey,
    targetKind: "session",
    targetId: result.runtimeEvidence?.sessionRecordId || result.sessionKey,
    label: "Owned Chat employee reply",
    sourceMessageId: result.messageId,
  }];
  if (result.runtimeEvidence?.processTraceId) {
    links.push({
      linkId: `${idempotencyKey}:process-trace`,
      targetKind: "process_trace",
      targetId: result.runtimeEvidence.processTraceId,
      label: result.runtimeEvidence.processTraceLabel || "Worked",
      sourceMessageId: result.messageId,
    });
  }
  return links;
}

async function findExistingTinyOfficeChatReply(input: {
  result: TinyOfficeChatNaturalLanguageExecutionResult;
  messageService: TinyOfficeChatReplyPersistenceMessageService;
  idempotencyKey: string;
}): Promise<MessageDto | undefined> {
  const page = await input.messageService.listMessages(
    input.result.companyId,
    input.result.conversationId,
    { limit: 100 },
  );
  assertNoForbiddenPublicCarrierFields(page);
  return page.messages.find((message) =>
    message.sender.memberId === input.result.targetMemberId &&
    message.runtimeLinks.some((link) => link.linkId === input.idempotencyKey)
  );
}
