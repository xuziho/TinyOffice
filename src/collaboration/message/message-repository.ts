import type {
  ConversationDto,
  MessageDto,
} from "../contracts/conversation-message-contract.js";

export interface ConversationRecord {
  conversation: ConversationDto;
}

export interface MessageRecord {
  message: MessageDto;
}

export interface MessageRepositoryPageInput {
  companyId: string;
  cursor?: string;
  limit?: number;
}

export interface MessageRepositoryAfterCursorInput {
  companyId: string;
  conversationId: string;
  afterCreatedAt: string;
  afterMessageId: string;
}

export interface MessageRepositoryConversationIdsInput {
  companyId: string;
  conversationIds: string[];
}

export interface MessageRepositoryConversationListInput extends MessageRepositoryPageInput {
  viewerMemberId?: string;
  viewerParticipantId?: string;
}

export interface MessageRepository {
  runInTransaction<T>(run: () => Promise<T>): Promise<T>;
  upsertConversation(record: ConversationRecord): Promise<void>;
  getConversation(companyId: string, conversationId: string): Promise<ConversationRecord | undefined>;
  findConversationCompanyId(conversationId: string): Promise<string | undefined>;
  listConversations(input: MessageRepositoryConversationListInput): Promise<ConversationRecord[]>;
  upsertMessage(record: MessageRecord): Promise<void>;
  listFirstMessages(input: MessageRepositoryConversationIdsInput): Promise<MessageRecord[]>;
  listMessages(input: MessageRepositoryPageInput & { conversationId: string }): Promise<MessageRecord[]>;
  listRecentMessages(input: MessageRepositoryPageInput & { conversationId: string }): Promise<MessageRecord[]>;
  listMessagesAfter(input: MessageRepositoryAfterCursorInput): Promise<MessageRecord[]>;
}

function cloneConversationRecord(record: ConversationRecord): ConversationRecord {
  return {
    conversation: {
      ...record.conversation,
      topic: record.conversation.topic ? {
        ...record.conversation.topic,
        participantIds: [...record.conversation.topic.participantIds],
        summary: record.conversation.topic.summary ? { ...record.conversation.topic.summary } : undefined,
      } : undefined,
      participants: record.conversation.participants.map((participant) => ({ ...participant })),
      participantStates: (record.conversation.participantStates || []).map((state) => ({ ...state })),
      runtimeLinks: (record.conversation.runtimeLinks || []).map((link) => ({ ...link })),
      titleStatus: record.conversation.titleStatus,
      titleSourceMessageId: record.conversation.titleSourceMessageId,
      titleFailureReason: record.conversation.titleFailureReason,
      realtimeSequence: record.conversation.realtimeSequence ?? 0,
    },
  };
}

function cloneMessageRecord(record: MessageRecord): MessageRecord {
  return {
    message: {
      ...record.message,
      sender: { ...record.message.sender },
      mentions: (record.message.mentions || []).map((mention) => ({ ...mention })),
      attachments: record.message.attachments.map((attachment) => ({
        ...attachment,
        metadata: attachment.metadata ? { ...attachment.metadata } : undefined,
      })),
      runtimeLinks: (record.message.runtimeLinks || []).map((link) => ({ ...link })),
    },
  };
}

function page<T>(items: T[], cursor?: string, limit?: number): T[] {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  const offset = Number.isFinite(start) && start > 0 ? start : 0;
  const count = limit && limit > 0 ? limit : items.length;
  return items.slice(offset, offset + count);
}

export class InMemoryMessageRepository implements MessageRepository {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, MessageRecord>();

  async runInTransaction<T>(run: () => Promise<T>): Promise<T> {
    const conversations = new Map(this.conversations);
    const messages = new Map(this.messages);
    try {
      return await run();
    } catch (error) {
      this.restoreMap(this.conversations, conversations);
      this.restoreMap(this.messages, messages);
      throw error;
    }
  }

  async upsertConversation(record: ConversationRecord): Promise<void> {
    this.conversations.set(
      this.conversationKey(record.conversation.companyId, record.conversation.conversationId),
      cloneConversationRecord(record),
    );
  }

  async getConversation(companyId: string, conversationId: string): Promise<ConversationRecord | undefined> {
    const record = this.conversations.get(this.conversationKey(companyId, conversationId));
    return record ? cloneConversationRecord(record) : undefined;
  }

