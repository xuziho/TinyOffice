import { assertChatProjectionBoundary, normalizeChatViewerIdentity, type ChatParticipantIdentitySelector, type ChatProjectionPage } from "../../collaboration/chat/chat-projection-service.js";
import { assertChatParticipantAccess, isChatParticipantAllowed, type ChatAccessIdentity } from "../../collaboration/chat/chat-permissions.js";
import { assertChatEntryContractBoundary } from "../../collaboration/contracts/chat-entry-contract.js";
import type { ChatCreateEntryInput, ChatCreateEntryResponse } from "../../collaboration/chat/chat-create-entry-service.js";
import type { ChatDispatchApiEvent, ChatDispatchApiSink, ChatRoomMessageApiService } from "../../collaboration/api/chat-projection-api-routes.js";
import type { ConversationApiMessageService } from "../../collaboration/api/conversation-api-service.js";
import type { ConversationDto } from "../../collaboration/contracts/conversation-message-contract.js";
import type { TinyOfficeRealtimePublisher } from "../../collaboration/contracts/tinyoffice-realtime-contract.js";
import type { MessageServiceParticipantSelector, MessageServiceSendMessageOptions } from "../../collaboration/message/message-service.js";
import { resolveChatRoomMessageService } from "./service-resolvers.js";
import type { TinyOfficeApiOptions } from "./contracts.js";
import { chatAccessIdentity } from "./parsing-identity.js";

export function dispatchWithoutBlocking(sink: ChatDispatchApiSink, event: ChatDispatchApiEvent): void {
  try {
    void Promise.resolve(sink.handleChatDispatchEvent(event)).catch(() => undefined);
  } catch {
    // The message mutation is already durable; dispatch failure must not roll it back.
  }
}

export function dispatchChatEntryCreated(
  sink: ChatDispatchApiSink | undefined,
  created: ChatCreateEntryResponse,
  input: ChatCreateEntryInput,
): void {
  if (!sink) {
    return;
  }
  dispatchWithoutBlocking(sink, {
    source: "chat_entry",
    companyId: created.companyId,
    roomId: created.openTarget.roomId,
    ...(input.actorMemberId ? { actorMemberId: input.actorMemberId } : {}),
    messageId: created.firstMessageId,
    body: input.firstMessage.body,
    mentionedMemberIds: input.firstMessage.mentionedMemberIds,
    containerId: created.entry.parentContainerId,
    entryId: created.entry.entryId,
    openTargetKind: created.openTarget.kind,
  });
}

export function dispatchChatRoomMessageCreated(
  sink: ChatDispatchApiSink | undefined,
  sent: Awaited<ReturnType<ChatRoomMessageApiService["sendMessage"]>>,
  input: {
    actor: ChatParticipantIdentitySelector;
    body: string;
    options: MessageServiceSendMessageOptions;
  },
): void {
  if (!sink) {
    return;
  }
  dispatchWithoutBlocking(sink, {
    source: "chat_room_message",
    companyId: sent.message.companyId,
    roomId: sent.message.conversationId,
    ...(input.actor.memberId ? { actorMemberId: input.actor.memberId } : {}),
    messageId: sent.message.messageId,
    body: input.body,
    mentionedMemberIds: input.options.mentionedMemberIds,
  });
}

export function participantMemberIds(conversation: ConversationDto): string[] {
  return [...new Set(
    conversation.participants
      .map((participant) => participant.memberId?.trim())
      .filter((memberId): memberId is string => Boolean(memberId)),
  )];
}

export function publishChatProjectionChanged(
  publisher: TinyOfficeRealtimePublisher,
  companyId: string,
  viewer: ChatParticipantIdentitySelector,
): void {
  if (viewer.memberId) {
    publisher.publish({
      type: "chat.projection.changed",
      companyId,
      viewerMemberId: viewer.memberId,
    });
    return;
  }
}

export function publishChatEntryCreated(
  publisher: TinyOfficeRealtimePublisher | undefined,
  created: ChatCreateEntryResponse,
  actor: ChatParticipantIdentitySelector,
): void {
  if (!publisher) {
    return;
  }
  publisher.publish({
    type: "chat.entry.created",
    companyId: created.companyId,
    containerId: created.entry.parentContainerId,
    entryId: created.entry.entryId,
    roomId: created.openTarget.roomId,
  });
  publisher.publish({
    type: "chat.message.created",
    companyId: created.companyId,
    conversationId: created.openTarget.roomId,
    roomId: created.openTarget.roomId,
    messageId: created.firstMessageId,
  });
  publishChatProjectionChanged(publisher, created.companyId, actor);
}

