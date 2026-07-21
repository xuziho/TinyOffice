import { randomUUID } from "node:crypto";

import {
  ATTACHMENT_DTO_SCHEMA,
  CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
  CONVERSATION_RUNTIME_LINK_DTO_SCHEMA,
  CONVERSATION_TOPIC_STATE_DTO_SCHEMA,
  CONVERSATION_DTO_SCHEMA,
  CONVERSATION_MESSAGE_CONTRACT_VERSION,
  createConversationMessageRealtimeEvent,
  ensureConversationCompanyScope,
  MESSAGE_DTO_SCHEMA,
  MESSAGE_MENTION_DTO_SCHEMA,
  PARTICIPANT_DTO_SCHEMA,
  type AttachmentId,
  type CompanyMemberId,
  type ConversationDto,
  type ConversationKind,
  type ConversationMessageRealtimeEvent,
  type ConversationPage,
  type ConversationParticipantStateDto,
  type ConversationParticipantDto,
  type ConversationParticipantKind,
  type ConversationRuntimeLinkTargetKind,
  type ConversationTitleStatus,
  type ConversationRuntimeLinkDto,
  type ConversationTopicStatus,
  type MarkConversationReadResult,
  type MessageCreatedRealtimePayload,
  type MessageDto,
  type MessagePage,
  type ParticipantId,
  type ParticipantReadStateUpdatedRealtimePayload,
  type SendMessageResult,
  nextConversationRealtimeSequence,
} from "../contracts/conversation-message-contract.js";
import type { MessageRepository } from "./message-repository.js";

export interface CreateConversationParticipantInput {
  participantKind: ConversationParticipantKind;
  memberId: CompanyMemberId;
  displayName: string;
  role?: string;
}

export interface MessageServiceCreateConversationInput {
  title: string;
  titleStatus?: ConversationTitleStatus;
  titleSourceMessageId?: string;
  titleFailureReason?: string;
  conversationKind: ConversationKind;
  topic?: {
    topicId?: string;
    chatChannelId?: string;
    title?: string;
    status?: ConversationTopicStatus;
    ownerParticipantId?: string;
  };
  runtimeLinks?: MessageServiceRuntimeLinkInput[];
  participants: CreateConversationParticipantInput[];
}

export interface MessageServiceSendMessageOptions {
  attachmentIds?: AttachmentId[];
  attachments?: Array<Partial<ConversationAttachmentInput> & { attachmentId: AttachmentId }>;
  mentionedMemberIds?: CompanyMemberId[];
  runtimeLinks?: MessageServiceRuntimeLinkInput[];
  topicOwnerId?: string;
}

export interface MessageAttachmentResolver {
  listAttachments(companyId: string, attachmentIds: AttachmentId[]): Promise<Array<ConversationAttachmentInput>>;
}

export type MessageServiceParticipantSelector =
  {
    participantId?: ParticipantId;
    participantKind?: ConversationParticipantKind;
    memberId?: CompanyMemberId;
  };

export interface MessageServiceCreateConversationWithFirstMessageInput {
  conversation: MessageServiceCreateConversationInput;
  firstMessage: MessageServiceSendMessageOptions & {
    sender?: MessageServiceParticipantSelector;
    body: string;
  };
}

export interface MessageServiceConfig {
  repository: MessageRepository;
  attachmentResolver?: MessageAttachmentResolver;
  createId?: (prefix: string) => string;
  now?: () => string;
}

export interface MessageServiceUpdateConversationTitleInput {
  title?: string;
  titleStatus: ConversationTitleStatus;
  titleSourceMessageId?: string;
  titleFailureReason?: string;
}

export interface MessageServiceUpdateConversationTopicSummaryInput {
  text: string;
  sourceMessageId?: string;
}

function defaultCreateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function trimRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function publicConversation(record: ConversationDto): ConversationDto {
  return {
    ...record,
    topic: record.topic ? {
      ...record.topic,
      participantIds: [...record.topic.participantIds],
      summary: record.topic.summary ? { ...record.topic.summary } : undefined,
    } : undefined,
    participants: record.participants.map((participant) => ({ ...participant })),
    participantStates: (record.participantStates || []).map((state) => ({ ...state })),
    runtimeLinks: (record.runtimeLinks || []).map((link) => ({ ...link })),
    titleStatus: record.titleStatus,
    titleSourceMessageId: record.titleSourceMessageId,
    titleFailureReason: record.titleFailureReason,
    realtimeSequence: record.realtimeSequence ?? 0,
  };
}

