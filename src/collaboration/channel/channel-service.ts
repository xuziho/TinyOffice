import { randomUUID } from "node:crypto";

import {
  CHAT_CHANNEL_MEMBER_DTO_SCHEMA,
  CHAT_ENTRY_CONTRACT_VERSION,
  type ChatChannelMemberDto,
} from "../contracts/chat-entry-contract.js";
import type {
  CompanyMemberId,
  ConversationParticipantKind,
  ParticipantId,
} from "../contracts/conversation-message-contract.js";

export interface ChannelParticipantIdentitySelector {
  participantId?: ParticipantId;
  participantKind?: ConversationParticipantKind;
  memberId?: CompanyMemberId;
}

export interface ChannelMemberInput {
  memberId: string;
  displayName: string;
  hasRuntimeProfile?: boolean;
}

export interface ChatChannelRecord {
  companyId: string;
  chatChannelId: string;
  title: string;
  summary?: string;
  members: ChatChannelMemberDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ChannelRepository {
  upsertChannel(channel: ChatChannelRecord): Promise<ChatChannelRecord>;
  deleteChannel(companyId: string, channelId: string): Promise<void>;
  listChannelsForCompany(companyId: string): Promise<ChatChannelRecord[]>;
  listChannelsForViewer(companyId: string, viewer: ChannelParticipantIdentitySelector): Promise<ChatChannelRecord[]>;
  getChannel(companyId: string, channelId: string): Promise<ChatChannelRecord | undefined>;
}

export interface ChannelActorRoleResolverInput {
  companyId: string;
  channel: ChatChannelRecord;
  actor: ChannelParticipantIdentitySelector;
}

export type ChannelActorRoleResolver = (
  input: ChannelActorRoleResolverInput
) => Promise<boolean | undefined> | boolean | undefined;

export type ChannelMemberEligibilityResolver = (input: {
  companyId: string;
  memberIds: string[];
}) => Promise<readonly string[]> | readonly string[];

export interface ChannelServiceConfig {
  dissolvePermissionResolver?: ChannelActorRoleResolver;
  memberEligibilityResolver?: ChannelMemberEligibilityResolver;
}

export interface CreateChannelInput {
  companyId: string;
  title: string;
  summary?: string;
  actor: ChannelParticipantIdentitySelector & { displayName: string };
  members?: ChannelMemberInput[];
}

export interface AddChannelMembersInput {
  companyId: string;
  channelId: string;
  actor: ChannelParticipantIdentitySelector;
  members: ChannelMemberInput[];
}

export interface UpdateChannelDetailsInput {
  companyId: string;
  channelId: string;
  actor: ChannelParticipantIdentitySelector;
  title: string;
  summary?: string;
}

export interface RemoveChannelMemberInput {
  companyId: string;
  channelId: string;
  actor: ChannelParticipantIdentitySelector;
  member: ChannelParticipantIdentitySelector;
}

export interface DissolveChannelInput {
  companyId: string;
  channelId: string;
  actor: ChannelParticipantIdentitySelector;
  confirmation: string;
}

export interface DissolveChannelResult {
  companyId: string;
  chatChannelId: string;
  dissolved: true;
}

export class ChannelPermissionDeniedError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "ChannelPermissionDeniedError";
  }
}

export class ChannelMemberIneligibleError extends Error {
  readonly statusCode = 409;

  constructor(memberId: string) {
    super(`Channel member ${memberId} is not active or is not available in this Company.`);
    this.name = "ChannelMemberIneligibleError";
  }
}

function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function now(): string {
  return new Date().toISOString();
}

