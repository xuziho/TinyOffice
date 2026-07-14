import {
  assertNoForbiddenPublicCarrierFields,
  type ConversationAttachmentDto,
  type ConversationDto,
  type MessageDto,
} from "../../collaboration/contracts/conversation-message-contract.js";
import {
  assertChatParticipantAccess,
  isChatParticipantAllowed,
} from "../../collaboration/chat/chat-permissions.js";
import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import type {
  TinyOfficeChatTurnDispatchReady,
  TinyOfficeChatTurnDispatchReason,
  TinyOfficeChatTurnDispatchSceneType,
  TinyOfficeChatTurnDispatchSource,
} from "./tinyoffice-chat-dispatch-decision.js";
import { uniqueStrings, trimRequired } from "./tinyoffice-chat-turn-utils.js";

export interface TinyOfficeChatRoomContextResolver {
  getConversation(companyId: string, roomId: string): Promise<ConversationDto | undefined>;
  listRecentMessages(
    companyId: string,
    roomId: string,
    cursor?: { limit?: number },
  ): Promise<{ messages: MessageDto[] }>;
  listMessagesAfter?(
    companyId: string,
    roomId: string,
    cursor: TinyOfficeChatTopicContextCursor,
  ): Promise<{ messages: MessageDto[] }>;
}

export interface TinyOfficeChatParticipantProfile {
  id: string;
  displayName?: string;
  role?: string;
  summary?: string;
  runtimeCapable?: boolean;
}

export interface TinyOfficeChatRoomContextMessage {
  messageId: string;
  conversationId: string;
  roomId: string;
  senderMemberId?: string;
  senderDisplayName: string;
  body: string;
  mentionedMemberIds: string[];
  imageAttachments: TinyOfficeChatRoomContextImageAttachment[];
  createdAt: string;
  deliveryState: MessageDto["deliveryState"];
}

export interface TinyOfficeChatRoomContextImageAttachment {
  attachmentId: string;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
  previewUrl?: string;
  downloadUrl?: string;
  storageKey?: string;
  contentSha256?: string;
}

export interface TinyOfficeChatTopicContextCursor {
  messageId: string;
  createdAt: string;
}

export interface TinyOfficeChatTopicContextWindow {
  mode: "initial" | "incremental";
  cursor?: TinyOfficeChatTopicContextCursor;
  messages: TinyOfficeChatRoomContextMessage[];
  lastMessageId?: string;
  lastCreatedAt?: string;
}

export interface TinyOfficeChatRoomContext {
  kind: "owned_chat_room_context";
  executionState: "context_only";
  companyId: string;
  employeeId: string;
  actorMemberId?: string;
  targetMemberId: string;
  conversationId: string;
  roomId: string;
  entryId?: string;
  messageId: string;
  source: TinyOfficeChatTurnDispatchSource;
  reason: TinyOfficeChatTurnDispatchReason;
  sceneType: TinyOfficeChatTurnDispatchSceneType;
  sessionKey: string;
  preferredLanguage: string;
  prefersChinese: boolean;
  conversation: {
    conversationId: string;
    roomId: string;
    title: string;
    conversationKind: ConversationDto["conversationKind"];
    topicId?: string;
    topicTitle?: string;
    runtimeParticipantIds: string[];
    handoffCandidates: ParticipantRef[];
    topicSummary?: {
      text: string;
      sourceMessageId?: string;
      updatedAt: string;
    };
  };
  currentMessage: TinyOfficeChatRoomContextMessage | undefined;
  imageInputMessageIds: string[];
  recentMessages: TinyOfficeChatRoomContextMessage[];
  topicContextWindow: TinyOfficeChatTopicContextWindow;
  nonGoals: {
    runsModelExecution: false;
    persistsEmployeeReply: false;
  };
}

