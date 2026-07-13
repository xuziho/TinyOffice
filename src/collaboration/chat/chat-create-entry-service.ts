import { assertNoForbiddenPublicCarrierFields } from "../contracts/conversation-message-contract.js";
import {
  assertChatEntryContractBoundary,
  CHAT_ENTRY_CONTRACT_VERSION,
  CHAT_ENTRY_DTO_SCHEMA,
  ensureChatEntryCompanyScope,
  type ChatContainerDto,
  type ChatEntryDto,
  type ChatOpenTargetDto,
} from "../contracts/chat-entry-contract.js";
import type {
  CreateConversationParticipantInput,
  MessageServiceCreateConversationInput,
  MessageServiceParticipantSelector,
  MessageServiceSendMessageOptions,
} from "../message/message-service.js";
import {
  channelIdFromContainerId,
  type ChatViewerIdentity,
  normalizeChatViewerIdentity,
  type ChatProjectionPage,
} from "./chat-projection-service.js";
import type { ChatChannelRecord } from "../channel/channel-service.js";
import type { SystemAiChatTitleGenerationRequest } from "../../system-ai/chat-title-generation.js";

export interface ChatCreateEntryMessageInput {
  body: string;
  attachmentIds?: MessageServiceSendMessageOptions["attachmentIds"];
  mentionedMemberIds?: string[];
  runtimeLinks?: MessageServiceSendMessageOptions["runtimeLinks"];
}

export interface ChatCreateEntryInput {
  companyId: string;
  containerId: string;
  actorMemberId?: string;
  actorDisplayName?: string;
  title?: string;
  firstMessage: ChatCreateEntryMessageInput;
  memberDisplayNames?: Record<string, string>;
}

export interface ChatCreateEntryResponse {
  schema: "chat-create-entry-result";
  version: typeof CHAT_ENTRY_CONTRACT_VERSION;
  companyId: string;
  container: ChatContainerDto;
  entry: ChatEntryDto;
  openTarget: ChatOpenTargetDto;
  firstMessageId: string;
}

export interface ChatCreateEntryMessageService {
  createConversation(companyId: string, input: MessageServiceCreateConversationInput): Promise<{ conversationId: string }>;
  createConversationWithFirstMessage?(
    companyId: string,
    input: {
      conversation: MessageServiceCreateConversationInput;
      firstMessage: MessageServiceSendMessageOptions & {
        sender?: MessageServiceParticipantSelector;
        body: string;
      };
    },
  ): Promise<{ conversation: { conversationId: string }; message: { messageId: string } }>;
  sendMessage(
    companyId: string,
    conversationId: string,
    sender: MessageServiceParticipantSelector,
    body: string,
    options?: MessageServiceSendMessageOptions,
  ): Promise<{ message: { messageId: string } }>;
}

export interface ChatCreateEntryProjectionService {
  listChatProjection(
    companyId: string,
    viewer: ChatViewerIdentity,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<ChatProjectionPage>;
}

export interface ChatCreateEntryTitleGenerationService {
  requestChatEntryTitleGeneration(request: SystemAiChatTitleGenerationRequest): void;
}

export interface ChatCreateEntryChannelService {
  requireChannel(companyId: string, channelId: string): Promise<ChatChannelRecord>;
}

export interface ChatCreateEntryMemberEligibilityResolver {
  (input: { companyId: string; memberIds: string[] }): Promise<string[]> | string[];
}

export class ChatEntryMemberUnavailableError extends Error {
  readonly statusCode = 409;

