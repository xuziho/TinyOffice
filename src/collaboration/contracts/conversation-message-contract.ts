export const CONVERSATION_MESSAGE_CONTRACT_VERSION = 1 as const;
export const CONVERSATION_DTO_SCHEMA = "conversation" as const;
export const MESSAGE_DTO_SCHEMA = "message" as const;
export const PARTICIPANT_DTO_SCHEMA = "conversation-participant" as const;
export const ATTACHMENT_DTO_SCHEMA = "conversation-attachment" as const;
export const CONVERSATION_TOPIC_STATE_DTO_SCHEMA = "conversation-topic-state" as const;
export const CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA = "conversation-participant-state" as const;
export const CONVERSATION_RUNTIME_LINK_DTO_SCHEMA = "conversation-runtime-link" as const;
export const MESSAGE_MENTION_DTO_SCHEMA = "message-mention" as const;
export const CONVERSATION_MESSAGE_REALTIME_EVENT_SCHEMA = "conversation-message-realtime-event" as const;

export const FORBIDDEN_PUBLIC_CARRIER_FIELD_NAMES = [
  "team_id",
  "teamId",
  "carrierTeamId",
  "user_id",
  "userId",
  "providerUserId",
  "carrierUserId",
  "channel_id",
  "channelId",
  "carrierChannelId",
  "post_id",
  "postId",
  "carrierPostId",
  "root_id",
  "rootPostId",
  "carrierRootPostId",
] as const;

export const CONVERSATION_MESSAGE_REALTIME_SEQUENCE_START = 1 as const;

export const PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS = {
  conversation: [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "title",
    "titleStatus",
    "titleSourceMessageId",
    "titleFailureReason",
    "conversationKind",
    "topic",
    "participants",
    "participantStates",
    "lastMessageId",
    "runtimeLinks",
    "realtimeSequence",
    "createdAt",
    "updatedAt",
  ],
  message: [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "messageId",
    "sender",
    "body",
    "mentions",
    "attachments",
    "runtimeLinks",
    "runtimeUsage",
    "createdAt",
    "updatedAt",
    "deliveryState",
  ],
  participant: [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "participantId",
    "participantKind",
    "memberId",
    "displayName",
    "role",
    "joinedAt",
    "leftAt",
  ],
  attachment: [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "messageId",
    "attachmentId",
    "fileName",
    "mimeType",
    "byteLength",
    "downloadUrl",
    "previewUrl",
    "storageKey",
    "contentSha256",
    "metadata",
    "createdAt",
  ],
  topicState: [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "topicId",
    "chatChannelId",
    "title",
    "status",
    "ownerParticipantId",
    "participantIds",
    "summary",
    "createdAt",
    "updatedAt",
  ],
  participantState: [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "participantId",
    "memberId",
    "lastReadMessageId",
    "lastMentionMessageId",
    "archivedAt",
    "unreadCount",
    "mentionCount",
    "updatedAt",
  ],
  runtimeLink: [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "linkId",
    "targetKind",
    "targetId",
    "label",
    "messageId",
    "createdAt",
  ],
  mention: [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "messageId",
    "participantId",
    "memberId",
    "createdAt",
  ],
  realtimeEvent: [
    "schema",
    "version",
    "eventId",
    "type",
    "occurredAt",
    "sequence",
    "companyId",
    "conversationId",
    "messageId",
    "actorMemberId",
    "payload",
  ],
} as const;

export type CompanyId = string;
export type ConversationId = string;
export type EmployeeId = string;
export type CompanyMemberId = string;
export type MessageId = string;
export type AttachmentId = string;
export type ParticipantId = string;

export type ConversationKind = "direct" | "shared" | "topic";
export type ConversationParticipantKind = "company_member" | "system";
export type MessageDeliveryState = "pending" | "sent" | "failed" | "deleted";
export type ConversationTopicStatus = "open" | "waiting" | "resolved" | "archived";
export type ConversationRuntimeLinkTargetKind = "session" | "work_run" | "process_trace" | "session_event";
export type ConversationTitleStatus = "placeholder" | "generated" | "manual" | "failed";

export interface ConversationParticipantDto {
  schema: typeof PARTICIPANT_DTO_SCHEMA;
  version: typeof CONVERSATION_MESSAGE_CONTRACT_VERSION;
  companyId: CompanyId;
  conversationId: ConversationId;
  participantId: ParticipantId;
  participantKind: ConversationParticipantKind;
  memberId: CompanyMemberId;
  displayName: string;
  role?: string;
  joinedAt: string;
  leftAt?: string;
}