function trimRequired(value: string | undefined, fieldName: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function identityKey(member: Pick<ChatChannelMemberDto, "memberId">): string {
  return `member:${member.memberId}`;
}

function selectorIdentityKey(selector: ChannelParticipantIdentitySelector): string {
  if (selector.memberId?.trim()) {
    return `member:${selector.memberId.trim()}`;
  }
  throw new Error("Channel member identity requires memberId");
}

function matchesViewer(member: ChatChannelMemberDto, viewer: ChannelParticipantIdentitySelector): boolean {
  return Boolean(viewer.memberId && member.memberId === viewer.memberId);
}

function isChannelViewer(channel: ChatChannelRecord, viewer: ChannelParticipantIdentitySelector): boolean {
  return channel.members.some((member) => matchesViewer(member, viewer));
}

function assertCanManage(
  channel: ChatChannelRecord,
  actor: ChannelParticipantIdentitySelector,
): void {
  if (!isChannelViewer(channel, actor)) {
    throw new ChannelPermissionDeniedError("Channel management requires channel participation.");
  }
}

function assertManagedMembership(channel: ChatChannelRecord): void {
  if (channel.members.length === 0) {
    throw new Error("Channel requires at least one member");
  }
}

function memberDto(companyId: string, channelId: string, input: ChannelMemberInput, joinedAt: string): ChatChannelMemberDto {
  const memberId = optionalTrimmed(input.memberId);
  if (!memberId) {
    throw new Error("Channel member requires memberId");
  }
  return {
    schema: CHAT_CHANNEL_MEMBER_DTO_SCHEMA,
    version: CHAT_ENTRY_CONTRACT_VERSION,
    companyId,
    chatChannelId: channelId,
    memberId,
    displayName: trimRequired(input.displayName, "member.displayName"),
    hasRuntimeProfile: input.hasRuntimeProfile ?? false,
    joinedAt,
  };
}

function actorMemberInput(actor: CreateChannelInput["actor"]): ChannelMemberInput {
  const memberId = trimRequired(actor.memberId, "actor.memberId");
  return {
    memberId,
    displayName: trimRequired(actor.displayName, "actor.displayName"),
    hasRuntimeProfile: false,
  };
}

export class ChannelService {
  constructor(
    private readonly repository: ChannelRepository,
    private readonly config: ChannelServiceConfig = {},
  ) {}

  async createChannel(input: CreateChannelInput): Promise<ChatChannelRecord> {
    const companyId = trimRequired(input.companyId, "companyId");
    await this.assertEligibleMembers(companyId, input.members || []);
    const channelId = createId("channel");
    const timestamp = now();
    const membersByIdentity = new Map<string, ChatChannelMemberDto>();
    for (const member of [actorMemberInput(input.actor), ...(input.members || [])]) {
      const dto = memberDto(companyId, channelId, member, timestamp);
      const key = identityKey(dto);
      if (!membersByIdentity.has(key)) {
        membersByIdentity.set(key, dto);
      }
    }
    const members = [...membersByIdentity.values()];
    const channel = {
      companyId,
      chatChannelId: channelId,
      title: trimRequired(input.title, "title"),
      summary: optionalTrimmed(input.summary),
      members,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    assertManagedMembership(channel);
    return await this.repository.upsertChannel(channel);
  }

  async addMembers(input: AddChannelMembersInput): Promise<ChatChannelRecord> {
    const channel = await this.requireChannel(input.companyId, input.channelId);
    assertCanManage(channel, input.actor);
    await this.assertEligibleMembers(channel.companyId, input.members);
    const timestamp = now();
    const membersByIdentity = new Map(channel.members.map((member) => [identityKey(member), member]));
    for (const member of input.members) {
      const dto = memberDto(channel.companyId, channel.chatChannelId, member, timestamp);
      membersByIdentity.set(identityKey(dto), dto);
    }
    const next = {
      ...channel,
      members: [...membersByIdentity.values()],
      updatedAt: timestamp,
    };
    assertManagedMembership(next);
    return await this.repository.upsertChannel(next);
  }

  private async assertEligibleMembers(companyId: string, members: readonly ChannelMemberInput[]): Promise<void> {
    if (!this.config.memberEligibilityResolver || members.length === 0) {
      return;
    }
    const requestedMemberIds = [...new Set(members.map((member) => trimRequired(member.memberId, "member.memberId")))];
    const eligibleMemberIds = new Set(await this.config.memberEligibilityResolver({ companyId, memberIds: requestedMemberIds }));
    const ineligibleMemberId = requestedMemberIds.find((memberId) => !eligibleMemberIds.has(memberId));
    if (ineligibleMemberId) {
      throw new ChannelMemberIneligibleError(ineligibleMemberId);
    }
  }

  async updateDetails(input: UpdateChannelDetailsInput): Promise<ChatChannelRecord> {
    const channel = await this.requireChannel(input.companyId, input.channelId);
    assertCanManage(channel, input.actor);
    const next = {
      ...channel,
      title: trimRequired(input.title, "title"),
      summary: optionalTrimmed(input.summary),
      updatedAt: now(),
    };
    assertManagedMembership(next);
    return await this.repository.upsertChannel(next);
  }

  async removeMember(input: RemoveChannelMemberInput): Promise<ChatChannelRecord> {
    const channel = await this.requireChannel(input.companyId, input.channelId);
    assertCanManage(channel, input.actor);
    const targetKey = selectorIdentityKey(input.member);
    const members = channel.members.filter((member) => identityKey(member) !== targetKey);
    if (members.length === channel.members.length) {
      throw new Error("Channel member not found");
    }
    const next = {
      ...channel,
      members,
      updatedAt: now(),
    };
    assertManagedMembership(next);
    return await this.repository.upsertChannel(next);
  }

  async dissolveChannel(input: DissolveChannelInput): Promise<DissolveChannelResult> {
    const companyId = trimRequired(input.companyId, "companyId");
    const channelId = trimRequired(input.channelId, "channelId");
    if (input.confirmation !== "DELETE") {
      throw new Error("Channel dissolve confirmation must be DELETE");
    }
    const channel = await this.requireChannel(companyId, channelId);
    assertCanManage(channel, input.actor);
    const allowed = await this.config.dissolvePermissionResolver?.({
      companyId: channel.companyId,
      channel,
      actor: input.actor,
    });
    if (allowed === false) {
      throw new ChannelPermissionDeniedError("Channel dissolve requires company-level permission.");
    }
    await this.repository.deleteChannel(companyId, channelId);
    return {
      companyId,
      chatChannelId: channelId,
      dissolved: true,
    };
  }

  async listChannelsForViewer(companyId: string, viewer: ChannelParticipantIdentitySelector): Promise<ChatChannelRecord[]> {
    const scopedCompanyId = trimRequired(companyId, "companyId");
    const channels = await this.repository.listChannelsForViewer(scopedCompanyId, viewer);
    const visibleChannels: ChatChannelRecord[] = [];
    for (const channel of channels) {
      if (!isChannelViewer(channel, viewer)) {
        continue;
      }
      visibleChannels.push({ ...channel });
    }
    return visibleChannels.sort((left, right) => left.title.localeCompare(right.title) || left.chatChannelId.localeCompare(right.chatChannelId));
  }

  async requireChannel(companyId: string, channelId: string): Promise<ChatChannelRecord> {
    const channel = await this.repository.getChannel(trimRequired(companyId, "companyId"), trimRequired(channelId, "channelId"));
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    return channel;
  }
}

function cloneChannel(channel: ChatChannelRecord): ChatChannelRecord {
  return {
    ...channel,
    members: channel.members.map((member) => ({ ...member })),
  };
}

export class InMemoryChannelRepository implements ChannelRepository {
  private readonly channels = new Map<string, ChatChannelRecord>();

  async upsertChannel(channel: ChatChannelRecord): Promise<ChatChannelRecord> {
    this.channels.set(this.key(channel.companyId, channel.chatChannelId), cloneChannel(channel));
    return cloneChannel(channel);
  }

  async deleteChannel(companyId: string, channelId: string): Promise<void> {
    this.channels.delete(this.key(companyId, channelId));
  }

  async listChannelsForCompany(companyId: string): Promise<ChatChannelRecord[]> {
    return [...this.channels.values()]
      .filter((channel) => channel.companyId === companyId)
      .sort((left, right) => left.title.localeCompare(right.title) || left.chatChannelId.localeCompare(right.chatChannelId))
      .map(cloneChannel);
  }

  async listChannelsForViewer(companyId: string, viewer: ChannelParticipantIdentitySelector): Promise<ChatChannelRecord[]> {
    return [...this.channels.values()]
      .filter((channel) => channel.companyId === companyId && channel.members.some((member) => matchesViewer(member, viewer)))
      .sort((left, right) => left.title.localeCompare(right.title) || left.chatChannelId.localeCompare(right.chatChannelId))
      .map(cloneChannel);
  }

  async getChannel(companyId: string, channelId: string): Promise<ChatChannelRecord | undefined> {
    const channel = this.channels.get(this.key(companyId, channelId));
    return channel ? cloneChannel(channel) : undefined;
  }

  private key(companyId: string, channelId: string): string {
    return `${companyId}\0${channelId}`;
  }
}