export function publishChatMessageCreated(
  publisher: TinyOfficeRealtimePublisher | undefined,
  sent: Awaited<ReturnType<ChatRoomMessageApiService["sendMessage"]>>,
): void {
  if (!publisher) {
    return;
  }
  publisher.publish({
    type: "chat.message.created",
    companyId: sent.message.companyId,
    conversationId: sent.message.conversationId,
    roomId: sent.message.conversationId,
    messageId: sent.message.messageId,
  });
  for (const memberId of participantMemberIds(sent.conversation)) {
    publishChatProjectionChanged(publisher, sent.message.companyId, { participantKind: "company_member", memberId });
  }
}

export function publishChatReadStateUpdated(
  publisher: TinyOfficeRealtimePublisher | undefined,
  read: Awaited<ReturnType<ChatRoomMessageApiService["markConversationRead"]>>,
  viewer: ChatParticipantIdentitySelector,
): void {
  if (!publisher) {
    return;
  }
  if (!viewer.memberId) {
    return;
  }
  publisher.publish({
    type: "chat.read_state.updated",
    companyId: read.conversation.companyId,
    roomId: read.conversation.conversationId,
    memberId: viewer.memberId,
  });
  publishChatProjectionChanged(publisher, read.conversation.companyId, viewer);
}

export function assertChatProjectionResponse(value: ChatProjectionPage): ChatProjectionPage {
  assertChatProjectionBoundary(value);
  return value;
}

export async function authorizedConversation(input: {
  messageService: Pick<ChatRoomMessageApiService, "getConversation"> | Pick<ConversationApiMessageService, "getConversation">;
  companyId: string;
  roomId: string;
  identity: MessageServiceParticipantSelector;
  label: string;
  notFoundLabel: string;
}): Promise<ConversationDto> {
  const conversation = await input.messageService.getConversation(input.companyId, input.roomId);
  if (!conversation) {
    throw new Error(`${input.notFoundLabel} not found: ${input.roomId}`);
  }
  assertChatParticipantAccess(conversation, chatAccessIdentity(input.identity), input.label);
  return conversation;
}

export async function filterProjectionForViewer(input: {
  options: TinyOfficeApiOptions;
  companyId: string;
  page: ChatProjectionPage;
  viewer: MessageServiceParticipantSelector;
}): Promise<ChatProjectionPage> {
  const sourceArchivedEntries = input.page.archivedEntries ?? [];
  if (!input.options.chatRoomMessageService || (input.page.entries.length === 0 && sourceArchivedEntries.length === 0)) {
    return input.page;
  }
  const messageService = await resolveChatRoomMessageService(input.options, input.companyId);
  const viewer = chatAccessIdentity(input.viewer);
  const containers = new Map(input.page.containers.map((container) => [
    container.containerId,
    {
      ...container,
      unreadCount: 0,
      mentionCount: 0,
      entryCount: 0,
    },
  ]));
  const entries: ChatProjectionPage["entries"] = [];
  const archivedEntries: ChatProjectionPage["archivedEntries"] = [];

  for (const entry of input.page.entries) {
    const conversation = await messageService.getConversation(input.companyId, entry.openTarget.roomId);
    if (!conversation || !isChatParticipantAllowed(conversation, viewer)) {
      continue;
    }
    entries.push(entry);
    const container = containers.get(entry.parentContainerId);
    if (container) {
      container.unreadCount += entry.unreadCount;
      container.mentionCount += entry.mentionCount;
      container.entryCount += 1;
    }
  }

  for (const entry of sourceArchivedEntries) {
    const conversation = await messageService.getConversation(input.companyId, entry.openTarget.roomId);
    if (conversation && isChatParticipantAllowed(conversation, viewer)) archivedEntries.push(entry);
  }

  return assertChatProjectionResponse({
    containers: [...containers.values()],
    entries,
    archivedEntries,
    nextCursor: input.page.nextCursor,
  });
}

export function assertChatEntryResponse(value: ChatCreateEntryResponse): ChatCreateEntryResponse {
  assertChatEntryContractBoundary(value.container);
  assertChatEntryContractBoundary(value.entry);
  return value;
}

export function actorIdentityFromCreateEntry(input: ChatCreateEntryInput): ChatParticipantIdentitySelector {
  return normalizeChatViewerIdentity(
    { participantKind: "company_member", memberId: input.actorMemberId },
    "actor",
  );
}
