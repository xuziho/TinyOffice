import { createHash } from "node:crypto";

import {
  assertNoForbiddenPublicCarrierFields,
  type ConversationDto,
  type MessageDto,
} from "../../collaboration/contracts/conversation-message-contract.js";
import { resolvePreferredLanguage } from "../language/preferred-language.js";
import { trimRequired, uniqueStrings } from "./tinyoffice-chat-turn-utils.js";

export type TinyOfficeChatTurnDispatchSource = "chat_entry" | "chat_room_message";
export type TinyOfficeChatTurnDispatchSceneType =
  | "chat_direct_room"
  | "chat_topic_room";
export type TinyOfficeChatTurnDispatchReason =
  | "mentioned_member"
  | "direct_room_peer"
  | "stable_random_topic_member"
  | "formal_structured_handoff";
export type TinyOfficeChatTurnDispatchIgnoredReason =
  | "actor_message_not_routable"
  | "member_actor_missing_employee_binding"
  | "no_target_member"
  | "unknown_target_member";

export interface TinyOfficeChatTurnDispatchInput {
  source: TinyOfficeChatTurnDispatchSource;
  companyId: string;
  roomId: string;
  actorMemberId?: string;
  messageId: string;
  body: string;
  mentionedMemberIds?: string[];
  entryId?: string;
  conversation: Pick<ConversationDto, "companyId" | "conversationId" | "conversationKind" | "participants">;
  employeeIds?: string[];
  env?: NodeJS.ProcessEnv;
  attemptId?: string;
}

export interface TinyOfficeChatTurnDispatchReady {
  kind: "routable";
  source: TinyOfficeChatTurnDispatchSource;
  reason: TinyOfficeChatTurnDispatchReason;
  eventKey: string;
  chainId: string;
  companyId: string;
  roomId: string;
  entryId?: string;
  messageId: string;
  actorMemberId?: string;
  targetMemberId: string;
  normalizedMessage: string;
  inheritedImageMessageIds?: string[];
  preferredLanguage: string;
  prefersChinese: boolean;
  sceneType: TinyOfficeChatTurnDispatchSceneType;
  sessionKey: string;
}

export interface TinyOfficeChatTurnDispatchIgnored {
  kind: "ignored";
  source: TinyOfficeChatTurnDispatchSource;
  reason: TinyOfficeChatTurnDispatchIgnoredReason;
  eventKey: string;
  companyId: string;
  roomId: string;
  entryId?: string;
  messageId: string;
  actorMemberId?: string;
  targetMemberId?: string;
}

export type TinyOfficeChatTurnDispatchDecision =
  | TinyOfficeChatTurnDispatchReady
  | TinyOfficeChatTurnDispatchIgnored;

export interface TinyOfficeChatTurnDispatchResolver {
  getConversation(companyId: string, roomId: string): Promise<ConversationDto | undefined>;
  getMessage?(companyId: string, roomId: string, messageId: string): Promise<MessageDto | undefined>;
}

export interface TinyOfficeChatTurnDispatchEvent {
  source: TinyOfficeChatTurnDispatchSource;
  companyId: string;
  roomId: string;
  actorMemberId?: string;
  messageId: string;
  body: string;
  mentionedMemberIds?: string[];
  entryId?: string;
  containerId?: string;
  openTargetKind?: string;
  attemptId?: string;
}

export class TinyOfficeChatTurnDispatchBoundary {
  constructor(private readonly config: {
    resolver: TinyOfficeChatTurnDispatchResolver;
    employeeIds?: string[] | (() => string[]);
    env?: NodeJS.ProcessEnv;
  }) {}

  async decide(event: TinyOfficeChatTurnDispatchEvent): Promise<TinyOfficeChatTurnDispatchDecision[]> {
    assertNoForbiddenPublicCarrierFields(event);
    const conversation = await this.config.resolver.getConversation(event.companyId, event.roomId);
    if (!conversation) {
      throw new Error(`Chat dispatch conversation not found: ${event.roomId}`);
    }
    return buildTinyOfficeChatTurnDispatches({
      ...event,
      conversation,
      employeeIds: typeof this.config.employeeIds === "function"
        ? this.config.employeeIds()
        : this.config.employeeIds,
      env: this.config.env,
    });
  }
}

