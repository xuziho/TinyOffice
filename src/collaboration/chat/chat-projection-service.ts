import {
  assertChatEntryContractBoundary,
  CHAT_CONTAINER_DTO_SCHEMA,
  CHAT_ENTRY_CONTRACT_VERSION,
  CHAT_ENTRY_DTO_SCHEMA,
  CHAT_RUNTIME_LINK_DTO_SCHEMA,
  ensureChatEntryCompanyScope,
  type ChatContainerDto,
  type ChatEntryDto,
  type ChatEntryTitleStatus,
  type ChatRuntimeLinkDto,
} from "../contracts/chat-entry-contract.js";
import type { ChatChannelRecord } from "../channel/channel-service.js";
import type {
  ConversationDto,
  ConversationPage,
  ConversationParticipantKind,
  ConversationParticipantStateDto,
  CompanyMemberId,
  ConversationRuntimeLinkDto,
  MessagePage,
  ParticipantId,
} from "../contracts/conversation-message-contract.js";
import { isChatParticipantAllowed } from "./chat-permissions.js";

export interface ChatParticipantIdentitySelector {
  participantId?: ParticipantId;
  participantKind?: ConversationParticipantKind;
  memberId?: CompanyMemberId;
}

export type ChatViewerIdentity = CompanyMemberId | ChatParticipantIdentitySelector;

