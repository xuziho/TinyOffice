import {
  assertNoForbiddenPublicCarrierFields,
  type CompanyId,
  type ConversationRuntimeLinkTargetKind,
  type MessageId,
} from "./conversation-message-contract.js";

export const CHAT_ENTRY_CONTRACT_VERSION = 1 as const;
export const CHAT_CONTAINER_DTO_SCHEMA = "chat-container" as const;
export const CHAT_ENTRY_DTO_SCHEMA = "chat-entry" as const;
export const CHAT_OPEN_TARGET_DTO_SCHEMA = "chat-open-target" as const;
export const CHAT_RUNTIME_LINK_DTO_SCHEMA = "chat-runtime-link" as const;
export const CHAT_CHANNEL_MEMBER_DTO_SCHEMA = "chat-channel-member" as const;

export const PUBLIC_CHAT_ENTRY_DTO_KEY_SETS = {
  container: [
    "schema",
    "version",
    "companyId",
    "containerId",
    "chatChannelId",
    "kind",
    "title",
    "summary",
    "unreadCount",
    "mentionCount",
    "entryCount",
    "runtimeLinks",
    "members",
  ],
  channelMember: [
    "schema",
    "version",
    "companyId",
    "chatChannelId",
    "memberId",
    "displayName",
    "hasRuntimeProfile",
    "joinedAt",
  ],
  entry: [
    "schema",
    "version",
    "companyId",
    "entryId",
    "kind",
    "parentContainerId",
    "title",
    "titleStatus",
    "titleSourceMessageId",
    "summary",
    "unreadCount",
    "mentionCount",
    "openTarget",
    "runtimeLinks",
    "updatedAt",
  ],
  openTarget: ["kind", "roomId"],
  runtimeLink: [
    "schema",
    "version",
    "companyId",
    "linkId",
    "targetKind",
    "targetId",
    "label",
    "sourceMessageId",
    "createdAt",
  ],
} as const;

export const FORBIDDEN_CHAT_ENTRY_IDENTITY_FIELD_NAMES = [
  "sessionId",
  "workRunId",
  "processTraceId",
  "traceId",
  "attachmentId",
] as const;

export type ChatContainerId = string;
export type ChatEntryId = string;
export type ChatRoomId = string;

export type ChatContainerKind = "channel" | "member_dm";
export type ChatEntryKind = "channel_topic" | "dm_session_entry";
export type ChatEntryTitleStatus = "placeholder" | "generated" | "manual" | "failed";
export type ChatOpenTargetKind = "topic_room" | "dm_session_entry_room";
export type ChatRuntimeLinkTargetKind = ConversationRuntimeLinkTargetKind | "attachment";
export interface ChatChannelMemberDto {
  schema: typeof CHAT_CHANNEL_MEMBER_DTO_SCHEMA;
  version: typeof CHAT_ENTRY_CONTRACT_VERSION;
  companyId: CompanyId;
  chatChannelId: string;
  memberId: string;
  avatarSeed?: string;
  displayName: string;
  role?: string;
  hasRuntimeProfile: boolean;
  joinedAt: string;
}

export interface ChatRuntimeLinkDto {
  schema: typeof CHAT_RUNTIME_LINK_DTO_SCHEMA;
  version: typeof CHAT_ENTRY_CONTRACT_VERSION;
  companyId: CompanyId;
  linkId: string;
  targetKind: ChatRuntimeLinkTargetKind;
  targetId: string;
  label?: string;
  sourceMessageId?: MessageId;
  createdAt: string;
}

export interface ChatContainerDto {
  schema: typeof CHAT_CONTAINER_DTO_SCHEMA;
  version: typeof CHAT_ENTRY_CONTRACT_VERSION;
  companyId: CompanyId;
  containerId: ChatContainerId;
  chatChannelId?: string;
  kind: ChatContainerKind;
  title: string;
  summary?: string;
  unreadCount: number;
  mentionCount: number;
  entryCount: number;
  runtimeLinks: ChatRuntimeLinkDto[];
  members?: ChatChannelMemberDto[];
}

export interface ChatOpenTargetDto {
  kind: ChatOpenTargetKind;
  roomId: ChatRoomId;
}