export function buildTinyOfficeChatTurnDispatches(
  input: TinyOfficeChatTurnDispatchInput,
): TinyOfficeChatTurnDispatchDecision[] {
  assertNoForbiddenPublicCarrierFields(input);
  const companyId = trimRequired(input.companyId, "companyId");
  const roomId = trimRequired(input.roomId, "roomId");
  const actor = actorIdentity(input);
  const messageId = trimRequired(input.messageId, "messageId");
  const normalizedMessage = trimRequired(input.body, "body");
  assertConversationScope(input.conversation, companyId, roomId);

  const sceneType = sceneTypeFromConversation(input.conversation.conversationKind);
  const knownMemberIds = input.employeeIds
    ? new Set(input.employeeIds.map((employeeId) => employeeId.trim()).filter(Boolean))
    : undefined;
  const candidate = resolveTargetCandidate(input, actor.memberId, knownMemberIds);
  if (!candidate) {
    return [ignored(input, "no_target_member")];
  }

  const preferredLanguage = resolvePreferredLanguage({
    text: normalizedMessage,
    env: input.env || process.env,
  });
  if (actor.memberId && candidate.memberId === actor.memberId) {
    return [ignored(input, "actor_message_not_routable", candidate.memberId)];
  }
  if (knownMemberIds && !knownMemberIds.has(candidate.memberId)) {
    return [ignored(input, "unknown_target_member", candidate.memberId)];
  }
  return [{
      kind: "routable",
      source: input.source,
      reason: candidate.reason,
      eventKey: buildTinyOfficeChatTurnDispatchEventKey(input, candidate.memberId),
      chainId: buildTinyOfficeChatTurnChainId(input),
      companyId,
      roomId,
      ...(input.entryId ? { entryId: trimRequired(input.entryId, "entryId") } : {}),
      messageId,
      ...(actor.memberId ? { actorMemberId: actor.memberId } : {}),
      targetMemberId: candidate.memberId,
      normalizedMessage,
      preferredLanguage,
      prefersChinese: preferredLanguage.toLowerCase().startsWith("zh"),
      sceneType,
      sessionKey: `${candidate.memberId}|${sceneType}|${roomId}`,
    }];
}

export function buildTinyOfficeChatTurnChainId(
  input: Pick<TinyOfficeChatTurnDispatchInput, "companyId" | "roomId" | "messageId"> & { attemptId?: string },
): string {
  return [
    "tinyoffice_chat_chain",
    trimRequired(input.companyId, "companyId"),
    trimRequired(input.roomId, "roomId"),
    trimRequired(input.messageId, "messageId"),
    ...(input.attemptId ? [trimRequired(input.attemptId, "attemptId")] : []),
  ].join(":");
}

export function buildTinyOfficeChatTurnDispatchEventKey(
  input: Pick<TinyOfficeChatTurnDispatchInput, "source" | "companyId" | "roomId" | "messageId"> & { attemptId?: string },
  targetMemberId: string,
): string {
  return [
    "tinyoffice_chat",
    input.source,
    trimRequired(input.companyId, "companyId"),
    trimRequired(input.roomId, "roomId"),
    trimRequired(input.messageId, "messageId"),
    trimRequired(targetMemberId, "targetMemberId"),
    ...(input.attemptId ? [trimRequired(input.attemptId, "attemptId")] : []),
  ].join(":");
}

function resolveTargetCandidate(
  input: TinyOfficeChatTurnDispatchInput,
  actorMemberId: string | undefined,
  knownMemberIds: Set<string> | undefined,
): { memberId: string; reason: TinyOfficeChatTurnDispatchReason } | undefined {
  const mentioned = uniqueStrings(input.mentionedMemberIds || []);
  if (mentioned.length > 0) {
    return { memberId: mentioned[0] as string, reason: "mentioned_member" };
  }
  const participants = uniqueStrings(
    input.conversation.participants
      .map((participant) => participant.memberId)
      .filter((memberId): memberId is string => Boolean(memberId)),
  )
    .filter((memberId) => !actorMemberId || memberId !== actorMemberId);
  if (input.conversation.conversationKind === "direct") {
    const memberId = participants[0];
    return memberId ? { memberId, reason: "direct_room_peer" } : undefined;
  }
  const eligible = participants
    .filter((memberId) => !knownMemberIds || knownMemberIds.has(memberId))
    .sort((left, right) => left.localeCompare(right));
  if (eligible.length === 0) {
    return undefined;
  }
  const digest = createHash("sha256")
    .update([input.companyId, input.roomId, input.messageId].join(":"))
    .digest();
  const index = digest.readUInt32BE(0) % eligible.length;
  return { memberId: eligible[index] as string, reason: "stable_random_topic_member" };
}

function actorIdentity(input: Pick<TinyOfficeChatTurnDispatchInput, "actorMemberId">): {
  memberId?: string;
} {
  const actorMemberId = input.actorMemberId?.trim();
  if (actorMemberId) {
    return { memberId: actorMemberId };
  }
  return { memberId: trimRequired(actorMemberId, "actorMemberId") };
}

function sceneTypeFromConversation(kind: ConversationDto["conversationKind"]): TinyOfficeChatTurnDispatchSceneType {
  if (kind === "direct") {
    return "chat_direct_room";
  }
  if (kind === "topic") {
    return "chat_topic_room";
  }
  throw new Error(`Unsupported Chat conversationKind: ${kind}`);
}

function ignored(
  input: Pick<TinyOfficeChatTurnDispatchInput, "source" | "companyId" | "roomId" | "messageId" | "actorMemberId">,
  reason: TinyOfficeChatTurnDispatchIgnoredReason,
  targetMemberId?: string,
): TinyOfficeChatTurnDispatchIgnored {
  const actor = actorIdentity(input);
  return {
    kind: "ignored",
    source: input.source,
    reason,
    eventKey: buildTinyOfficeChatTurnDispatchEventKey(input, targetMemberId || actor.memberId || "unknown-actor"),
    companyId: trimRequired(input.companyId, "companyId"),
    roomId: trimRequired(input.roomId, "roomId"),
    messageId: trimRequired(input.messageId, "messageId"),
    ...(actor.memberId ? { actorMemberId: actor.memberId } : {}),
    targetMemberId,
  };
}

function assertConversationScope(
  conversation: TinyOfficeChatTurnDispatchInput["conversation"],
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
