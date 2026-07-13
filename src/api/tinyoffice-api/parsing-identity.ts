import type { Context } from "hono";

import type { ChatParticipantIdentitySelector } from "../../collaboration/chat/chat-projection-service.js";
import type { ChatAccessIdentity } from "../../collaboration/chat/chat-permissions.js";
import type { MessageServiceParticipantSelector } from "../../collaboration/message/message-service.js";
import { authMode, currentMemberIdentity, currentMemberSession } from "./auth-helpers.js";
import type { TinyOfficeApiOptions } from "./contracts.js";
import { requireString, stringFrom } from "./parsing.js";

export function identityFromQuery(c: Context, fieldName: string): ChatParticipantIdentitySelector {
  const viewerMemberId = stringFrom(c.req.query(`${fieldName}MemberId`));
  if (viewerMemberId) {
    return { participantKind: "company_member", memberId: viewerMemberId };
  }
  throw new Error(`${fieldName} identity is required`);
}

export function viewerIdentityFromQuery(c: Context): MessageServiceParticipantSelector {
  return identityFromQuery(c, "viewer");
}

export function viewerIdentityFromRequest(options: TinyOfficeApiOptions, c: Context, companyId: string): MessageServiceParticipantSelector {
  return authMode(options) === "development-preview"
    ? viewerIdentityFromQuery(c)
    : currentMemberIdentity(options, c, companyId);
}

export function actorIdentityFromBody(body: Record<string, unknown>): MessageServiceParticipantSelector {
  const actorMemberId = stringFrom(body.actorMemberId);
  if (actorMemberId) {
    return { participantKind: "company_member", memberId: actorMemberId };
  }
  return { participantKind: "company_member", memberId: requireString(body, "actorMemberId") };
}

export function actorIdentityFromRequest(
  options: TinyOfficeApiOptions,
  c: Context,
  body: Record<string, unknown>,
  companyId: string,
): MessageServiceParticipantSelector {
  if (authMode(options) === "development-preview") {
    return actorIdentityFromBody(body);
  }
  const session = currentMemberSession(options, c, companyId);
  const bodyMemberId = stringFrom(body.actorMemberId);
  if (bodyMemberId && bodyMemberId !== session.memberId) {
    throw new Error("actorMemberId must match the current member session");
  }
  return { participantKind: "company_member", memberId: session.memberId };
}

export function chatParticipantIdentity(selector: MessageServiceParticipantSelector): ChatParticipantIdentitySelector {
  return selector;
}

export function chatAccessIdentity(selector: MessageServiceParticipantSelector): ChatAccessIdentity {
  return {
    participantId: selector.participantId,
    memberId: selector.memberId,
  };
}

export function viewerIdentityFromBody(body: Record<string, unknown>): MessageServiceParticipantSelector {
  const viewerMemberId = stringFrom(body.viewerMemberId);
  if (viewerMemberId) {
    return { participantKind: "company_member", memberId: viewerMemberId };
  }
  return { participantKind: "company_member", memberId: requireString(body, "viewerMemberId") };
}

export function viewerIdentityFromReadRequest(
  options: TinyOfficeApiOptions,
  c: Context,
  body: Record<string, unknown>,
  companyId: string,
): MessageServiceParticipantSelector {
  if (authMode(options) === "development-preview") {
    return viewerIdentityFromBody(body);
  }
  const session = currentMemberSession(options, c, companyId);
  const bodyMemberId = stringFrom(body.viewerMemberId);
  if (bodyMemberId && bodyMemberId !== session.memberId) {
    throw new Error("viewerMemberId must match the current member session");
  }
  return { participantKind: "company_member", memberId: session.memberId };
}
