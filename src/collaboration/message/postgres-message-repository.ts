import { endCompanyPostgresPool, openConfiguredPostgresConnection } from "../../runtime/company-config/postgres-runtime-connection.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresOpenOptions,
  CompanyPostgresPoolLike,
} from "../../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../../runtime/company-config/company-paths.js";
import type {
  ConversationRecord,
  MessageRecord,
  MessageRepository,
  MessageRepositoryAfterCursorInput,
  MessageRepositoryConversationListInput,
  MessageRepositoryPageInput,
} from "./message-repository.js";

function timestamp(value: unknown): string {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "object") {
    return value as T;
  }
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export interface PostgresMessageRepositoryOpenOptions extends CompanyPostgresOpenOptions {
  companyId: string;
}

export class PostgresMessageRepository implements MessageRepository {
  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
  ) {}

  static async open(repoRoot: string, options: PostgresMessageRepositoryOpenOptions): Promise<PostgresMessageRepository> {
    const companyId = normalizeCompanyId(options.companyId);
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("Message Service requires PostgreSQL runtime configuration.");
    }
    return new PostgresMessageRepository(postgres.client, postgres.pool, companyId);
  }

  close(): void {
    this.client.release();
    void endCompanyPostgresPool(this.pool);
  }

  async runInTransaction<T>(run: () => Promise<T>): Promise<T> {
    await this.client.query("BEGIN");
    try {
      const result = await run();
      await this.client.query("COMMIT");
      return result;
    } catch (error) {
      await this.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  async upsertConversation(record: ConversationRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO conversations (
  company_id, conversation_id, title, title_status, title_source_message_id, title_failure_reason, conversation_kind, participants_json,
  topic_state_json, participant_states_json, last_message_id, runtime_links_json,
  realtime_sequence, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
ON CONFLICT (company_id, conversation_id) DO UPDATE SET
  title = EXCLUDED.title,
  title_status = EXCLUDED.title_status,
  title_source_message_id = EXCLUDED.title_source_message_id,
  title_failure_reason = EXCLUDED.title_failure_reason,
  conversation_kind = EXCLUDED.conversation_kind,
  participants_json = EXCLUDED.participants_json,
  topic_state_json = EXCLUDED.topic_state_json,
  participant_states_json = EXCLUDED.participant_states_json,
  last_message_id = EXCLUDED.last_message_id,
  runtime_links_json = EXCLUDED.runtime_links_json,
  realtime_sequence = EXCLUDED.realtime_sequence,
  updated_at = EXCLUDED.updated_at`,
      [
        record.conversation.companyId,
        record.conversation.conversationId,
        record.conversation.title,
        record.conversation.titleStatus ?? "manual",
        record.conversation.titleSourceMessageId ?? null,
        record.conversation.titleFailureReason ?? null,
        record.conversation.conversationKind,
        JSON.stringify(record.conversation.participants),
        JSON.stringify(record.conversation.topic ?? null),
        JSON.stringify(record.conversation.participantStates || []),
        record.conversation.lastMessageId ?? null,
        JSON.stringify(record.conversation.runtimeLinks || []),
        record.conversation.realtimeSequence ?? 0,
        record.conversation.createdAt,
        record.conversation.updatedAt,
      ],
    );
    for (const participant of record.conversation.participants) {
      await this.client.query(
        `INSERT INTO conversation_participants (
  company_id, conversation_id, participant_id, participant_kind, member_id,
  display_name, role, joined_at, left_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (company_id, conversation_id, participant_id) DO UPDATE SET
  participant_kind = EXCLUDED.participant_kind,
  member_id = EXCLUDED.member_id,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  joined_at = EXCLUDED.joined_at,
  left_at = EXCLUDED.left_at`,
        [
          participant.companyId,
          participant.conversationId,
          participant.participantId,
          participant.participantKind,
          participant.memberId ?? null,
          participant.displayName,
          participant.role ?? null,
          participant.joinedAt,
          participant.leftAt ?? null,
        ],
      );
    }
  }

  async getConversation(companyId: string, conversationId: string): Promise<ConversationRecord | undefined> {
    const rows = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM conversations WHERE company_id = $1 AND conversation_id = $2",
      [companyId, conversationId],
    );
    const row = rows.rows[0];
    return row ? { conversation: this.conversationFromRow(row) } : undefined;
  }

  async findConversationCompanyId(conversationId: string): Promise<string | undefined> {
    const rows = await this.client.query<{ company_id: string }>(
      "SELECT company_id FROM conversations WHERE conversation_id = $1 ORDER BY company_id ASC LIMIT 1",
      [conversationId],
    );
    return rows.rows[0]?.company_id;
  }

  async listConversations(input: MessageRepositoryConversationListInput): Promise<ConversationRecord[]> {
    const rows = await this.client.query<Record<string, unknown>>(
      `SELECT c.*
FROM conversations c
JOIN conversation_participants p ON p.company_id = c.company_id AND p.conversation_id = c.conversation_id
WHERE c.company_id = $1
  AND (
    ($2::text IS NOT NULL AND p.member_id = $2::text)
    OR ($3::text IS NOT NULL AND p.participant_id = $3::text)
  )
ORDER BY c.updated_at ASC, c.conversation_id ASC
LIMIT $4 OFFSET $5`,
      [
        input.companyId,
        input.viewerMemberId ?? null,
        input.viewerParticipantId ?? null,
        input.limit ?? 100,
        input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0,
      ],
    );
    return rows.rows.map((row) => ({ conversation: this.conversationFromRow(row) }));
  }

  async upsertMessage(record: MessageRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO conversation_messages (
  company_id, conversation_id, message_id, sender_json, body, attachments_json,
  mentions_json, runtime_links_json, delivery_state, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (company_id, message_id) DO UPDATE SET
  sender_json = EXCLUDED.sender_json,
  body = EXCLUDED.body,
  attachments_json = EXCLUDED.attachments_json,
  mentions_json = EXCLUDED.mentions_json,
  runtime_links_json = EXCLUDED.runtime_links_json,
  delivery_state = EXCLUDED.delivery_state,
  updated_at = EXCLUDED.updated_at`,
      [
        record.message.companyId,
        record.message.conversationId,
        record.message.messageId,
        JSON.stringify(record.message.sender),
        record.message.body,
        JSON.stringify(record.message.attachments),
        JSON.stringify(record.message.mentions || []),
        JSON.stringify(record.message.runtimeLinks || []),
        record.message.deliveryState,
        record.message.createdAt,
        record.message.updatedAt ?? record.message.createdAt,
      ],
    );
    await this.client.query(
      "DELETE FROM chat_attachment_references WHERE company_id = $1 AND message_id = $2",
      [record.message.companyId, record.message.messageId],
    );
    for (const attachment of record.message.attachments) {
      await this.client.query(
        `INSERT INTO chat_attachment_references (
  company_id, attachment_id, message_id, conversation_id, created_at
) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (company_id, attachment_id, message_id) DO UPDATE SET
  conversation_id = EXCLUDED.conversation_id,
  created_at = EXCLUDED.created_at`,
        [
          record.message.companyId,
          attachment.attachmentId,
          record.message.messageId,
          record.message.conversationId,
          record.message.createdAt,
        ],
      );
    }
  }

  async listMessages(input: MessageRepositoryPageInput & { conversationId: string }): Promise<MessageRecord[]> {
    const rows = await this.client.query<Record<string, unknown>>(
      `SELECT * FROM conversation_messages
WHERE company_id = $1 AND conversation_id = $2
ORDER BY created_at ASC, message_id ASC
LIMIT $3 OFFSET $4`,
      [input.companyId, input.conversationId, input.limit ?? 100, input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0],
    );
    return rows.rows.map((row) => ({ message: this.messageFromRow(row) }));
  }

  async listRecentMessages(input: MessageRepositoryPageInput & { conversationId: string }): Promise<MessageRecord[]> {
    const rows = await this.client.query<Record<string, unknown>>(
      `SELECT * FROM (
  SELECT * FROM conversation_messages
  WHERE company_id = $1 AND conversation_id = $2
  ORDER BY created_at DESC, message_id DESC
  LIMIT $3
) recent_messages
ORDER BY created_at ASC, message_id ASC`,
      [input.companyId, input.conversationId, input.limit ?? 100],
    );
    return rows.rows.map((row) => ({ message: this.messageFromRow(row) }));
  }

  async listMessagesAfter(input: MessageRepositoryAfterCursorInput): Promise<MessageRecord[]> {
    const rows = await this.client.query<Record<string, unknown>>(
      `SELECT * FROM conversation_messages
WHERE company_id = $1
  AND conversation_id = $2
  AND (created_at > $3 OR (created_at = $3 AND message_id > $4))
ORDER BY created_at ASC, message_id ASC`,
      [input.companyId, input.conversationId, input.afterCreatedAt, input.afterMessageId],
    );
    return rows.rows.map((row) => ({ message: this.messageFromRow(row) }));
  }

  private conversationFromRow(row: Record<string, unknown>) {
    return {
      schema: "conversation" as const,
      version: 1 as const,
      companyId: String(row.company_id),
      conversationId: String(row.conversation_id),
      title: String(row.title),
      titleStatus: textValue(row.title_status) as "placeholder" | "generated" | "manual" | "failed" | undefined,
      titleSourceMessageId: textValue(row.title_source_message_id),
      titleFailureReason: textValue(row.title_failure_reason),
      conversationKind: row.conversation_kind as "direct" | "shared" | "topic",
      topic: jsonValue(row.topic_state_json, undefined),
      participants: jsonValue(row.participants_json, []),
      participantStates: jsonValue(row.participant_states_json, []),
      lastMessageId: typeof row.last_message_id === "string" ? row.last_message_id : undefined,
      runtimeLinks: jsonValue(row.runtime_links_json, []),
      realtimeSequence: numberValue(row.realtime_sequence),
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
    };
  }

  private messageFromRow(row: Record<string, unknown>) {
    return {
      schema: "message" as const,
      version: 1 as const,
      companyId: String(row.company_id),
      conversationId: String(row.conversation_id),
      messageId: String(row.message_id),
      sender: row.sender_json && typeof row.sender_json === "object"
        ? row.sender_json as never
        : JSON.parse(String(row.sender_json || "{}")),
      body: String(row.body),
      mentions: jsonValue(row.mentions_json, []),
      attachments: jsonValue(row.attachments_json, []),
      runtimeLinks: jsonValue(row.runtime_links_json, []),
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
      deliveryState: row.delivery_state as "pending" | "sent" | "failed" | "deleted",
    };
  }
}