export interface ChatProjectionConversationSource {
  listConversations(
    companyId: string,
    viewer: ChatViewerIdentity,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<ConversationPage>;
}

export interface ChatProjectionChannelSource {
  listChannelsForViewer(companyId: string, viewer: ChatParticipantIdentitySelector): Promise<ChatChannelRecord[]>;
}

export interface ChatProjectionMessageSource {
  listMessages(
    companyId: string,
    conversationId: string,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<MessagePage>;
}

export interface ChatProjectionPage {
  containers: ChatContainerDto[];
  entries: ChatEntryDto[];
  archivedEntries: ChatEntryDto[];
  nextCursor?: string;
}

export interface ChatProjectionServiceConfig {
  conversationSource: ChatProjectionConversationSource;
  channelSource?: ChatProjectionChannelSource;
  messageSource?: ChatProjectionMessageSource;
}

export const CHAT_CHANNEL_CONTAINER_PREFIX = "chat-container-channel-" as const;

function trimRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

export function normalizeChatViewerIdentity(input: ChatViewerIdentity, fieldName: string): ChatParticipantIdentitySelector {
  if (typeof input === "string") {
    return { participantKind: "company_member", memberId: trimRequired(input, `${fieldName}MemberId`) };
  }
  const participantId = input.participantId ? trimRequired(input.participantId, `${fieldName}.participantId`) : undefined;
  const memberId = input.memberId ? trimRequired(input.memberId, `${fieldName}.memberId`) : undefined;
  const rawIdentity = input as { employeeId?: unknown; participantKind?: unknown };
  if (rawIdentity.employeeId !== undefined || rawIdentity.participantKind === "employee") {
    throw new Error(`${fieldName}.memberId is required; employee participant identity is retired for Chat`);
  }
  if (input.participantKind === "company_member" && !memberId) {
    throw new Error(`${fieldName}.memberId is required`);
  }
  if (!participantId && !memberId) {
    throw new Error(`${fieldName} participant identity is required`);
  }
  return {
    ...(participantId ? { participantId } : {}),
    ...(input.participantKind ? { participantKind: input.participantKind } : {}),
    ...(memberId ? { memberId } : {}),
  };
}

function viewerState(
  conversation: ConversationDto,
  viewer: ChatParticipantIdentitySelector,
): ConversationParticipantStateDto | undefined {
  return conversation.participantStates?.find((state) =>
    (viewer.participantId !== undefined && state.participantId === viewer.participantId) ||
    (viewer.memberId !== undefined && state.memberId === viewer.memberId)
  );
}

function titleStatusFromExistingTitle(conversation: ConversationDto): ChatEntryTitleStatus {
  if (conversation.titleStatus) {
    return conversation.titleStatus;
  }
  return conversation.title.trim() ? "manual" : "placeholder";
}

function runtimeLinkFromConversation(link: ConversationRuntimeLinkDto): ChatRuntimeLinkDto {
  return {
    schema: CHAT_RUNTIME_LINK_DTO_SCHEMA,
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId: link.companyId,
    linkId: link.linkId,
    targetKind: link.targetKind,
    targetId: link.targetId,
    label: link.label,
    sourceMessageId: link.sourceMessageId,
    createdAt: link.createdAt,
  };
}

export function channelContainerId(channelId: string): string {
  return `${CHAT_CHANNEL_CONTAINER_PREFIX}${trimRequired(channelId, "channelId")}`;
}

export function channelIdFromContainerId(containerId: string): string | undefined {
  return containerId.startsWith(CHAT_CHANNEL_CONTAINER_PREFIX)
    ? trimRequired(containerId.slice(CHAT_CHANNEL_CONTAINER_PREFIX.length), "channelId")
    : undefined;
}

function topicEntry(conversation: ConversationDto, viewer: ChatParticipantIdentitySelector, summary?: string, includeArchived = false): ChatEntryDto | undefined {
  if (conversation.conversationKind !== "topic" || !conversation.topic?.chatChannelId) {
    return undefined;
  }
  if (conversation.topic.status === "archived" && !includeArchived) {
    return undefined;
  }
  const state = viewerState(conversation, viewer);
  const title = conversation.topic.title || conversation.title;
  const entry: ChatEntryDto = {
    schema: CHAT_ENTRY_DTO_SCHEMA,
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId: conversation.companyId,
    entryId: `chat-entry-channel-topic-${conversation.topic.topicId}`,
    kind: "channel_topic",
    parentContainerId: channelContainerId(conversation.topic.chatChannelId),
    title: trimRequired(title, "channel topic title"),
    titleStatus: titleStatusFromExistingTitle(conversation),
    titleSourceMessageId: conversation.titleSourceMessageId,
    ...(summary ? { summary } : {}),
    unreadCount: state?.unreadCount ?? 0,
    mentionCount: state?.mentionCount ?? 0,
    openTarget: {
      kind: "topic_room",
      roomId: conversation.conversationId,
    },
    runtimeLinks: (conversation.runtimeLinks || []).map(runtimeLinkFromConversation),
    updatedAt: conversation.updatedAt,
  };
  assertChatEntryContractBoundary(entry);
  return entry;
}

function directMessagePeer(conversation: ConversationDto, viewer: ChatParticipantIdentitySelector) {
  const peers = conversation.participants
    .filter((participant) => participant.memberId && participant.memberId !== viewer.memberId)
    .sort((left, right) => String(left.memberId).localeCompare(String(right.memberId)));
  return peers[0] || conversation.participants.find((participant) => participant.memberId);
}

function dmEntry(conversation: ConversationDto, viewer: ChatParticipantIdentitySelector, summary?: string, includeArchived = false): {
  container: ChatContainerDto;
  entry: ChatEntryDto;
} | undefined {
  if (conversation.conversationKind !== "direct") {
    return undefined;
  }
  const peer = directMessagePeer(conversation, viewer);
  const peerMemberId = peer?.memberId;
  if (!peerMemberId) {
    return undefined;
  }
  const state = viewerState(conversation, viewer);
  if (state?.archivedAt && !includeArchived) {
    return undefined;
  }
  const container: ChatContainerDto = {
    schema: CHAT_CONTAINER_DTO_SCHEMA,
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId: conversation.companyId,
    containerId: `chat-container-member-dm-${peerMemberId}`,
    kind: "member_dm",
    title: trimRequired(peer.displayName || peerMemberId, "member DM title"),
    unreadCount: 0,
    mentionCount: 0,
    entryCount: 0,
    runtimeLinks: [],
  };
  const entry: ChatEntryDto = {
    schema: CHAT_ENTRY_DTO_SCHEMA,
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId: conversation.companyId,
    entryId: `chat-entry-dm-session-${conversation.conversationId}`,
    kind: "dm_session_entry",
    parentContainerId: container.containerId,
    title: trimRequired(conversation.title || container.title, "DM session entry title"),
    titleStatus: titleStatusFromExistingTitle(conversation),
    titleSourceMessageId: conversation.titleSourceMessageId,
    ...(summary ? { summary } : {}),
    unreadCount: state?.unreadCount ?? 0,
    mentionCount: state?.mentionCount ?? 0,
    openTarget: {
      kind: "dm_session_entry_room",
      roomId: conversation.conversationId,
    },
    runtimeLinks: (conversation.runtimeLinks || []).map(runtimeLinkFromConversation),
    updatedAt: conversation.updatedAt,
  };
  assertChatEntryContractBoundary(container);
  assertChatEntryContractBoundary(entry);
  return { container, entry };
}

function channelContainer(channel: ChatChannelRecord, viewer: ChatParticipantIdentitySelector): ChatContainerDto {
  return {
    schema: CHAT_CONTAINER_DTO_SCHEMA,
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId: channel.companyId,
    containerId: channelContainerId(channel.chatChannelId),
    chatChannelId: channel.chatChannelId,
    kind: "channel",
    title: trimRequired(channel.title, "channel.title"),
    summary: channel.summary,
    unreadCount: 0,
    mentionCount: 0,
    entryCount: 0,
    runtimeLinks: [],
    members: channel.members,
  };
}

function addEntryToContainer(container: ChatContainerDto, entry: ChatEntryDto): void {
  container.unreadCount += entry.unreadCount;
  container.mentionCount += entry.mentionCount;
  container.entryCount += 1;
}

export class ChatProjectionService {
  private readonly conversationSource: ChatProjectionConversationSource;
  private readonly channelSource: ChatProjectionChannelSource | undefined;
  private readonly messageSource: ChatProjectionMessageSource | undefined;