export interface ConversationAttachmentDto {
  schema: typeof ATTACHMENT_DTO_SCHEMA;
  version: typeof CONVERSATION_MESSAGE_CONTRACT_VERSION;
  companyId: CompanyId;
  conversationId: ConversationId;
  messageId: MessageId;
  attachmentId: AttachmentId;
  fileName: string;
  mimeType: string;
  byteLength: number;
  downloadUrl?: string;
  previewUrl?: string;
  storageKey?: string;
  contentSha256?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ConversationTopicStateDto {
  schema: typeof CONVERSATION_TOPIC_STATE_DTO_SCHEMA;
  version: typeof CONVERSATION_MESSAGE_CONTRACT_VERSION;
  companyId: CompanyId;
  conversationId: ConversationId;
  topicId: string;
  chatChannelId?: string;
  title: string;
  status: ConversationTopicStatus;
  ownerParticipantId?: ParticipantId;
  participantIds: ParticipantId[];
  summary?: {
    text: string;
    sourceMessageId?: MessageId;
    updatedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ConversationParticipantStateDto {
  schema: typeof CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA;
  version: typeof CONVERSATION_MESSAGE_CONTRACT_VERSION;
  companyId: CompanyId;
  conversationId: ConversationId;
  participantId: ParticipantId;
  memberId: CompanyMemberId;
  lastReadMessageId?: MessageId;
  lastMentionMessageId?: MessageId;
  archivedAt?: string;
  unreadCount: number;
  mentionCount: number;
  updatedAt: string;
}

export interface ConversationRuntimeLinkDto {
  schema: typeof CONVERSATION_RUNTIME_LINK_DTO_SCHEMA;
  version: typeof CONVERSATION_MESSAGE_CONTRACT_VERSION;
  companyId: CompanyId;
  conversationId: ConversationId;
  linkId: string;
  targetKind: ConversationRuntimeLinkTargetKind;
  targetId: string;
  label?: string;
  messageId?: MessageId;
  sourceMessageId?: MessageId;
  createdAt: string;
}

export interface MessageMentionDto {
  schema: typeof MESSAGE_MENTION_DTO_SCHEMA;
  version: typeof CONVERSATION_MESSAGE_CONTRACT_VERSION;
  companyId: CompanyId;
  conversationId: ConversationId;
  messageId: MessageId;
  participantId: ParticipantId;
  memberId: CompanyMemberId;
  createdAt: string;
}

export interface ConversationDto {
  schema: typeof CONVERSATION_DTO_SCHEMA;
  version: typeof CONVERSATION_MESSAGE_CONTRACT_VERSION;
  companyId: CompanyId;
  conversationId: ConversationId;
  title: string;
  titleStatus?: ConversationTitleStatus;
  titleSourceMessageId?: MessageId;
  titleFailureReason?: string;
  conversationKind: ConversationKind;
  topic?: ConversationTopicStateDto;
  participants: ConversationParticipantDto[];
  participantStates: ConversationParticipantStateDto[];
  lastMessageId?: MessageId;
  runtimeLinks: ConversationRuntimeLinkDto[];
  realtimeSequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageSenderDto {
  participantId: ParticipantId;
  participantKind: ConversationParticipantKind;
  memberId: CompanyMemberId;
  displayName: string;
}

export interface ConversationRuntimeUsageDto {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

export interface MessageDto {
  schema: typeof MESSAGE_DTO_SCHEMA;
  version: typeof CONVERSATION_MESSAGE_CONTRACT_VERSION;
  companyId: CompanyId;
  conversationId: ConversationId;
  messageId: MessageId;
  sender: MessageSenderDto;
  body: string;
  mentions: MessageMentionDto[];
  attachments: ConversationAttachmentDto[];
  runtimeLinks: ConversationRuntimeLinkDto[];
  runtimeUsage?: ConversationRuntimeUsageDto;
  createdAt: string;
  updatedAt?: string;
  deliveryState: MessageDeliveryState;
}

export type ConversationMessageRealtimeEventType =
  | "conversation.created"
  | "conversation.updated"
  | "participant.joined"
  | "participant.left"
  | "message.created"
  | "message.updated"
  | "message.deleted"
  | "attachment.added"
  | "participant.read_state.updated"
  | "participant.mention_state.updated"
  | "conversation.runtime_link.added";

export interface ConversationMessageRealtimeEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  schema: typeof CONVERSATION_MESSAGE_REALTIME_EVENT_SCHEMA;
  version: typeof CONVERSATION_MESSAGE_CONTRACT_VERSION;
  eventId: string;
  type: ConversationMessageRealtimeEventType;
  occurredAt: string;
  sequence: number;
  companyId: CompanyId;
  conversationId: ConversationId;
  messageId?: MessageId;
  actorMemberId?: CompanyMemberId;
  payload: TPayload;
}

export type MessageCreatedRealtimePayload = {
  deliveryState: MessageDeliveryState;
};

export type ParticipantReadStateUpdatedRealtimePayload = {
  participantId: ParticipantId;
  lastReadMessageId?: MessageId;
  unreadCount: number;
  mentionCount: number;
};

export type CreateConversationMessageRealtimeEventInput<
  TPayload extends Record<string, unknown>,
> = Omit<ConversationMessageRealtimeEvent<TPayload>, "schema" | "version">;

export function createConversationMessageRealtimeEvent<
  TPayload extends Record<string, unknown>,
>(
  input: CreateConversationMessageRealtimeEventInput<TPayload>,
): ConversationMessageRealtimeEvent<TPayload> {
  const event = {
    schema: CONVERSATION_MESSAGE_REALTIME_EVENT_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    ...input,
  };
  assertConversationMessageRealtimeEventBoundary(event);
  return event;
}

export function nextConversationRealtimeSequence(currentSequence: number | undefined): number {
  const current = currentSequence ?? 0;
  if (!Number.isInteger(current) || current < 0) {
    throw new Error(`conversation realtimeSequence must be a non-negative integer, got ${currentSequence}`);
  }
  return current + 1;
}

export function assertConversationMessageRealtimeEventBoundary(
  event: ConversationMessageRealtimeEvent,
): asserts event is ConversationMessageRealtimeEvent {
  ensureConversationCompanyScope({ companyId: event.companyId });
  if (!event.eventId.trim()) {
    throw new Error("eventId is required for Conversation realtime events");
  }
  if (!event.conversationId.trim()) {
    throw new Error("conversationId is required for Conversation realtime events");
  }
  if (!Number.isInteger(event.sequence) || event.sequence < CONVERSATION_MESSAGE_REALTIME_SEQUENCE_START) {
    throw new Error(`sequence must be a monotonic positive integer, got ${event.sequence}`);
  }
  assertNoForbiddenPublicCarrierFields(event);
}

export function assertNoForbiddenPublicCarrierFields(value: unknown): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForbiddenPublicCarrierFields(item);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if ((FORBIDDEN_PUBLIC_CARRIER_FIELD_NAMES as readonly string[]).includes(key)) {
      throw new Error(`public Conversation contract contains forbidden carrier field: ${key}`);
    }
    assertNoForbiddenPublicCarrierFields(child);
  }
}

export interface ConversationCompanyScopeInput {
  companyId: CompanyId;
  resourceCompanyId?: CompanyId;
}

export function ensureConversationCompanyScope(input: ConversationCompanyScopeInput): CompanyId {
  const companyId = input.companyId.trim();
  if (!companyId) {
    throw new Error("explicit companyId is required for Conversation / Message access");
  }
  if (input.resourceCompanyId !== undefined && input.resourceCompanyId !== companyId) {
    throw new Error(`companyId mismatch: requested ${companyId} but resource belongs to ${input.resourceCompanyId}`);
  }
  return companyId;
}

export interface ConversationServicePageInput {
  companyId: CompanyId;
  cursor?: string;
  limit?: number;
}

export interface CreateConversationInput {
  companyId: CompanyId;
  title: string;
  conversationKind: ConversationKind;
  topic?: {
    topicId?: string;
    chatChannelId?: string;
    title?: string;
    status?: ConversationTopicStatus;
    ownerParticipantId?: ParticipantId;
  };
  runtimeLinks?: ConversationRuntimeLinkDto[];
  participants: Array<{
    participantKind: ConversationParticipantKind;
    memberId: CompanyMemberId;
    displayName: string;
    role?: string;
  }>;
}

export interface ConversationLookupInput {
  companyId: CompanyId;
  conversationId: ConversationId;
}

export interface MessageListInput extends ConversationLookupInput {
  cursor?: string;
  limit?: number;
}

export interface ConversationReadStateInput extends ConversationLookupInput {
  viewerMemberId?: CompanyMemberId;
  viewerParticipantId?: ParticipantId;
  lastReadMessageId?: MessageId;
}

export interface SendMessageInput extends ConversationLookupInput {
  actorMemberId?: CompanyMemberId;
  actorParticipantId?: ParticipantId;
  body: string;
  attachmentIds?: AttachmentId[];
  attachments?: Array<Partial<ConversationAttachmentDto> & { attachmentId: AttachmentId }>;
  mentionedMemberIds?: CompanyMemberId[];
  runtimeLinks?: Array<{
    linkId?: string;
    targetKind: ConversationRuntimeLinkTargetKind;
    targetId: string;
    label?: string;
    sourceMessageId?: MessageId;
    createdAt?: string;
  }>;
}

export interface ConversationPage {
  conversations: ConversationDto[];
  nextCursor?: string;
}

export interface MessagePage {
  messages: MessageDto[];
  nextCursor?: string;
}

export interface SendMessageResult {
  message: MessageDto;
  realtimeEvent: ConversationMessageRealtimeEvent;
  conversation: ConversationDto;
}

export interface MarkConversationReadResult {
  conversation: ConversationDto;
  realtimeEvent: ConversationMessageRealtimeEvent;
}

export interface ConversationMessageService {
  createConversation(input: CreateConversationInput): Promise<ConversationDto>;
  listConversations(input: ConversationServicePageInput): Promise<ConversationPage>;
  getConversation(input: ConversationLookupInput): Promise<ConversationDto | undefined>;
  listMessages(input: MessageListInput): Promise<MessagePage>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  markConversationRead(input: ConversationReadStateInput): Promise<MarkConversationReadResult>;
}
