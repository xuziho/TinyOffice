import type {
  ConversationDto,
  ConversationPage,
  MarkConversationReadResult,
  MessagePage,
  SendMessageResult,
} from "../contracts/conversation-message-contract.js";
import type {
  MessageServiceCreateConversationInput,
  MessageServiceParticipantSelector,
  MessageServiceSendMessageOptions,
} from "../message/message-service.js";

export interface ConversationApiMessageService {
  createConversation(companyId: string, input: MessageServiceCreateConversationInput): Promise<ConversationDto>;
  listConversations(
    companyId: string,
    viewer: MessageServiceParticipantSelector,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<ConversationPage>;
  getConversation(companyId: string, conversationId: string): Promise<ConversationDto | undefined>;
  listMessages(
    companyId: string,
    conversationId: string,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<MessagePage>;
  listRecentMessages(
    companyId: string,
    conversationId: string,
    cursor?: { limit?: number },
  ): Promise<MessagePage>;
  sendMessage(
    companyId: string,
    conversationId: string,
    sender: MessageServiceParticipantSelector,
    body: string,
    options?: MessageServiceSendMessageOptions,
  ): Promise<SendMessageResult>;
  markConversationRead(
    companyId: string,
    conversationId: string,
    viewer: MessageServiceParticipantSelector,
    lastReadMessageId?: string,
  ): Promise<MarkConversationReadResult>;
}
