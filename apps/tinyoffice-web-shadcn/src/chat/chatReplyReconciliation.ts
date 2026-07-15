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

export type ReconciledTimelineRow =
  | { kind: "message"; message: ChatMessage }
  | { kind: "draft"; persistedMessage?: ChatMessage };

export function reconciledTimelineRows(
  messages: ChatMessage[],
  draftReply: DraftReply | undefined,
): ReconciledTimelineRow[] {
  const persistedReply = persistedMessageForDraftReply(messages, draftReply);
  const rows: ReconciledTimelineRow[] = messages.map((message) =>
    message.messageId === persistedReply?.messageId
      ? { kind: "draft", persistedMessage: message }
      : { kind: "message", message }
  );

  if (draftReply && !persistedReply) {
    rows.push({ kind: "draft" });
  }
  return rows;
}
