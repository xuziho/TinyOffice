import type {
  CompanyMemberId,
  ConversationDto,
  ParticipantId,
} from "../contracts/conversation-message-contract.js";

export interface ChatAccessIdentity {
  participantId?: ParticipantId;
  memberId?: CompanyMemberId;
}

export class ChatPermissionDeniedError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "ChatPermissionDeniedError";
  }
}

function optionalTrimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

export function chatIdentityLabel(identity: ChatAccessIdentity): string {
  return optionalTrimmed(identity.memberId) ||
    optionalTrimmed(identity.participantId) ||
    "unknown";
}

export function isChatParticipantAllowed(
  conversation: Pick<ConversationDto, "participants">,
  identity: ChatAccessIdentity,
): boolean {
  const participantId = optionalTrimmed(identity.participantId);
  const memberId = optionalTrimmed(identity.memberId);
  if (!participantId && !memberId) {
    return false;
  }
  return conversation.participants.some((participant) =>
    (participantId !== undefined && participant.participantId === participantId) ||
    (memberId !== undefined && participant.memberId === memberId)
  );
}

export function assertChatParticipantAccess(
  conversation: Pick<ConversationDto, "conversationId" | "participants">,
  identity: ChatAccessIdentity,
  label = "viewer",
): void {
  if (!isChatParticipantAllowed(conversation, identity)) {
    throw new ChatPermissionDeniedError(
      `${label} ${chatIdentityLabel(identity)} is not allowed to access Chat room ${conversation.conversationId}`,
    );
  }
}