  constructor(config: ChatProjectionServiceConfig) {
    this.conversationSource = config.conversationSource;
    this.channelSource = config.channelSource;
    this.messageSource = config.messageSource;
  }

  async listChatProjection(
    companyId: string,
    viewerIdentity: ChatViewerIdentity,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<ChatProjectionPage> {
    const scopedCompanyId = ensureChatEntryCompanyScope({ companyId });
    const viewer = normalizeChatViewerIdentity(viewerIdentity, "viewer");
    const [source, channels] = await Promise.all([
      this.conversationSource.listConversations(scopedCompanyId, viewer, cursor),
      this.channelSource?.listChannelsForViewer(scopedCompanyId, viewer) ?? Promise.resolve([]),
    ]);
    const containers = new Map<string, ChatContainerDto>();
    const entries: ChatEntryDto[] = [];
    const archivedEntries: ChatEntryDto[] = [];
    for (const channel of channels) {
      if (channel.members.length === 0) {
        continue;
      }
      const container = channelContainer(channel, viewer);
      assertChatEntryContractBoundary(container);
      containers.set(container.containerId, container);
    }

    const visibleConversations = source.conversations.filter((conversation) => {
      ensureChatEntryCompanyScope({ companyId: scopedCompanyId, resourceCompanyId: conversation.companyId });
      return isChatParticipantAllowed(conversation, viewer);
    });
    const summaries = await Promise.all(
      visibleConversations.map((conversation) => this.firstMessagePreview(scopedCompanyId, conversation)),
    );

    for (const [index, conversation] of visibleConversations.entries()) {
      const summary = summaries[index];
      const isArchivedTopic = conversation.conversationKind === "topic" && conversation.topic?.status === "archived";
      const projectedTopicEntry = topicEntry(conversation, viewer, summary, isArchivedTopic);
      if (projectedTopicEntry) {
        const container = containers.get(projectedTopicEntry.parentContainerId);
        if (!container) {
          continue;
        }
        if (isArchivedTopic) {
          archivedEntries.push(projectedTopicEntry);
        } else {
          addEntryToContainer(container, projectedTopicEntry);
          containers.set(container.containerId, container);
          entries.push(projectedTopicEntry);
        }
        continue;
      }

      const isArchivedDm = conversation.conversationKind === "direct" && Boolean(viewerState(conversation, viewer)?.archivedAt);
      const projectedDmEntry = dmEntry(conversation, viewer, summary, isArchivedDm);
      if (projectedDmEntry) {
        const container = containers.get(projectedDmEntry.container.containerId) || projectedDmEntry.container;
        if (isArchivedDm) {
          archivedEntries.push(projectedDmEntry.entry);
        } else {
          addEntryToContainer(container, projectedDmEntry.entry);
          entries.push(projectedDmEntry.entry);
        }
        containers.set(container.containerId, container);
      }
    }

    entries.sort(compareEntriesOldestFirst);
    archivedEntries.sort(compareEntriesOldestFirst);

    const page: ChatProjectionPage = {
      containers: [...containers.values()],
      entries,
      archivedEntries,
      nextCursor: source.nextCursor,
    };
    assertChatProjectionBoundary(page);
    return page;
  }

  private async firstMessagePreview(companyId: string, conversation: ConversationDto): Promise<string | undefined> {
    if (!this.messageSource) {
      return undefined;
    }
    const page = await this.messageSource.listMessages(companyId, conversation.conversationId, { limit: 1 });
    return compactEntryPreview(page.messages[0]?.body);
  }
}

function compactEntryPreview(body: string | undefined): string | undefined {
  const normalized = body?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function compareEntriesOldestFirst(left: ChatEntryDto, right: ChatEntryDto): number {
  return left.updatedAt.localeCompare(right.updatedAt) || left.entryId.localeCompare(right.entryId);
}

export function assertChatProjectionBoundary(page: ChatProjectionPage): void {
  for (const container of page.containers) {
    assertChatEntryContractBoundary(container);
    if ("openTarget" in container) {
      throw new Error("Chat containers must not expose openTarget or behave like reply rooms");
    }
  }
  for (const entry of page.entries) {
    assertChatEntryContractBoundary(entry);
  }
  for (const entry of page.archivedEntries ?? []) {
    assertChatEntryContractBoundary(entry);
  }
}
