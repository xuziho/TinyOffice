import type { Context } from "hono";

import type { ChatParticipantIdentitySelector } from "../../collaboration/chat/chat-projection-service.js";
import type { ChatAccessIdentity } from "../../collaboration/chat/chat-permissions.js";
import type { MessageServiceParticipantSelector } from "../../collaboration/message/message-service.js";
import { currentMemberIdentity, currentMemberSession } from "./auth-helpers.js";
import type { TinyOfficeApiOptions } from "./contracts.js";
import { stringFrom } from "./parsing.js";

export function viewerIdentityFromRequest(options: TinyOfficeApiOptions, c: Context, companyId: string): MessageServiceParticipantSelector {
  return currentMemberIdentity(options, c, companyId);
}

export function actorIdentityFromRequest(
  options: TinyOfficeApiOptions,
  c: Context,
  body: Record<string, unknown>,
  companyId: string,
): MessageServiceParticipantSelector {
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

export function viewerIdentityFromReadRequest(
  options: TinyOfficeApiOptions,
  c: Context,
  body: Record<string, unknown>,
  companyId: string,
): MessageServiceParticipantSelector {
  const session = currentMemberSession(options, c, companyId);
  const bodyMemberId = stringFrom(body.viewerMemberId);
  if (bodyMemberId && bodyMemberId !== session.memberId) {
    throw new Error("viewerMemberId must match the current member session");
  }
  return { participantKind: "company_member", memberId: session.memberId };
}