function publicMessage(record: MessageDto): MessageDto {
  return {
    ...record,
    sender: { ...record.sender },
    mentions: (record.mentions || []).map((mention) => ({ ...mention })),
    attachments: record.attachments.map((attachment) => ({
      ...attachment,
      metadata: attachment.metadata ? { ...attachment.metadata } : undefined,
    })),
    runtimeLinks: (record.runtimeLinks || []).map((link) => ({ ...link })),
  };
}

type ConversationAttachmentInput = {
  attachmentId: AttachmentId;
  fileName?: string;
  mimeType?: string;
  byteLength?: number;
  downloadUrl?: string;
  previewUrl?: string;
  storageKey?: string;
  contentSha256?: string;
  metadata?: Record<string, unknown>;
};

type MessageServiceRuntimeLinkInput = {
  linkId?: string;
  targetKind: ConversationRuntimeLinkTargetKind;
  targetId: string;
  label?: string;
  sourceMessageId?: string;
  createdAt?: string;
};

export class MessageService {
  private readonly repository: MessageRepository;
  private readonly attachmentResolver?: MessageAttachmentResolver;
  private readonly createId: (prefix: string) => string;
  private readonly now: () => string;

  constructor(config: MessageServiceConfig) {
    this.repository = config.repository;
    this.attachmentResolver = config.attachmentResolver;
    this.createId = config.createId || defaultCreateId;
    this.now = config.now || (() => new Date().toISOString());
  }

  async createConversation(companyId: string, input: MessageServiceCreateConversationInput): Promise<ConversationDto> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const timestamp = this.now();
    const conversationId = this.createId("conversation");
    const conversation = this.conversationFromInput(scopedCompanyId, conversationId, input, timestamp);