export async function assembleTinyOfficeChatRoomContext(input: {
  decision: TinyOfficeChatTurnDispatchReady;
  resolver: TinyOfficeChatRoomContextResolver;
  participantProfiles?: Iterable<TinyOfficeChatParticipantProfile>;
  recentMessageLimit?: number;
  priorTopicContextCursor?: TinyOfficeChatTopicContextCursor;
}): Promise<TinyOfficeChatRoomContext> {
  assertNoForbiddenPublicCarrierFields(input.decision);
  const companyId = trimRequired(input.decision.companyId, "companyId");
  const roomId = trimRequired(input.decision.roomId, "roomId");
  const recentMessageLimit = normalizeRecentMessageLimit(input.recentMessageLimit);
  const conversation = await input.resolver.getConversation(companyId, roomId);
  if (!conversation) {
    throw new Error(`Chat room context conversation not found: ${roomId}`);
  }
  assertNoForbiddenPublicCarrierFields(conversation);
  assertConversationScope(conversation, companyId, roomId);
  assertRuntimeContextAccess(conversation, input.decision);

  let page: { messages: MessageDto[] };
  if (input.priorTopicContextCursor) {
    if (!input.resolver.listMessagesAfter) {
      throw new Error("Incremental Topic context requires listMessagesAfter cursor support.");
    }
    page = await input.resolver.listMessagesAfter(
      companyId,
      roomId,
      normalizeTopicContextCursor(input.priorTopicContextCursor),
    );
  } else {
    page = await input.resolver.listRecentMessages(companyId, roomId, { limit: recentMessageLimit });
  }
  assertNoForbiddenPublicCarrierFields(page);
  const recentMessages = page.messages
    .filter((message) => message.companyId === companyId && message.conversationId === roomId)
    .sort(compareMessagesForPromptContext)
    .map(messageForPromptContext);
  const topicContextWindow = buildTopicContextWindow({
    messages: recentMessages,
    priorCursor: input.priorTopicContextCursor,
  });

  const runtimeParticipantIds = runtimeCapableParticipantIds(conversation, input.participantProfiles);
  const currentMessage = recentMessages.find((message) => message.messageId === input.decision.messageId);
  const imageInputMessageIds = uniqueStrings([
    ...(input.decision.inheritedImageMessageIds || []),
    ...(currentMessage?.imageAttachments.length ? [currentMessage.messageId] : []),
  ]);
  const context: TinyOfficeChatRoomContext = {
    kind: "owned_chat_room_context",
    executionState: "context_only",
    companyId,
    employeeId: input.decision.targetMemberId,
    actorMemberId: input.decision.actorMemberId,
    targetMemberId: input.decision.targetMemberId,
    conversationId: conversation.conversationId,
    roomId,
    ...(input.decision.entryId ? { entryId: input.decision.entryId } : {}),
    messageId: input.decision.messageId,
    source: input.decision.source,
    reason: input.decision.reason,
    sceneType: input.decision.sceneType,
    sessionKey: input.decision.sessionKey,
    preferredLanguage: input.decision.preferredLanguage,
    prefersChinese: input.decision.prefersChinese,
    conversation: {
      conversationId: conversation.conversationId,
      roomId,
      title: conversation.title,
      conversationKind: conversation.conversationKind,
      topicId: conversation.topic?.topicId,
      topicTitle: conversation.topic?.title,
      runtimeParticipantIds,
      handoffCandidates: handoffCandidates(conversation, {
        participantProfiles: input.participantProfiles,
        runtimeParticipantIds,
        currentMemberId: input.decision.targetMemberId,
      }),
      topicSummary: conversation.topic?.summary ? { ...conversation.topic.summary } : undefined,
    },
    currentMessage,
    imageInputMessageIds,
    recentMessages,
    topicContextWindow,
    // This slice only prepares prompt context; later issues own model execution and reply persistence.
    nonGoals: {
      runsModelExecution: false,
      persistsEmployeeReply: false,
    },
  };
  assertNoForbiddenPublicCarrierFields(context);
  return context;
}

