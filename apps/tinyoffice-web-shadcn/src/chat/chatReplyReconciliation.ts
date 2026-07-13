import type { MessagePage } from "tinyoffice/frontend-api-contracts";
import type { DraftReply } from "./chatRunState";

type ChatMessage = MessagePage["messages"][number];

export function persistedMessageForDraftReply(
  messages: ChatMessage[],
  draftReply: DraftReply | undefined,
): ChatMessage | undefined {
  if (!draftReply) {
    return undefined;
  }
  if (draftReply.replyMessageId) {
    const replyById = messages.find((message) => message.messageId === draftReply.replyMessageId);
    if (replyById) {
      return replyById;
    }
  }
  return messages.find((message) =>
    message.sender.memberId === draftReply.targetMemberId &&
    message.runtimeLinks.some((link) => link.sourceMessageId === draftReply.sourceMessageId)
  );
}

export function messagesWithoutReconciledReply(
  messages: ChatMessage[],
  persistedReply: ChatMessage | undefined,
): ChatMessage[] {
  return persistedReply
    ? messages.filter((message) => message.messageId !== persistedReply.messageId)
    : messages;
}