export interface ChatEntryDto {
  schema: typeof CHAT_ENTRY_DTO_SCHEMA;
  version: typeof CHAT_ENTRY_CONTRACT_VERSION;
  companyId: CompanyId;
  entryId: ChatEntryId;
  kind: ChatEntryKind;
  parentContainerId: ChatContainerId;
  title: string;
  titleStatus: ChatEntryTitleStatus;
  titleSourceMessageId?: MessageId;
  summary?: string;
  unreadCount: number;
  mentionCount: number;
  openTarget: ChatOpenTargetDto;
  runtimeLinks: ChatRuntimeLinkDto[];
  updatedAt: string;
}

export type ChatEntryContractDto = ChatContainerDto | ChatEntryDto | ChatRuntimeLinkDto | ChatChannelMemberDto;

export interface ChatEntryCompanyScopeInput {
  companyId: CompanyId;
  resourceCompanyId?: CompanyId;
}

export function ensureChatEntryCompanyScope(input: ChatEntryCompanyScopeInput): CompanyId {
  const companyId = input.companyId.trim();
  if (!companyId) {
    throw new Error("explicit companyId is required for Chat Entry access");
  }
  if (input.resourceCompanyId !== undefined && input.resourceCompanyId !== companyId) {
    throw new Error(`companyId mismatch: requested ${companyId} but resource belongs to ${input.resourceCompanyId}`);
  }
  return companyId;
}

export function assertChatEntryContractBoundary(value: unknown): asserts value is ChatEntryContractDto {
  assertNoForbiddenPublicCarrierFields(value);
  assertNoRuntimeEvidenceIdentityFields(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Chat Entry contract value must be an object");
  }

  const dto = value as Partial<ChatEntryContractDto>;
  ensureChatEntryCompanyScope({ companyId: String(dto.companyId ?? "") });
  if (dto.version !== CHAT_ENTRY_CONTRACT_VERSION) {
    throw new Error(`Chat Entry contract version must be ${CHAT_ENTRY_CONTRACT_VERSION}`);
  }

  if (dto.schema === CHAT_CONTAINER_DTO_SCHEMA) {
    assertChatContainerBoundary(dto as Partial<ChatContainerDto>);
    return;
  }
  if (dto.schema === CHAT_ENTRY_DTO_SCHEMA) {
    assertChatEntryBoundary(dto as Partial<ChatEntryDto>);
    return;
  }
  if (dto.schema === CHAT_RUNTIME_LINK_DTO_SCHEMA) {
    assertChatRuntimeLinkBoundary(dto as Partial<ChatRuntimeLinkDto>);
    return;
  }
  if (dto.schema === CHAT_CHANNEL_MEMBER_DTO_SCHEMA) {
    assertChatChannelMemberBoundary(dto as Partial<ChatChannelMemberDto>);
    return;
  }

  throw new Error(`unsupported Chat Entry schema: ${String(dto.schema)}`);
}

function assertChatContainerBoundary(container: Partial<ChatContainerDto>): void {
  assertNonEmptyString(container.containerId, "containerId is required for Chat containers");
  assertAllowed(container.kind, ["channel", "member_dm"], "Chat container kind");
  assertNonEmptyString(container.title, "title is required for Chat containers");
  assertNonNegativeInteger(container.unreadCount, "unreadCount");
  assertNonNegativeInteger(container.mentionCount, "mentionCount");
  assertNonNegativeInteger(container.entryCount, "entryCount");
  assertRuntimeLinks(container.runtimeLinks);
  if (container.kind === "channel") {
    assertNonEmptyString(container.chatChannelId, "chatChannelId is required for Chat Channel containers");
    if (!Array.isArray(container.members) || container.members.length === 0) {
      throw new Error("formal Chat Channel containers must include at least one Channel member");
    }
    for (const member of container.members) {
      assertChatChannelMemberBoundary(member);
    }
  }
}

