import type { Context } from "hono";

import type { MessageServiceParticipantSelector } from "../../collaboration/message/message-service.js";
import { assertCurrentMemberCompany, currentMemberFromRequest, currentSessionResponse, currentUserFromRequest, type TinyOfficeCurrentMemberSession } from "../../auth/tinyoffice-session.js";
import type { TinyOfficeApiOptions } from "./contracts.js";

export { currentMemberFromRequest, currentSessionResponse, currentUserFromRequest } from "../../auth/tinyoffice-session.js";

export function currentMemberSession(options: TinyOfficeApiOptions, c: Context, companyId: string): TinyOfficeCurrentMemberSession {
  void options;
  return assertCurrentMemberCompany(currentMemberFromRequest(c.req.raw), companyId);
}

export function currentMemberIdentity(options: TinyOfficeApiOptions, c: Context, companyId: string): MessageServiceParticipantSelector {
  const session = currentMemberSession(options, c, companyId);
  return { participantKind: "company_member", memberId: session.memberId };
}