  constructor(memberId: string, companyId: string) {
    super(`DM peer ${memberId} is not active or is not available in Company ${companyId}`);
    this.name = "ChatEntryMemberUnavailableError";
  }
}

export interface ChatCreateEntryServiceConfig {
  messageService: ChatCreateEntryMessageService;
  projectionService: ChatCreateEntryProjectionService;
  channelService?: ChatCreateEntryChannelService;
  memberEligibilityResolver?: ChatCreateEntryMemberEligibilityResolver;
  titleGenerationService?: ChatCreateEntryTitleGenerationService;
}

const MEMBER_DM_CONTAINER_PREFIX = "chat-container-member-dm-";

function trimRequired(value: string | undefined, fieldName: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function displayName(memberId: string, displayNames?: Record<string, string>): string {
  return trimRequired(displayNames?.[memberId], `memberDisplayNames.${memberId}`);
}

function defaultChatEntryTitle(firstMessageBody: string, fallback: string): string {
  return firstMessageBody
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72)
    .replace(/[.,;:!?]+$/, "")
    || fallback;
}

function titleStatusForInput(input: Pick<ChatCreateEntryInput, "title">, hasTitleGenerationService: boolean): "placeholder" | "generated" | "manual" {
  if (optionalTrimmed(input.title)) {
    return "manual";
  }
  return hasTitleGenerationService ? "placeholder" : "generated";
}

function actorIdentity(input: Pick<ChatCreateEntryInput, "actorMemberId">): MessageServiceParticipantSelector {
  if (input.actorMemberId?.trim()) {
    return { participantKind: "company_member", memberId: trimRequired(input.actorMemberId, "actorMemberId") };
  }
  return { participantKind: "company_member", memberId: trimRequired(input.actorMemberId, "actorMemberId") };
}

function actorDisplayName(input: ChatCreateEntryInput, actor: MessageServiceParticipantSelector): string {
  if (typeof actor === "object" && actor.memberId) {
    return trimRequired(input.actorDisplayName, "actorDisplayName");
  }
  throw new Error("actorMemberId is required; employee actor identity is retired for Chat create-entry");
}

function dmPeerMemberFromContainer(containerId: string): string | undefined {
  if (!containerId.startsWith(MEMBER_DM_CONTAINER_PREFIX)) {
    return undefined;
  }
  return optionalTrimmed(containerId.slice(MEMBER_DM_CONTAINER_PREFIX.length));
}

function assertChatCreateEntryResponseBoundary(response: ChatCreateEntryResponse): void {
  assertNoForbiddenPublicCarrierFields(response);
  assertChatEntryContractBoundary(response.container);
  assertChatEntryContractBoundary(response.entry);
  if (response.schema !== "chat-create-entry-result") {
    throw new Error("Chat create-entry response schema must be chat-create-entry-result");
  }
  if (response.version !== CHAT_ENTRY_CONTRACT_VERSION) {
    throw new Error(`Chat create-entry response version must be ${CHAT_ENTRY_CONTRACT_VERSION}`);
  }
  ensureChatEntryCompanyScope({ companyId: response.companyId, resourceCompanyId: response.entry.companyId });
  if (response.openTarget.kind !== response.entry.openTarget.kind || response.openTarget.roomId !== response.entry.openTarget.roomId) {
    throw new Error("Chat create-entry response openTarget must match the created entry");
  }
  trimRequired(response.firstMessageId, "firstMessageId");
}

export class ChatCreateEntryService {
  private readonly messageService: ChatCreateEntryMessageService;
  private readonly projectionService: ChatCreateEntryProjectionService;
  private readonly channelService: ChatCreateEntryChannelService | undefined;
  private readonly memberEligibilityResolver: ChatCreateEntryMemberEligibilityResolver | undefined;
  private readonly titleGenerationService: ChatCreateEntryTitleGenerationService | undefined;

  constructor(config: ChatCreateEntryServiceConfig) {
    this.messageService = config.messageService;
    this.projectionService = config.projectionService;
    this.channelService = config.channelService;
    this.memberEligibilityResolver = config.memberEligibilityResolver;
    this.titleGenerationService = config.titleGenerationService;
  }

  async createEntry(input: ChatCreateEntryInput): Promise<ChatCreateEntryResponse> {
    assertNoForbiddenPublicCarrierFields(input);
    const companyId = ensureChatEntryCompanyScope({ companyId: input.companyId });
    const containerId = trimRequired(input.containerId, "containerId");
    const actor = actorIdentity(input);
    const firstMessageBody = trimRequired(input.firstMessage?.body, "firstMessage.body");

    const conversationInput = await this.conversationInput(companyId, containerId, actor, firstMessageBody, input);
    const firstMessageOptions = {
      attachmentIds: input.firstMessage.attachmentIds,
      mentionedMemberIds: input.firstMessage.mentionedMemberIds,
      runtimeLinks: input.firstMessage.runtimeLinks,
    };
    const created = this.messageService.createConversationWithFirstMessage
      ? await this.messageService.createConversationWithFirstMessage(companyId, {
        conversation: conversationInput,
        firstMessage: {
          ...firstMessageOptions,
          sender: actor,
          body: firstMessageBody,
        },
      })
      : await this.createEntryWithoutAtomicHelper(
        companyId,
        conversationInput,
        actor,
        firstMessageBody,
        firstMessageOptions,
      );
    const conversationId = trimRequired(created.conversation.conversationId, "conversationId");
    const firstMessageId = trimRequired(created.message.messageId, "firstMessageId");
    const page = await this.projectionService.listChatProjection(companyId, normalizeChatViewerIdentity(actor, "actor"));
    const entry = page.entries.find((candidate) => candidate.openTarget.roomId === conversationId);
    if (!entry) {
      throw new Error(`created Chat entry was not visible in projection for conversation ${conversationId}`);
    }
    const container = page.containers.find((candidate) => candidate.containerId === entry.parentContainerId);
    if (!container) {
      throw new Error(`created Chat entry container was not visible in projection: ${entry.parentContainerId}`);
    }
    const response: ChatCreateEntryResponse = {
      schema: "chat-create-entry-result",
      version: CHAT_ENTRY_CONTRACT_VERSION,
      companyId,
      container,
      entry: {
        ...entry,
        schema: CHAT_ENTRY_DTO_SCHEMA,
      },
      openTarget: entry.openTarget,
      firstMessageId,
    };
    assertChatCreateEntryResponseBoundary(response);
    this.requestTitleGeneration(response, input);
    return response;
  }