    await this.repository.runInTransaction(async () => {
      await this.repository.upsertConversation({ conversation });
    });
    return publicConversation(conversation);
  }

  async createConversationWithFirstMessage(
    companyId: string,
    input: MessageServiceCreateConversationWithFirstMessageInput,
  ): Promise<SendMessageResult> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const timestamp = this.now();
    const conversationId = this.createId("conversation");
    const baseConversation = this.conversationFromInput(scopedCompanyId, conversationId, input.conversation, timestamp);
    const sender = this.requireParticipant(
      baseConversation,
      this.firstMessageSender(input.firstMessage),
      "sender",
    );
    if (!sender) {
      throw new Error(`sender is not a participant in conversation ${conversationId}`);
    }
    const messageId = this.createId("message");
    const message = await this.messageFromInput(
      scopedCompanyId,
      conversationId,
      sender,
      messageId,
      input.firstMessage.body,
      input.firstMessage,
      baseConversation,
      timestamp,
    );
    const nextConversation = this.conversationAfterMessage(baseConversation, sender.participantId, message, timestamp, input.firstMessage);

    await this.repository.runInTransaction(async () => {
      await this.repository.upsertConversation({ conversation: nextConversation });
      await this.repository.upsertMessage({ message });
    });
    return {
      message: publicMessage(message),
      realtimeEvent: this.messageCreatedEvent(
        scopedCompanyId,
        conversationId,
        messageId,
        sender.memberId,
        timestamp,
        nextConversation.realtimeSequence,
      ),
      conversation: publicConversation(nextConversation),
    };
  }

  async listConversations(
    companyId: string,
    viewer: MessageServiceParticipantSelector,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<ConversationPage> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const selector = this.participantSelector(viewer, "viewer");
    const records = await this.repository.listConversations({
      companyId: scopedCompanyId,
      viewerMemberId: selector.memberId,
      viewerParticipantId: selector.participantId,
      cursor: cursor?.cursor,
      limit: cursor?.limit,
    });
    return {
      conversations: records.map((record) => publicConversation(record.conversation)),
    };
  }

  async getConversation(companyId: string, conversationId: string): Promise<ConversationDto | undefined> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const resource = await this.loadConversation(scopedCompanyId, trimRequired(conversationId, "conversationId"));
    return resource ? publicConversation(resource) : undefined;
  }

  async listMessages(
    companyId: string,
    conversationId: string,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<MessagePage> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationId = trimRequired(conversationId, "conversationId");
    const conversation = await this.loadConversation(scopedCompanyId, scopedConversationId);
    if (!conversation) {
      return { messages: [] };
    }
    const records = await this.repository.listMessages({
      companyId: scopedCompanyId,
      conversationId: scopedConversationId,
      cursor: cursor?.cursor,
      limit: cursor?.limit,
    });
    return {
      messages: records.map((record) => publicMessage(record.message)),
    };
  }

  async listFirstMessages(companyId: string, conversationIds: string[]): Promise<MessagePage> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationIds = [...new Set(conversationIds.map((conversationId) =>
      trimRequired(conversationId, "conversationId")
    ))];
    const records = await this.repository.listFirstMessages({
      companyId: scopedCompanyId,
      conversationIds: scopedConversationIds,
    });
    return {
      messages: records.map((record) => publicMessage(record.message)),
    };
  }

  async listRecentMessages(
    companyId: string,
    conversationId: string,
    cursor?: { limit?: number },
  ): Promise<MessagePage> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationId = trimRequired(conversationId, "conversationId");
    const conversation = await this.loadConversation(scopedCompanyId, scopedConversationId);
    if (!conversation) {
      return { messages: [] };
    }
    const records = await this.repository.listRecentMessages({
      companyId: scopedCompanyId,
      conversationId: scopedConversationId,
      limit: cursor?.limit,
    });
    return {
      messages: records.map((record) => publicMessage(record.message)),
    };
  }

  async listMessagesAfter(
    companyId: string,
    conversationId: string,
    cursor: { createdAt: string; messageId: string },
  ): Promise<MessagePage> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationId = trimRequired(conversationId, "conversationId");
    const conversation = await this.loadConversation(scopedCompanyId, scopedConversationId);
    if (!conversation) {
      return { messages: [] };
    }
    const records = await this.repository.listMessagesAfter({
      companyId: scopedCompanyId,
      conversationId: scopedConversationId,
      afterCreatedAt: trimRequired(cursor.createdAt, "cursor.createdAt"),
      afterMessageId: trimRequired(cursor.messageId, "cursor.messageId"),
    });
    return {
      messages: records.map((record) => publicMessage(record.message)),
    };
  }

  async sendMessage(
    companyId: string,
    conversationId: string,
    senderInput: MessageServiceParticipantSelector,
    body: string,
    attachmentIdsOrOptions: AttachmentId[] | MessageServiceSendMessageOptions = [],
  ): Promise<SendMessageResult> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationId = trimRequired(conversationId, "conversationId");
    this.participantSelector(senderInput, "sender");
    const conversation = await this.loadConversation(scopedCompanyId, scopedConversationId);
    if (!conversation) {
      throw new Error(`conversation not found: ${scopedConversationId}`);
    }
    const sender = this.requireParticipant(conversation, senderInput, "sender");
    if (!sender) {
      throw new Error(`sender is not a participant in conversation ${scopedConversationId}`);
    }
    const timestamp = this.now();
    const messageId = this.createId("message");
    const options = Array.isArray(attachmentIdsOrOptions)
      ? { attachmentIds: attachmentIdsOrOptions }
      : attachmentIdsOrOptions;
    const message = await this.messageFromInput(scopedCompanyId, scopedConversationId, sender, messageId, body, options, conversation, timestamp);
    const nextConversation = this.conversationAfterMessage(conversation, sender.participantId, message, timestamp, options);

    await this.repository.runInTransaction(async () => {
      await this.repository.upsertMessage({ message });
      await this.repository.upsertConversation({ conversation: nextConversation });
    });
    return {
      message: publicMessage(message),
      realtimeEvent: this.messageCreatedEvent(
        scopedCompanyId,
        scopedConversationId,
        messageId,
        sender.memberId,
        timestamp,
        nextConversation.realtimeSequence,
      ),
      conversation: publicConversation(nextConversation),
    };
  }

  async markConversationRead(
    companyId: string,
    conversationId: string,
    viewerInput: MessageServiceParticipantSelector,
    lastReadMessageId?: string,
  ): Promise<MarkConversationReadResult> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationId = trimRequired(conversationId, "conversationId");
    this.participantSelector(viewerInput, "viewer");
    const conversation = await this.loadConversation(scopedCompanyId, scopedConversationId);
    if (!conversation) {
      throw new Error(`conversation not found: ${scopedConversationId}`);
    }
    const participant = this.requireParticipant(conversation, viewerInput, "viewer");
    if (!participant) {
      throw new Error(`viewer is not a participant in conversation ${scopedConversationId}`);
    }
    const timestamp = this.now();
    const states = this.normalizedParticipantStates(conversation, timestamp).map((state) =>
      state.participantId === participant.participantId
        ? {
          ...state,
          lastReadMessageId: lastReadMessageId || conversation.lastMessageId || state.lastReadMessageId,
          unreadCount: 0,
          mentionCount: 0,
          updatedAt: timestamp,
        }
        : state
    );
    const nextConversation: ConversationDto = {
      ...conversation,
      participantStates: states,
      realtimeSequence: nextConversationRealtimeSequence(conversation.realtimeSequence),
    };
    await this.repository.upsertConversation({ conversation: nextConversation });
    return {
      conversation: publicConversation(nextConversation),
      realtimeEvent: createConversationMessageRealtimeEvent<ParticipantReadStateUpdatedRealtimePayload>({
        eventId: this.createId("realtime-event"),
        type: "participant.read_state.updated",
        occurredAt: timestamp,
        sequence: nextConversation.realtimeSequence,
        companyId: scopedCompanyId,
        conversationId: scopedConversationId,
        actorMemberId: participant.memberId,
        payload: {
          participantId: participant.participantId,
          lastReadMessageId: states.find((state) => state.participantId === participant.participantId)?.lastReadMessageId,
          unreadCount: 0,
          mentionCount: 0,
        },
      }),
    };
  }

  async updateConversationTitle(
    companyId: string,
    conversationId: string,
    input: MessageServiceUpdateConversationTitleInput,
  ): Promise<ConversationDto> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationId = trimRequired(conversationId, "conversationId");
    const conversation = await this.loadConversation(scopedCompanyId, scopedConversationId);
    if (!conversation) {
      throw new Error(`conversation not found: ${scopedConversationId}`);
    }
    if (conversation.titleStatus === "manual" && (input.titleStatus === "generated" || input.titleStatus === "failed")) {
      return publicConversation(conversation);
    }
    const timestamp = this.now();
    const title = input.title !== undefined ? trimRequired(input.title, "title") : conversation.title;
    const titleStatus = this.titleStatus(input.titleStatus);
    const nextConversation: ConversationDto = {
      ...conversation,
      title,
      titleStatus,
      titleSourceMessageId: input.titleSourceMessageId
        ? trimRequired(input.titleSourceMessageId, "titleSourceMessageId")
        : conversation.titleSourceMessageId,
      titleFailureReason: input.titleFailureReason ? trimRequired(input.titleFailureReason, "titleFailureReason") : undefined,
      topic: conversation.topic
        ? {
          ...conversation.topic,
          title,
          updatedAt: timestamp,
        }
        : undefined,
      realtimeSequence: nextConversationRealtimeSequence(conversation.realtimeSequence),
      updatedAt: timestamp,
    };
    await this.repository.upsertConversation({ conversation: nextConversation });
    return publicConversation(nextConversation);
  }

  async updateConversationTopicSummary(
    companyId: string,
    conversationId: string,
    input: MessageServiceUpdateConversationTopicSummaryInput,
  ): Promise<ConversationDto> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationId = trimRequired(conversationId, "conversationId");
    const conversation = await this.loadConversation(scopedCompanyId, scopedConversationId);
    if (!conversation) {
      throw new Error(`conversation not found: ${scopedConversationId}`);
    }
    if (!conversation.topic) {
      throw new Error("topic summary requires a topic conversation");
    }
    const timestamp = this.now();
    const nextConversation: ConversationDto = {
      ...conversation,
      topic: {
        ...conversation.topic,
        summary: {
          text: trimRequired(input.text, "topicSummary.text"),
          sourceMessageId: input.sourceMessageId ? trimRequired(input.sourceMessageId, "topicSummary.sourceMessageId") : undefined,
          updatedAt: timestamp,
        },
        updatedAt: timestamp,
      },
      realtimeSequence: nextConversationRealtimeSequence(conversation.realtimeSequence),
      updatedAt: timestamp,
    };
    await this.repository.upsertConversation({ conversation: nextConversation });
    return publicConversation(nextConversation);
  }

  async archiveConversationTopic(
    companyId: string,
    conversationId: string,
    actorInput: MessageServiceParticipantSelector,
  ): Promise<ConversationDto> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationId = trimRequired(conversationId, "conversationId");
    this.participantSelector(actorInput, "actor");
    const conversation = await this.loadConversation(scopedCompanyId, scopedConversationId);
    if (!conversation) {
      throw new Error(`conversation not found: ${scopedConversationId}`);
    }
    if (conversation.conversationKind !== "topic" && conversation.conversationKind !== "direct") {
      throw new Error("archive requires a topic or direct conversation");
    }
    const actor = this.requireParticipant(conversation, actorInput, "actor");
    const timestamp = this.now();
    const nextConversation: ConversationDto = {
      ...conversation,
      ...(conversation.conversationKind === "topic" && conversation.topic
        ? { topic: { ...conversation.topic, status: "archived" as const, updatedAt: timestamp } }
        : {
            participantStates: this.normalizedParticipantStates(conversation, timestamp).map((state) =>
              state.participantId === actor.participantId ? { ...state, archivedAt: timestamp, updatedAt: timestamp } : state
            ),
          }),
      realtimeSequence: nextConversationRealtimeSequence(conversation.realtimeSequence),
      updatedAt: timestamp,
    };
    await this.repository.upsertConversation({ conversation: nextConversation });
    return publicConversation(nextConversation);
  }

  async restoreConversationTopic(
    companyId: string,
    conversationId: string,
    actorInput: MessageServiceParticipantSelector,
  ): Promise<ConversationDto> {
    const scopedCompanyId = ensureConversationCompanyScope({ companyId });
    const scopedConversationId = trimRequired(conversationId, "conversationId");
    this.participantSelector(actorInput, "actor");
    const conversation = await this.loadConversation(scopedCompanyId, scopedConversationId);
    if (!conversation) {
      throw new Error(`conversation not found: ${scopedConversationId}`);
    }
    if (conversation.conversationKind !== "topic" && conversation.conversationKind !== "direct") {
      throw new Error("restore requires a topic or direct conversation");
    }
    const actor = this.requireParticipant(conversation, actorInput, "actor");
    const timestamp = this.now();
    const nextConversation: ConversationDto = {
      ...conversation,
      ...(conversation.conversationKind === "topic" && conversation.topic
        ? { topic: { ...conversation.topic, status: "open" as const, updatedAt: timestamp } }
        : {
            participantStates: this.normalizedParticipantStates(conversation, timestamp).map((state) => {
              if (state.participantId !== actor.participantId) return state;
              const { archivedAt: _archivedAt, ...restoredState } = state;
              return { ...restoredState, updatedAt: timestamp };
            }),
          }),
      realtimeSequence: nextConversationRealtimeSequence(conversation.realtimeSequence),
      updatedAt: timestamp,
    };
    await this.repository.upsertConversation({ conversation: nextConversation });
    return publicConversation(nextConversation);
  }

  private conversationFromInput(
    companyId: string,
    conversationId: string,
    input: MessageServiceCreateConversationInput,
    timestamp: string,
  ): ConversationDto {
    const participants = input.participants.map((participant, index): ConversationParticipantDto => {
      const rawParticipant = participant as { employeeId?: unknown; participantKind?: unknown };
      if (rawParticipant.employeeId !== undefined || rawParticipant.participantKind === "employee") {
        throw new Error(`participants[${index}].memberId is required; employeeId is not accepted`);
      }
      return {
        schema: PARTICIPANT_DTO_SCHEMA,
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        companyId,
        conversationId,
        participantId: this.createId("participant"),
        participantKind: participant.participantKind,
        memberId: trimRequired(participant.memberId, `participants[${index}].memberId`),
        displayName: trimRequired(participant.displayName, `participants[${index}].displayName`),
        role: participant.role,
        joinedAt: timestamp,
      };
    });
    return {
      schema: CONVERSATION_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      title: trimRequired(input.title, "title"),
      titleStatus: this.titleStatus(input.titleStatus || "manual"),
      titleSourceMessageId: input.titleSourceMessageId ? trimRequired(input.titleSourceMessageId, "titleSourceMessageId") : undefined,
      titleFailureReason: input.titleFailureReason ? trimRequired(input.titleFailureReason, "titleFailureReason") : undefined,
      conversationKind: input.conversationKind,
      topic: input.topic ? {
        schema: CONVERSATION_TOPIC_STATE_DTO_SCHEMA,
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        companyId,
        conversationId,
        topicId: trimRequired(input.topic.topicId || this.createId("topic"), "topicId"),
        chatChannelId: input.topic.chatChannelId ? trimRequired(input.topic.chatChannelId, "topic.chatChannelId") : undefined,
        title: trimRequired(input.topic.title || input.title, "topic.title"),
        status: input.topic.status || "open",
        ownerParticipantId: input.topic.ownerParticipantId,
        participantIds: participants.map((participant) => participant.participantId),
        createdAt: timestamp,
        updatedAt: timestamp,
      } : undefined,
      participants,
      participantStates: this.initialParticipantStates(companyId, conversationId, participants, timestamp),
      runtimeLinks: (input.runtimeLinks || []).map((link) => this.runtimeLink(companyId, conversationId, undefined, link, timestamp)),
      realtimeSequence: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private titleStatus(status: ConversationTitleStatus): ConversationTitleStatus {
    if (!["placeholder", "generated", "manual", "failed"].includes(status)) {
      throw new Error(`conversation titleStatus must be one of placeholder, generated, manual, failed, got ${String(status)}`);
    }
    return status;
  }

  private async messageFromInput(
    companyId: string,
    conversationId: string,
    sender: ConversationParticipantDto,
    messageId: string,
    body: string,
    options: MessageServiceSendMessageOptions,
    conversation: ConversationDto,
    timestamp: string,
  ): Promise<MessageDto> {
    const attachments = await this.messageAttachments(companyId, conversationId, messageId, options, timestamp);
    const trimmedBody = body.trim();
    if (!trimmedBody && attachments.length === 0) {
      throw new Error("message body or attachmentIds is required");
    }
    return {
      schema: MESSAGE_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      messageId,
      sender: {
        participantId: sender.participantId,
        participantKind: sender.participantKind,
        memberId: sender.memberId,
        displayName: sender.displayName,
      },
      body: trimmedBody,
      mentions: this.messageMentions(companyId, conversationId, messageId, conversation, options.mentionedMemberIds || [], timestamp),
      attachments,
      runtimeLinks: (options.runtimeLinks || []).map((link) => this.runtimeLink(companyId, conversationId, messageId, link, timestamp)),
      createdAt: timestamp,
      updatedAt: timestamp,
      deliveryState: "sent",
    };
  }

  private conversationAfterMessage(
    conversation: ConversationDto,
    senderParticipantId: string,
    message: MessageDto,
    timestamp: string,
    options: MessageServiceSendMessageOptions,
  ): ConversationDto {
    const requestedOwnerId = options.topicOwnerId
      ? trimRequired(options.topicOwnerId, "topicOwnerId")
      : undefined;
    if (requestedOwnerId && !conversation.topic) {
      throw new Error("topicOwnerId requires a Topic conversation");
    }
    const requestedOwner = requestedOwnerId
      ? conversation.participants.find((participant) =>
          participant.memberId === requestedOwnerId || participant.participantId === requestedOwnerId
        )
      : undefined;
    if (requestedOwnerId && !requestedOwner) {
      throw new Error(`topic owner is not a participant in conversation ${conversation.conversationId}: ${requestedOwnerId}`);
    }
    const topic = conversation.topic
      ? {
          ...conversation.topic,
          ownerParticipantId: requestedOwner?.participantId
            ?? (conversation.topic.ownerParticipantId === senderParticipantId ? undefined : conversation.topic.ownerParticipantId),
          updatedAt: timestamp,
        }
      : undefined;
    return {
      ...conversation,
      topic,
      lastMessageId: message.messageId,
      participantStates: this.participantStatesAfterMessage(conversation, senderParticipantId, message.messageId, message.mentions, timestamp),
      runtimeLinks: [...(conversation.runtimeLinks || []), ...(message.runtimeLinks || [])],
      realtimeSequence: nextConversationRealtimeSequence(conversation.realtimeSequence),
      updatedAt: timestamp,
    };
  }

  private async messageAttachments(
    companyId: string,
    conversationId: string,
    messageId: string,
    options: MessageServiceSendMessageOptions,
    createdAt: string,
  ) {
    const explicitAttachments = options.attachments || [];
    const attachmentIds = options.attachmentIds || [];
    if (attachmentIds.length > 0 && !this.attachmentResolver) {
      throw new Error("Chat attachment resolver is required when sending attachmentIds");
    }
    const resolvedAttachments = attachmentIds.length > 0
      ? await this.attachmentResolver?.listAttachments(companyId, [...new Set(attachmentIds)])
      : [];
    const byId = new Map([
      ...explicitAttachments.map((attachment) => [attachment.attachmentId, attachment] as const),
      ...(resolvedAttachments || []).map((attachment) => [attachment.attachmentId, attachment] as const),
    ]);
    return [...new Set([...attachmentIds, ...explicitAttachments.map((attachment) => attachment.attachmentId)])]
      .map((attachmentId) => {
        const attachment = byId.get(attachmentId);
        if (!attachment) {
          throw new Error(`Chat attachment not found: ${attachmentId}`);
        }
        return {
          schema: ATTACHMENT_DTO_SCHEMA,
          version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
          companyId,
          conversationId,
          messageId,
          attachmentId,
          fileName: attachment.fileName || attachmentId,
          mimeType: attachment.mimeType || "application/octet-stream",
          byteLength: attachment.byteLength ?? 0,
          downloadUrl: attachment.downloadUrl,
          previewUrl: attachment.previewUrl,
          storageKey: attachment.storageKey,
          contentSha256: attachment.contentSha256,
          metadata: attachment.metadata,
          createdAt,
        };
      });
  }

  private messageMentions(
    companyId: string,
    conversationId: string,
    messageId: string,
    conversation: ConversationDto,
    mentionedMemberIds: CompanyMemberId[],
    createdAt: string,
  ) {
    const uniqueMemberIds = new Set(mentionedMemberIds.map((memberId) => trimRequired(memberId, "mentionedMemberId")));
    return conversation.participants
      .filter((participant): participant is ConversationParticipantDto & { memberId: string } =>
        Boolean(participant.memberId && uniqueMemberIds.has(participant.memberId))
      )
      .map((participant) => ({
        schema: MESSAGE_MENTION_DTO_SCHEMA,
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        companyId,
        conversationId,
        messageId,
        participantId: participant.participantId,
        memberId: participant.memberId,
        createdAt,
      }));
  }

  private messageCreatedEvent(
    companyId: string,
    conversationId: string,
    messageId: string,
    actorMemberId: string | undefined,
    occurredAt: string,
    sequence: number,
  ): ConversationMessageRealtimeEvent<MessageCreatedRealtimePayload> {
    return createConversationMessageRealtimeEvent<MessageCreatedRealtimePayload>({
      eventId: this.createId("realtime-event"),
      type: "message.created",
      occurredAt,
      sequence,
      companyId,
      conversationId,
      messageId,
      actorMemberId,
      payload: {
        deliveryState: "sent",
      },
    });
  }

  private runtimeLink(
    companyId: string,
    conversationId: string,
    messageId: string | undefined,
    input: MessageServiceRuntimeLinkInput,
    createdAt: string,
  ): ConversationRuntimeLinkDto {
    return {
      schema: CONVERSATION_RUNTIME_LINK_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      linkId: trimRequired(input.linkId || this.createId("runtime-link"), "runtimeLink.linkId"),
      targetKind: input.targetKind,
      targetId: trimRequired(input.targetId, "runtimeLink.targetId"),
      label: input.label,
      messageId,
      sourceMessageId: input.sourceMessageId ? trimRequired(input.sourceMessageId, "runtimeLink.sourceMessageId") : undefined,
      createdAt: input.createdAt || createdAt,
    };
  }

  private initialParticipantStates(
    companyId: string,
    conversationId: string,
    participants: ConversationParticipantDto[],
    updatedAt: string,
  ): ConversationParticipantStateDto[] {
    return participants.map((participant) => ({
      schema: CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      participantId: participant.participantId,
      memberId: participant.memberId,
      unreadCount: 0,
      mentionCount: 0,
      updatedAt,
    }));
  }

  private normalizedParticipantStates(conversation: ConversationDto, updatedAt: string): ConversationParticipantStateDto[] {
    const existing = new Map((conversation.participantStates || []).map((state) => [state.participantId, state]));
    return conversation.participants.map((participant) => ({
      schema: CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId: conversation.companyId,
      conversationId: conversation.conversationId,
      participantId: participant.participantId,
      memberId: participant.memberId,
      unreadCount: existing.get(participant.participantId)?.unreadCount ?? 0,
      mentionCount: existing.get(participant.participantId)?.mentionCount ?? 0,
      lastReadMessageId: existing.get(participant.participantId)?.lastReadMessageId,
      lastMentionMessageId: existing.get(participant.participantId)?.lastMentionMessageId,
      archivedAt: existing.get(participant.participantId)?.archivedAt,
      updatedAt: existing.get(participant.participantId)?.updatedAt || updatedAt,
    }));
  }

  private participantStatesAfterMessage(
    conversation: ConversationDto,
    senderParticipantId: string,
    messageId: string,
    mentions: Array<{ participantId: string }>,
    updatedAt: string,
  ): ConversationParticipantStateDto[] {
    const mentionedParticipantIds = new Set(mentions.map((mention) => mention.participantId));
    return this.normalizedParticipantStates(conversation, updatedAt).map((state) => {
      if (state.participantId === senderParticipantId) {
        return {
          ...state,
          archivedAt: undefined,
          lastReadMessageId: messageId,
          unreadCount: 0,
          updatedAt,
        };
      }
      const mentioned = mentionedParticipantIds.has(state.participantId);
      return {
        ...state,
        archivedAt: undefined,
        unreadCount: state.unreadCount + 1,
        mentionCount: state.mentionCount + (mentioned ? 1 : 0),
        lastMentionMessageId: mentioned ? messageId : state.lastMentionMessageId,
        updatedAt,
      };
    });
  }

  private async loadConversation(companyId: string, conversationId: string): Promise<ConversationDto | undefined> {
    const record = await this.repository.getConversation(companyId, conversationId);
    if (record) {
      ensureConversationCompanyScope({ companyId, resourceCompanyId: record.conversation.companyId });
      return {
        ...record.conversation,
        participantStates: record.conversation.participantStates || [],
        runtimeLinks: record.conversation.runtimeLinks || [],
        realtimeSequence: record.conversation.realtimeSequence ?? 0,
      };
    }
    const owningCompanyId = await this.repository.findConversationCompanyId(conversationId);
    if (owningCompanyId) {
      ensureConversationCompanyScope({ companyId, resourceCompanyId: owningCompanyId });
    }
    return undefined;
  }

  private firstMessageSender(input: {
    sender?: MessageServiceParticipantSelector;
  }): MessageServiceParticipantSelector {
    if (!input.sender) {
      throw new Error("sender.memberId is required");
    }
    return input.sender;
  }

  private participantSelector(input: MessageServiceParticipantSelector, fieldName: string): {
    participantId?: ParticipantId;
    memberId?: CompanyMemberId;
  } {
    if (typeof input === "string") {
      throw new Error(`${fieldName} memberId is required; employee string selectors are not accepted`);
    }
    const participantId = input.participantId ? trimRequired(input.participantId, `${fieldName}.participantId`) : undefined;
    const memberId = input.memberId ? trimRequired(input.memberId, `${fieldName}.memberId`) : undefined;
    const rawInput = input as { employeeId?: unknown; participantKind?: unknown };
    if (rawInput.employeeId !== undefined || rawInput.participantKind === "employee") {
      throw new Error(`${fieldName}.memberId is required; employeeId is not accepted`);
    }
    if (input.participantKind === "company_member" && !memberId) {
      throw new Error(`${fieldName}.memberId is required`);
    }
    if (!participantId && !memberId) {
      throw new Error(`${fieldName} participant identity is required`);
    }
    return { participantId, memberId };
  }

  private requireParticipant(
    conversation: ConversationDto,
    input: MessageServiceParticipantSelector,
    fieldName: string,
  ): ConversationParticipantDto {
    const selector = this.participantSelector(input, fieldName);
    const participant = conversation.participants.find((candidate) =>
      (selector.participantId !== undefined && candidate.participantId === selector.participantId) ||
      (selector.memberId !== undefined && candidate.memberId === selector.memberId)
    );
    if (!participant) {
      const identity = selector.participantId ?? selector.memberId;
      throw new Error(`${fieldName} ${identity} is not a participant in conversation ${conversation.conversationId}`);
    }
    return participant;
  }

}