function assertChatEntryBoundary(entry: Partial<ChatEntryDto>): void {
  assertNonEmptyString(entry.entryId, "entryId is required for Chat entries");
  assertAllowed(entry.kind, ["channel_topic", "dm_session_entry"], "Chat entry kind");
  assertNonEmptyString(entry.parentContainerId, "parentContainerId is required for Chat entries");
  assertNonEmptyString(entry.title, "title is required for Chat entries");
  assertAllowed(entry.titleStatus, ["placeholder", "generated", "manual", "failed"], "Chat entry titleStatus");
  assertNonNegativeInteger(entry.unreadCount, "unreadCount");
  assertNonNegativeInteger(entry.mentionCount, "mentionCount");
  assertOpenTarget(entry.kind, entry.openTarget);
  assertRuntimeLinks(entry.runtimeLinks);
  assertNonEmptyString(entry.updatedAt, "updatedAt is required for Chat entries");
}

function assertOpenTarget(entryKind: ChatEntryKind | undefined, openTarget: ChatOpenTargetDto | undefined): void {
  if (!openTarget || typeof openTarget !== "object") {
    throw new Error("openTarget is required for Chat entries");
  }
  assertNonEmptyString(openTarget.roomId, "openTarget.roomId is required for Chat entries");
  if (entryKind === "channel_topic" && openTarget.kind !== "topic_room") {
    throw new Error("channel_topic entries must open topic_room targets");
  }
  if (entryKind === "dm_session_entry" && openTarget.kind !== "dm_session_entry_room") {
    throw new Error("dm_session_entry entries must open dm_session_entry_room targets");
  }
}

function assertRuntimeLinks(runtimeLinks: ChatRuntimeLinkDto[] | undefined): void {
  if (!Array.isArray(runtimeLinks)) {
    throw new Error("runtimeLinks must be an array");
  }
  for (const link of runtimeLinks) {
    assertChatRuntimeLinkBoundary(link);
  }
}

function assertChatRuntimeLinkBoundary(link: Partial<ChatRuntimeLinkDto>): void {
  ensureChatEntryCompanyScope({ companyId: String(link.companyId ?? "") });
  if (link.schema !== CHAT_RUNTIME_LINK_DTO_SCHEMA) {
    throw new Error("runtimeLinks must use chat-runtime-link schema");
  }
  if (link.version !== CHAT_ENTRY_CONTRACT_VERSION) {
    throw new Error(`Chat runtime link version must be ${CHAT_ENTRY_CONTRACT_VERSION}`);
  }
  assertNonEmptyString(link.linkId, "linkId is required for Chat runtime links");
  assertAllowed(link.targetKind, ["session", "work_run", "process_trace", "session_event", "attachment"], "Chat runtime link targetKind");
  assertNonEmptyString(link.targetId, "targetId is required for Chat runtime links");
  assertNonEmptyString(link.createdAt, "createdAt is required for Chat runtime links");
}

function assertChatChannelMemberBoundary(member: Partial<ChatChannelMemberDto>): void {
  ensureChatEntryCompanyScope({ companyId: String(member.companyId ?? "") });
  if (member.schema !== CHAT_CHANNEL_MEMBER_DTO_SCHEMA) {
    throw new Error("Channel members must use chat-channel-member schema");
  }
  if (member.version !== CHAT_ENTRY_CONTRACT_VERSION) {
    throw new Error(`Chat Channel member version must be ${CHAT_ENTRY_CONTRACT_VERSION}`);
  }
  assertNonEmptyString(member.chatChannelId, "chatChannelId is required for Chat Channel members");
  if ("employeeId" in member) {
    throw new Error("Chat Channel member identity must use memberId");
  }
  assertNonEmptyString(member.memberId, "memberId is required for Chat Channel members");
  assertNonEmptyString(member.displayName, "displayName is required for Chat Channel members");
  if (typeof member.hasRuntimeProfile !== "boolean") {
    throw new Error("hasRuntimeProfile is required for Chat Channel members");
  }
  assertNonEmptyString(member.joinedAt, "joinedAt is required for Chat Channel members");
}

function assertNoRuntimeEvidenceIdentityFields(value: unknown): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoRuntimeEvidenceIdentityFields(item);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if ((FORBIDDEN_CHAT_ENTRY_IDENTITY_FIELD_NAMES as readonly string[]).includes(key)) {
      throw new Error(`public Chat Entry contract contains runtime evidence identity field: ${key}`);
    }
    assertNoRuntimeEvidenceIdentityFields(child);
  }
}

function assertAllowed<T extends string>(value: unknown, allowed: readonly T[], label: string): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}, got ${String(value)}`);
  }
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${String(value)}`);
  }
}