export function formatTinyOfficeChatTopicContextForExecution(context: TinyOfficeChatRoomContext): string {
  const candidateLines = context.conversation.handoffCandidates.length > 0
    ? context.conversation.handoffCandidates.map((participant) => {
      const label = participant.displayName
        ? `${participant.displayName} (${participant.id})`
        : participant.id;
      const details = [
        participant.role ? `role=${participant.role}` : undefined,
        participant.summary ? `summary=${participant.summary}` : undefined,
      ].filter(Boolean);
      return details.length > 0 ? `- ${label}: ${details.join("; ")}` : `- ${label}`;
    })
    : ["- none"];
  const currentMessageBody = context.currentMessage?.body.trim();
  const conversationTitle = context.conversation.title.trim();
  const repeatsCurrentMessage = Boolean(
    currentMessageBody &&
    (conversationTitle === currentMessageBody ||
      (conversationTitle.length >= 40 && currentMessageBody.startsWith(conversationTitle))),
  );
  const lines = [
    `- companyId: ${context.companyId}`,
    `- roomId: ${context.roomId}`,
    `- conversationId: ${context.conversationId}`,
    `- sceneType: ${context.sceneType}`,
    ...(context.actorMemberId ? [`- actorMemberId: ${context.actorMemberId}`] : []),
    `- targetMemberId: ${context.targetMemberId}`,
    `- messageId: ${context.messageId}`,
    ...(context.entryId ? [`- entryId: ${context.entryId}`] : []),
    `- conversationKind: ${context.conversation.conversationKind}`,
    ...(conversationTitle && !repeatsCurrentMessage
      ? [`- title: ${conversationTitle}`]
      : []),
    "",
    "Handoff candidates:",
    ...candidateLines,
    "",
    ...(context.conversation.topicSummary
      ? [
        "",
        "Topic summary:",
        `- updatedAt: ${context.conversation.topicSummary.updatedAt}`,
        ...(context.conversation.topicSummary.sourceMessageId
          ? [`- sourceMessageId: ${context.conversation.topicSummary.sourceMessageId}`]
          : []),
        context.conversation.topicSummary.text,
      ]
      : []),
    "",
    context.topicContextWindow.mode === "incremental"
      ? "New raw messages since previous Topic context:"
      : "Latest raw messages:",
    ...context.topicContextWindow.messages.map((message) => {
      const sender = message.senderMemberId
        ? `${message.senderDisplayName} (${message.senderMemberId})`
        : message.senderDisplayName;
      const mentions = message.mentionedMemberIds.length > 0
        ? ` mentions=${message.mentionedMemberIds.join(",")}`
        : "";
      const imageAttachments = message.imageAttachments.length > 0
        ? `\n  Image attachments:\n${message.imageAttachments.map((attachment) =>
            `  - ${attachment.fileName} (${attachment.mimeType}, attachmentId=${attachment.attachmentId})`
          ).join("\n")}`
        : "";
      const trigger = message.messageId === context.messageId ? "[trigger] " : "";
      return `- ${trigger}[${message.createdAt}] ${sender}${mentions}: ${message.body}${imageAttachments}`;
    }),
  ];
  return lines.join("\n");
}

function normalizeRecentMessageLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 20;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`recentMessageLimit must be a positive integer, got ${limit}`);
  }
  return Math.min(limit, 100);
}

function buildTopicContextWindow(input: {
  messages: TinyOfficeChatRoomContextMessage[];
  priorCursor?: TinyOfficeChatTopicContextCursor;
}): TinyOfficeChatTopicContextWindow {
  const messages = input.messages;
  const last = messages.at(-1);
  return {
    mode: input.priorCursor ? "incremental" : "initial",
    ...(input.priorCursor ? { cursor: normalizeTopicContextCursor(input.priorCursor) } : {}),
    messages,
    ...(last
      ? {
          lastMessageId: last.messageId,
          lastCreatedAt: last.createdAt,
        }
      : {}),
  };
}

function normalizeTopicContextCursor(cursor: TinyOfficeChatTopicContextCursor): TinyOfficeChatTopicContextCursor {
  return {
    messageId: trimRequired(cursor.messageId, "priorTopicContextCursor.messageId"),
    createdAt: trimRequired(cursor.createdAt, "priorTopicContextCursor.createdAt"),
  };
}

function compareMessagesForPromptContext(left: MessageDto, right: MessageDto): number {
  return left.createdAt.localeCompare(right.createdAt) ||
    left.messageId.localeCompare(right.messageId);
}

function messageForPromptContext(message: MessageDto): TinyOfficeChatRoomContextMessage {
  return {
    messageId: message.messageId,
    conversationId: message.conversationId,
    roomId: message.conversationId,
    senderMemberId: message.sender.memberId,
    senderDisplayName: message.sender.displayName,
    body: message.body,
    mentionedMemberIds: uniqueStrings(
      message.mentions
        .map((mention) => mention.memberId)
        .filter((memberId): memberId is string => Boolean(memberId)),
    ),
    imageAttachments: message.attachments
      .filter(isSupportedRuntimeImageAttachment)
      .map((attachment) => ({
        attachmentId: attachment.attachmentId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        byteLength: attachment.byteLength,
        ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
        ...(attachment.downloadUrl ? { downloadUrl: attachment.downloadUrl } : {}),
        ...(attachment.storageKey ? { storageKey: attachment.storageKey } : {}),
        ...(attachment.contentSha256 ? { contentSha256: attachment.contentSha256 } : {}),
      })),
    createdAt: message.createdAt,
    deliveryState: message.deliveryState,
  };
}

