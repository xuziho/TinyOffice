import type { Context } from "hono";

import { ensureChatEntryCompanyScope } from "../../collaboration/contracts/chat-entry-contract.js";
import { assertNoForbiddenPublicCarrierFields, type ConversationKind, type ConversationRuntimeLinkTargetKind, type ConversationTopicStatus } from "../../collaboration/contracts/conversation-message-contract.js";
import type { ChatCreateEntryInput } from "../../collaboration/chat/chat-create-entry-service.js";
import type {
  AddChannelMembersInput,
  ChannelMemberInput,
  ChannelParticipantIdentitySelector,
  CreateChannelInput,
  DissolveChannelInput,
  RemoveChannelMemberInput,
  UpdateChannelDetailsInput,
} from "../../collaboration/channel/channel-service.js";
import type { MessageServiceCreateConversationInput, MessageServiceSendMessageOptions } from "../../collaboration/message/message-service.js";
import { currentMemberSession } from "./auth-helpers.js";
import type { TinyOfficeApiOptions } from "./contracts.js";
import { validateBodyCompanyId } from "./parsing-company.js";
import { actorIdentityFromRequest, chatParticipantIdentity, viewerIdentityFromReadRequest } from "./parsing-identity.js";
import { assertKnownFields, optionalDisplayNames, optionalObjectArray, optionalStringArray, requireObjectBody, requireString, stringFrom } from "./parsing.js";

export function channelMemberInputs(value: unknown, fieldName: string): ChannelMemberInput[] {
  const members = optionalObjectArray(value, fieldName) || [];
  return members.map((member, index) => {
    if (stringFrom(member.employeeId)) {
      throw new Error(`${fieldName}[${index}].memberId is required; employeeId is not accepted for Channel members`);
    }
    return {
      memberId: requireString(member, "memberId"),
      displayName: requireString(member, "displayName"),
      hasRuntimeProfile: typeof member.hasRuntimeProfile === "boolean" ? member.hasRuntimeProfile : undefined,
    };
  });
}

export function parseChannelCreateBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
): CreateChannelInput {
  const body = requireObjectBody(value, "create Channel body");
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  const actor = chatParticipantIdentity(actorIdentityFromRequest(options, c, body, companyId));
  const sessionDisplayName = currentMemberSession(options, c, companyId).displayName;
  const actorDisplayName = sessionDisplayName || stringFrom(body.actorDisplayName);
  if (!actorDisplayName) {
    throw new Error("actor.displayName is required");
  }
  return {
    companyId,
    title: requireString(body, "title"),
    summary: stringFrom(body.summary),
    actor: {
      ...actor,
      displayName: actorDisplayName,
    },
    members: channelMemberInputs(body.members, "members"),
  };
}

export function parseAddChannelMembersBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
  channelId: string,
): AddChannelMembersInput {
  const body = requireObjectBody(value, "add Channel members body");
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  const members = channelMemberInputs(body.members, "members");
  if (members.length === 0) {
    throw new Error("members is required");
  }
  return {
    companyId,
    channelId,
    actor: chatParticipantIdentity(actorIdentityFromRequest(options, c, body, companyId)),
    members,
  };
}

export function parseUpdateChannelDetailsBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
  channelId: string,
): UpdateChannelDetailsInput {
  const body = requireObjectBody(value, "update Channel body");
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  return {
    companyId,
    channelId,
    actor: chatParticipantIdentity(actorIdentityFromRequest(options, c, body, companyId)),
    title: requireString(body, "title"),
    summary: stringFrom(body.summary),
  };
}