  async findConversationCompanyId(conversationId: string): Promise<string | undefined> {
    for (const record of this.conversations.values()) {
      if (record.conversation.conversationId === conversationId) {
        return record.conversation.companyId;
      }
    }
    return undefined;
  }

  async listConversations(input: MessageRepositoryConversationListInput): Promise<ConversationRecord[]> {
    const records = [...this.conversations.values()]
      .filter((record) =>
        record.conversation.companyId === input.companyId &&
        record.conversation.participants.some((participant) =>
          (input.viewerMemberId !== undefined && participant.memberId === input.viewerMemberId) ||
          (input.viewerParticipantId !== undefined && participant.participantId === input.viewerParticipantId)
        )
      )
      .sort((left, right) =>
        left.conversation.updatedAt.localeCompare(right.conversation.updatedAt) ||
        left.conversation.conversationId.localeCompare(right.conversation.conversationId)
      );
    return page(records, input.cursor, input.limit).map(cloneConversationRecord);
  }

  async upsertMessage(record: MessageRecord): Promise<void> {
    this.messages.set(this.messageKey(record.message.companyId, record.message.messageId), cloneMessageRecord(record));
  }

  async listFirstMessages(input: MessageRepositoryConversationIdsInput): Promise<MessageRecord[]> {
    const requested = new Set(input.conversationIds);
    const firstByConversation = new Map<string, MessageRecord>();
    for (const record of [...this.messages.values()]
      .filter((candidate) => candidate.message.companyId === input.companyId && requested.has(candidate.message.conversationId))
      .sort((left, right) =>
        left.message.createdAt.localeCompare(right.message.createdAt) ||
        left.message.messageId.localeCompare(right.message.messageId)
      )) {
      if (!firstByConversation.has(record.message.conversationId)) {
        firstByConversation.set(record.message.conversationId, record);
      }
    }
    return [...firstByConversation.values()].map(cloneMessageRecord);
  }

  async listMessages(input: MessageRepositoryPageInput & { conversationId: string }): Promise<MessageRecord[]> {
    const records = [...this.messages.values()]
      .filter((record) =>
        record.message.companyId === input.companyId &&
        record.message.conversationId === input.conversationId
      )
      .sort((left, right) =>
        left.message.createdAt.localeCompare(right.message.createdAt) ||
        left.message.messageId.localeCompare(right.message.messageId)
      );
    return page(records, input.cursor, input.limit).map(cloneMessageRecord);
  }

  async listRecentMessages(input: MessageRepositoryPageInput & { conversationId: string }): Promise<MessageRecord[]> {
    const limit = input.limit && input.limit > 0 ? input.limit : 100;
    const records = [...this.messages.values()]
      .filter((record) =>
        record.message.companyId === input.companyId &&
        record.message.conversationId === input.conversationId
      )
      .sort((left, right) =>
        right.message.createdAt.localeCompare(left.message.createdAt) ||
        right.message.messageId.localeCompare(left.message.messageId)
      )
      .slice(0, limit)
      .sort((left, right) =>
        left.message.createdAt.localeCompare(right.message.createdAt) ||
        left.message.messageId.localeCompare(right.message.messageId)
      );
    return records.map(cloneMessageRecord);
  }

  async listMessagesAfter(input: MessageRepositoryAfterCursorInput): Promise<MessageRecord[]> {
    const records = [...this.messages.values()]
      .filter((record) =>
        record.message.companyId === input.companyId &&
        record.message.conversationId === input.conversationId &&
        (
          record.message.createdAt.localeCompare(input.afterCreatedAt) > 0 ||
          (
            record.message.createdAt === input.afterCreatedAt &&
            record.message.messageId.localeCompare(input.afterMessageId) > 0
          )
        )
      )
      .sort((left, right) =>
        left.message.createdAt.localeCompare(right.message.createdAt) ||
        left.message.messageId.localeCompare(right.message.messageId)
      );
    return records.map(cloneMessageRecord);
  }

  private conversationKey(companyId: string, conversationId: string) {
    return `${companyId}\0${conversationId}`;
  }

  private messageKey(companyId: string, messageId: string) {
    return `${companyId}\0${messageId}`;
  }

  private restoreMap<TKey, TValue>(target: Map<TKey, TValue>, snapshot: Map<TKey, TValue>): void {
    target.clear();
    for (const [key, value] of snapshot) {
      target.set(key, value);
    }
  }
}