  private requestTitleGeneration(response: ChatCreateEntryResponse, input: ChatCreateEntryInput): void {
    if (!this.titleGenerationService) {
      return;
    }
    if (response.entry.titleStatus === "manual") {
      return;
    }
    this.titleGenerationService.requestChatEntryTitleGeneration({
      companyId: response.companyId,
      chatEntryId: response.entry.entryId,
      roomId: response.openTarget.roomId,
      currentTitle: response.entry.title,
      sourceMessage: {
        messageId: response.firstMessageId,
        body: input.firstMessage.body,
      },
      actor: {
        actorKind: "company_member",
        memberId: trimRequired(input.actorMemberId, "actorMemberId"),
        displayName: input.actorDisplayName,
      },
    });
  }

  private async createEntryWithoutAtomicHelper(
    companyId: string,
    conversationInput: MessageServiceCreateConversationInput,
    actor: MessageServiceParticipantSelector,
    firstMessageBody: string,
    firstMessageOptions: MessageServiceSendMessageOptions,
  ): Promise<{ conversation: { conversationId: string }; message: { messageId: string } }> {
    const conversation = await this.messageService.createConversation(companyId, {
      ...conversationInput,
    });
    const sent = await this.messageService.sendMessage(
      companyId,
      conversation.conversationId,
      actor,
      firstMessageBody,
      {
        ...firstMessageOptions,
      },
    );
    return {
      conversation,
      message: sent.message,
    };
  }

  private async conversationInput(
    companyId: string,
    containerId: string,
    actor: MessageServiceParticipantSelector,
    firstMessageBody: string,
    input: ChatCreateEntryInput,
  ): Promise<MessageServiceCreateConversationInput> {
    const actorSelector = normalizeChatViewerIdentity(actor, "actor");
    const actorMemberId = trimRequired(actorSelector.memberId, "actorMemberId");
    const actorParticipant: CreateConversationParticipantInput = {
      participantKind: "company_member" as const,
      memberId: actorMemberId,
      displayName: actorDisplayName(input, actor),
    };
    const channelId = channelIdFromContainerId(containerId);
    if (channelId) {
      if (!this.channelService) {
        throw new Error("channel service is required to create Channel Topic entries");
      }
      const channel = await this.channelService.requireChannel(companyId, channelId);
      const actorIsChannelMember = channel.members.some((member) =>
        actorSelector.memberId && member.memberId === actorSelector.memberId
      );
      if (!actorIsChannelMember) {
        throw new Error(`actor is not a member of Channel ${channelId}`);
      }
      const title = optionalTrimmed(input.title) || defaultChatEntryTitle(firstMessageBody, "New topic");
      const channelParticipants = channel.members.map((member): CreateConversationParticipantInput => ({
        participantKind: "company_member" as const,
        memberId: member.memberId,
        displayName: member.displayName,
      }));
      const participantKeys = new Set<string>();
      const participants = channelParticipants.filter((participant) => {
        const key = `member:${participant.memberId}`;
        if (participantKeys.has(key)) {
          return false;
        }
        participantKeys.add(key);
        return true;
      });
      return {
        title,
        titleStatus: titleStatusForInput(input, Boolean(this.titleGenerationService)),
        conversationKind: "topic",
        topic: {
          chatChannelId: channelId,
          title,
          status: "open",
        },
        participants,
      };
    }

    const peerMemberId = dmPeerMemberFromContainer(containerId);
    if (!peerMemberId) {
      throw new Error(`unsupported Chat containerId for create-entry: ${containerId}`);
    }
    if (peerMemberId === actorMemberId) {
      throw new Error("DM session entry requires a peer member distinct from actorMemberId");
    }
    if (!this.memberEligibilityResolver) {
      throw new Error("member eligibility resolver is required to create a DM session entry");
    }
    const eligibleMemberIds = await this.memberEligibilityResolver({ companyId, memberIds: [peerMemberId] });
    if (!eligibleMemberIds.includes(peerMemberId)) {
      throw new ChatEntryMemberUnavailableError(peerMemberId, companyId);
    }
    const title = optionalTrimmed(input.title) || defaultChatEntryTitle(
      firstMessageBody,
      `DM session with ${displayName(peerMemberId, input.memberDisplayNames)}`,
    );
    return {
      title,
      titleStatus: titleStatusForInput(input, Boolean(this.titleGenerationService)),
      conversationKind: "direct",
      participants: [
        actorParticipant,
        {
        participantKind: "company_member",
        memberId: peerMemberId,
        displayName: displayName(peerMemberId, input.memberDisplayNames),
        },
      ],
    };
  }
}