function channelMemberSelector(value: unknown, fieldName: string): ChannelParticipantIdentitySelector {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} is required`);
  }
  const body = value as Record<string, unknown>;
  const memberId = stringFrom(body.memberId);
  if (memberId) {
    return { participantKind: "company_member", memberId };
  }
  if (stringFrom(body.employeeId)) {
    throw new Error(`${fieldName}.memberId is required; employeeId is not accepted for Channel members`);
  }
  throw new Error(`${fieldName}.memberId is required`);
}

export function parseRemoveChannelMemberBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
  channelId: string,
): RemoveChannelMemberInput {
  const body = requireObjectBody(value, "remove Channel member body");
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  return {
    companyId,
    channelId,
    actor: chatParticipantIdentity(actorIdentityFromRequest(options, c, body, companyId)),
    member: channelMemberSelector(body.member, "member"),
  };
}

export function parseDissolveChannelBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
  channelId: string,
): DissolveChannelInput {
  const body = requireObjectBody(value, "dissolve Channel body");
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  const confirmation = requireString(body, "confirmation");
  if (confirmation !== "DELETE") {
    throw new Error("Channel dissolve confirmation must be DELETE");
  }
  return {
    companyId,
    channelId,
    actor: chatParticipantIdentity(actorIdentityFromRequest(options, c, body, companyId)),
    confirmation,
  };
}

export function runtimeLinksFromBody(value: unknown, fieldName: string) {
  return optionalObjectArray(value, fieldName)?.map((link) => ({
    linkId: stringFrom(link.linkId),
    targetKind: requireString(link, "targetKind") as ConversationRuntimeLinkTargetKind,
    targetId: requireString(link, "targetId"),
    label: stringFrom(link.label),
    sourceMessageId: stringFrom(link.sourceMessageId),
    createdAt: stringFrom(link.createdAt),
  }));
}

export function messageOptionsFromBody(body: Record<string, unknown>): MessageServiceSendMessageOptions {
  if (body.attachments !== undefined) {
    throw new Error("attachments metadata is not accepted by Chat message APIs; upload files and send attachmentIds");
  }
  return {
    attachmentIds: optionalStringArray(body.attachmentIds, "attachmentIds"),
    mentionedMemberIds: optionalStringArray(body.mentionedMemberIds, "mentionedMemberIds"),
    runtimeLinks: runtimeLinksFromBody(body.runtimeLinks, "runtimeLinks"),
  };
}

export function parseConversationCreateBody(value: unknown, companyId: string): MessageServiceCreateConversationInput {
  const body = requireObjectBody(value, "create conversation body");
  validateBodyCompanyId(body, companyId);
  const participants = optionalObjectArray(body.participants, "participants");
  if (!participants) {
    throw new Error("participants is required");
  }
  const topic = body.topic;
  return {
    title: requireString(body, "title"),
    conversationKind: requireString(body, "conversationKind") as ConversationKind,
    topic: topic && typeof topic === "object" && !Array.isArray(topic)
      ? {
        topicId: stringFrom((topic as Record<string, unknown>).topicId),
        chatChannelId: stringFrom((topic as Record<string, unknown>).chatChannelId),
        title: stringFrom((topic as Record<string, unknown>).title),
        status: stringFrom((topic as Record<string, unknown>).status) as ConversationTopicStatus | undefined,
        ownerParticipantId: stringFrom((topic as Record<string, unknown>).ownerParticipantId),
      }
      : undefined,
    runtimeLinks: runtimeLinksFromBody(body.runtimeLinks, "runtimeLinks"),
    participants: participants.map((participant, index) => {
      assertKnownFields(participant, ["participantKind", "memberId", "displayName", "role"], `participants[${index}]`);
      const participantKind = requireString(participant, "participantKind");
      if (participantKind !== "company_member") {
        throw new Error(`participants[${index}].participantKind must be company_member`);
      }
      return {
        participantKind: participantKind as MessageServiceCreateConversationInput["participants"][number]["participantKind"],
        memberId: requireString(participant, "memberId"),
        displayName: requireString(participant, "displayName"),
        role: stringFrom(participant.role),
      };
    }),
  };
}

export function parseSendBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
  label = "send message body",
) {
  const body = requireObjectBody(value, label);
  assertKnownFields(body, ["companyId", "actorMemberId", "actorDisplayName", "body", "attachmentIds", "mentionedMemberIds", "runtimeLinks"], label);
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  if (typeof body.body !== "string") {
    throw new Error("body is required");
  }
  return {
    actor: actorIdentityFromRequest(options, c, body, companyId),
    body: body.body.trim(),
    options: messageOptionsFromBody(body),
  };
}

export function parseReadBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
  label = "mark read body",
) {
  const body = requireObjectBody(value, label);
  assertKnownFields(body, ["companyId", "viewerMemberId", "lastReadMessageId"], label);
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  return {
    viewer: viewerIdentityFromReadRequest(options, c, body, companyId),
    lastReadMessageId: stringFrom(body.lastReadMessageId),
  };
}

export function parseUpdateTitleBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
  label = "update Chat room title body",
) {
  const body = requireObjectBody(value, label);
  assertKnownFields(body, ["companyId", "actorMemberId", "title"], label);
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  return {
    actor: actorIdentityFromRequest(options, c, body, companyId),
    title: requireString(body, "title"),
  };
}

export function parseArchiveTopicBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
  label = "archive Chat room body",
) {
  const body = requireObjectBody(value, label);
  assertKnownFields(body, ["companyId", "actorMemberId", "confirmation"], label);
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  const confirmation = requireString(body, "confirmation");
  if (confirmation !== "ARCHIVE") {
    throw new Error("Chat room archive confirmation must be ARCHIVE");
  }
  return {
    actor: actorIdentityFromRequest(options, c, body, companyId),
    confirmation,
  };
}

export function parseRestoreTopicBody(
  options: TinyOfficeApiOptions,
  c: Context,
  value: unknown,
  companyId: string,
  label = "restore Chat room body",
) {
  const body = requireObjectBody(value, label);
  assertKnownFields(body, ["companyId", "actorMemberId", "confirmation"], label);
  assertNoForbiddenPublicCarrierFields(body);
  validateBodyCompanyId(body, companyId);
  const confirmation = requireString(body, "confirmation");
  if (confirmation !== "RESTORE") {
    throw new Error("Chat room restore confirmation must be RESTORE");
  }
  return {
    actor: actorIdentityFromRequest(options, c, body, companyId),
    confirmation,
  };
}

export function actorIdentityFieldsFromRequest(
  options: TinyOfficeApiOptions,
  c: Context,
  body: Record<string, unknown>,
  companyId: string,
): Pick<ChatCreateEntryInput, "actorMemberId"> {
  const session = currentMemberSession(options, c, companyId);
  const bodyMemberId = stringFrom(body.actorMemberId);
  if (bodyMemberId && bodyMemberId !== session.memberId) {
    throw new Error("actorMemberId must match the current member session");
  }
  return { actorMemberId: session.memberId };
}

export function parseCreateEntryBody(options: TinyOfficeApiOptions, c: Context, value: unknown, companyId: string): ChatCreateEntryInput {
  const body = requireObjectBody(value, "create Chat entry body");
  assertKnownFields(body, ["companyId", "containerId", "actorMemberId", "actorDisplayName", "title", "memberDisplayNames", "firstMessage"], "create Chat entry body");
  ensureChatEntryCompanyScope({
    companyId,
    resourceCompanyId: requireString(body, "companyId"),
  });
  const firstMessage = body.firstMessage;
  if (!firstMessage || typeof firstMessage !== "object" || Array.isArray(firstMessage)) {
    throw new Error("firstMessage is required");
  }
  const firstMessageBody = firstMessage as Record<string, unknown>;
  assertKnownFields(firstMessageBody, ["body", "attachmentIds", "mentionedMemberIds", "runtimeLinks"], "firstMessage");
  if (firstMessageBody.attachments !== undefined) {
    throw new Error("attachments metadata is not accepted by Chat message APIs; upload files and send attachmentIds");
  }
  if (firstMessageBody.body !== undefined && typeof firstMessageBody.body !== "string") {
    throw new Error("firstMessage.body must be a string");
  }
  return {
    companyId,
    containerId: requireString(body, "containerId"),
    ...actorIdentityFieldsFromRequest(options, c, body, companyId),
    ...(stringFrom(body.actorDisplayName)
      ? { actorDisplayName: stringFrom(body.actorDisplayName) }
      : {}),
    title: stringFrom(body.title),
    memberDisplayNames: optionalDisplayNames(body.memberDisplayNames),
    firstMessage: {
      body: typeof firstMessageBody.body === "string" ? firstMessageBody.body.trim() : "",
      attachmentIds: optionalStringArray(firstMessageBody.attachmentIds, "firstMessage.attachmentIds"),
      mentionedMemberIds: optionalStringArray(firstMessageBody.mentionedMemberIds, "firstMessage.mentionedMemberIds"),
      runtimeLinks: runtimeLinksFromBody(firstMessageBody.runtimeLinks, "firstMessage.runtimeLinks"),
    },
  };
}
