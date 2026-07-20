import type { MessageDto, MessagePage, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import type { ComposerSubmitValue } from "./mentionComposerModel";

export function optimisticChatMessage(input: {
  companyId: string;
  roomId: string;
  session: TinyOfficeCurrentSession;
  value: ComposerSubmitValue;
  messageId: string;
  createdAt: string;
}): MessageDto {
  const memberId = input.session.member?.memberId ?? input.session.user.id;
  const displayName = input.session.member?.displayName ?? input.session.user.displayName ?? memberId;
  return {
    schema: "message",
    version: 1,
    companyId: input.companyId,
    conversationId: input.roomId,
    messageId: input.messageId,
    sender: {
      participantId: memberId,
      participantKind: "company_member",
      memberId,
      displayName,
    },
    body: input.value.body,
    mentions: [],
    attachments: (input.value.optimisticAttachments ?? []).map((attachment) => ({
      schema: "conversation-attachment",
      version: 1,
      companyId: input.companyId,
      conversationId: input.roomId,
      messageId: input.messageId,
      attachmentId: attachment.attachmentId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      byteLength: attachment.byteLength,
      previewUrl: attachment.previewUrl,
      createdAt: input.createdAt,
    })),
    runtimeLinks: [],
    createdAt: input.createdAt,
    deliveryState: "pending",
  };
}

export function appendOptimisticMessage(page: MessagePage | undefined, message: MessageDto): MessagePage {
  return {
    ...(page ?? { messages: [] }),
    messages: [...(page?.messages ?? []).filter((item) => item.messageId !== message.messageId), message],
  };
}

export function reconcileOptimisticMessage(
  page: MessagePage | undefined,
  optimisticMessageId: string,
  durableMessage: MessageDto,
): MessagePage {
  const existing = page?.messages ?? [];
  const withoutBoth = existing.filter((message) =>
    message.messageId !== optimisticMessageId && message.messageId !== durableMessage.messageId
  );
  const optimisticIndex = existing.findIndex((message) => message.messageId === optimisticMessageId);
  const insertAt = optimisticIndex < 0 ? withoutBoth.length : Math.min(optimisticIndex, withoutBoth.length);
  return {
    ...(page ?? { messages: [] }),
    messages: [
      ...withoutBoth.slice(0, insertAt),
      durableMessage,
      ...withoutBoth.slice(insertAt),
    ],
  };
}

export function removeOptimisticMessage(
  page: MessagePage | undefined,
  optimisticMessageId: string,
): MessagePage | undefined {
  if (!page) {
    return page;
  }
  return {
    ...page,
    messages: page.messages.filter((message) => message.messageId !== optimisticMessageId),
  };
}