type SupportedRuntimeImageAttachment = ConversationAttachmentDto & {
  mimeType: TinyOfficeChatRoomContextImageAttachment["mimeType"];
};

function isSupportedRuntimeImageAttachment(attachment: ConversationAttachmentDto): attachment is SupportedRuntimeImageAttachment {
  return isSupportedRuntimeImageMimeType(attachment.mimeType);
}

function isSupportedRuntimeImageMimeType(value: string): value is TinyOfficeChatRoomContextImageAttachment["mimeType"] {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp";
}

function handoffCandidates(
  conversation: Pick<ConversationDto, "participants">,
  input: {
    participantProfiles?: Iterable<TinyOfficeChatParticipantProfile>;
    runtimeParticipantIds: string[];
    currentMemberId: string;
  },
): TinyOfficeChatRoomContext["conversation"]["handoffCandidates"] {
  const refs: TinyOfficeChatRoomContext["conversation"]["handoffCandidates"] = [];
  const profilesById = new Map<string, TinyOfficeChatParticipantProfile>();
  for (const profile of input.participantProfiles || []) {
    profilesById.set(profile.id, profile);
  }
  const runtimeParticipantIds = new Set(input.runtimeParticipantIds);
  for (const participant of conversation.participants) {
    const id = participant.memberId || participant.participantId;
    if (!id) {
      continue;
    }
    if (id === input.currentMemberId) {
      continue;
    }
    const profile = profilesById.get(id);
    const runtimeCapable = Boolean(profile?.runtimeCapable) || runtimeParticipantIds.has(id);
    const participantRole = participant.role?.trim();
    const role = profile?.role || participantRole || undefined;
    refs.push({
      id,
      participantKind: participant.participantKind,
      ...(profile?.displayName || participant.displayName
        ? { displayName: profile?.displayName || participant.displayName }
        : {}),
      ...(role ? { role } : {}),
      ...(profile?.summary ? { summary: profile.summary } : {}),
      runtimeCapable,
    });
  }
  return refs;
}

function runtimeCapableParticipantIds(
  conversation: Pick<ConversationDto, "participants">,
  participantProfiles?: Iterable<TinyOfficeChatParticipantProfile>,
): string[] {
  const runtimeProfileIds = new Set<string>();
  for (const profile of participantProfiles || []) {
    if (profile.runtimeCapable) {
      runtimeProfileIds.add(profile.id.trim());
    }
  }
  return uniqueStrings(
    conversation.participants
      .map((participant) => {
        if (participant.memberId && runtimeProfileIds.has(participant.memberId)) {
          return participant.memberId;
        }
        return undefined;
      })
      .filter((id): id is string => Boolean(id)),
  );
}

function assertRuntimeContextAccess(
  conversation: Pick<ConversationDto, "conversationId" | "participants">,
  decision: TinyOfficeChatTurnDispatchReady,
): void {
  const actorIdentities = [
    decision.actorMemberId ? { memberId: decision.actorMemberId } : undefined,
  ].filter((identity): identity is { memberId: string } => Boolean(identity));
  if (actorIdentities.length > 0 && !actorIdentities.some((identity) => isChatParticipantAllowed(conversation, identity))) {
    assertChatParticipantAccess(conversation, actorIdentities[0], "actor");
  }
  const targetMemberId = trimRequired(decision.targetMemberId, "targetMemberId");
  if (!isChatParticipantAllowed(conversation, { memberId: targetMemberId })) {
    assertChatParticipantAccess(conversation, { memberId: targetMemberId }, "targetMember");
  }
}

function assertConversationScope(
  conversation: Pick<ConversationDto, "companyId" | "conversationId">,
  companyId: string,
  roomId: string,
): void {
  if (conversation.companyId !== companyId) {
    throw new Error("Chat dispatch conversation companyId mismatch");
  }
  if (conversation.conversationId !== roomId) {
    throw new Error("Chat dispatch conversation roomId mismatch");
  }
}
