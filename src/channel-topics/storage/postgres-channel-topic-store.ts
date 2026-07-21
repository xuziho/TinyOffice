import { releaseCompanyPostgresConnection } from "../../runtime/company-config/postgres-runtime-connection.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresPoolLike,
} from "../../runtime/company-config/postgres-runtime-connection.js";
import type { ChannelTopic, Handoff } from "../domain/channel-topic.js";
import type { ChannelTopicState } from "../domain/channel-topic-state.js";
import type { ChannelTopicStore } from "./channel-topic-store.js";

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function timestampFromRow(value: unknown): string {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : undefined;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function seenCursors(value: unknown): ChannelTopic["seenCursors"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as ChannelTopic["seenCursors"];
}

export function topicFromRow(row: Record<string, unknown>): ChannelTopic {
  const ownerId = String(row.owner_member_id);
  const participantIds = stringArray(row.participant_member_ids_json);
  const roomId = typeof row.room_id === "string" && row.room_id ? row.room_id : undefined;
  const conversationId = typeof row.conversation_id === "string" && row.conversation_id
    ? row.conversation_id
    : roomId;
  const chatEntryId = typeof row.chat_entry_id === "string" && row.chat_entry_id
    ? row.chat_entry_id
    : undefined;
  return {
    id: String(row.id),
    ...(roomId ? { roomId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(chatEntryId ? { chatEntryId } : {}),
    identitySource: "tinyoffice_room",
    ownerId,
    participantIds: Array.from(new Set([ownerId, ...participantIds])),
    lastActivityAt: timestampFromRow(row.updated_at),
    seenCursors: seenCursors(row.seen_cursors_json),
  };
}

function handoffFromRow(row: Record<string, unknown>): Handoff {
  const roomId = typeof row.room_id === "string" && row.room_id ? row.room_id : undefined;
  const conversationId = typeof row.conversation_id === "string" && row.conversation_id
    ? row.conversation_id
    : roomId;
  const chatEntryId = typeof row.chat_entry_id === "string" && row.chat_entry_id
    ? row.chat_entry_id
    : undefined;
  const actionId = typeof row.action_id === "string" && row.action_id
    ? row.action_id
    : undefined;
  return {
    id: String(row.id),
    topicId: String(row.topic_id),
    ...(roomId ? { roomId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(chatEntryId ? { chatEntryId } : {}),
    ...(actionId ? { actionId } : {}),
    fromId: String(row.from_id),
    toId: String(row.to_id),
    message: String(row.message),
    createdAt: timestampFromRow(row.created_at),
  };
}

async function loadStateFromPostgres(
  client: CompanyPostgresClient,
  companyId: string,
): Promise<ChannelTopicState> {
  const topicRows = await client.query(
    "SELECT * FROM channel_topics WHERE company_id = $1 ORDER BY updated_at ASC, id ASC",
    [companyId],
  );
  const handoffRows = await client.query(
    "SELECT * FROM channel_topic_handoffs WHERE company_id = $1 ORDER BY created_at ASC, id ASC",
    [companyId],
  );
  return {
    channelTopics: topicRows.rows.map(topicFromRow),
    handoffs: handoffRows.rows.map(handoffFromRow),
  };
}

export class PostgresChannelTopicStore implements ChannelTopicStore {
  private updateChain: Promise<unknown> = Promise.resolve();
  private pendingWrites: Promise<unknown> = Promise.resolve();
  private pendingWriteCount = 0;
  private closed = false;

  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
    private state: ChannelTopicState,
  ) {}

  static async open(input: {
    client: CompanyPostgresClient;
    pool: CompanyPostgresPoolLike;
    companyId: string;
  }): Promise<PostgresChannelTopicStore> {
    return new PostgresChannelTopicStore(
      input.client,
      input.pool,
      input.companyId,
      await loadStateFromPostgres(input.client, input.companyId),
    );
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const release = () => releaseCompanyPostgresConnection({ client: this.client, pool: this.pool });
    if (this.pendingWriteCount === 0) {
      void release();
      return;
    }
    void this.pendingWrites
      .finally(release)
      .catch(() => undefined);
  }

  async load(): Promise<ChannelTopicState> {
    this.state = await loadStateFromPostgres(this.client, this.companyId);
    return {
      channelTopics: [...this.state.channelTopics],
      handoffs: [...this.state.handoffs],
    };
  }

  async save(state: ChannelTopicState): Promise<void> {
    this.state = {
      channelTopics: [...state.channelTopics],
      handoffs: [...state.handoffs],
    };
    for (const topic of this.state.channelTopics) {
      this.queueUpsertTopic(topic);
    }
    for (const handoff of this.state.handoffs) {
      this.queueUpsertHandoff(handoff);
    }
    await this.pendingWrites;
  }

  async update<T>(
    updater: (state: ChannelTopicState) => Promise<T> | T,
  ): Promise<T> {
    const run = async () => {
      const state = await this.load();
      const result = await updater(state);
      await this.save(state);
      return result;
    };
    const next = this.updateChain.then(run, run);
    this.updateChain = next.then(() => undefined, () => undefined);
    return next;
  }

  private queueUpsertTopic(topic: ChannelTopic) {
    this.queueQuery(
      `INSERT INTO channel_topics (
  company_id, id, title, status, owner_member_id, participant_member_ids_json,
  progress_summary, waiting_on_participant_id, room_id, conversation_id,
  chat_entry_id, identity_source,
  seen_cursors_json, created_at, updated_at
)
VALUES ($1, $2, $3, 'waiting_on_agent', $4, $5, '', NULL, $6, $7, $8, $9, $10, $11, $11)
ON CONFLICT (company_id, id) DO UPDATE SET
  title = EXCLUDED.title,
  owner_member_id = EXCLUDED.owner_member_id,
  participant_member_ids_json = EXCLUDED.participant_member_ids_json,
  room_id = EXCLUDED.room_id,
  conversation_id = EXCLUDED.conversation_id,
  chat_entry_id = EXCLUDED.chat_entry_id,
  identity_source = EXCLUDED.identity_source,
  seen_cursors_json = EXCLUDED.seen_cursors_json,
  updated_at = EXCLUDED.updated_at`,
      [
        this.companyId,
        topic.id,
        `Topic ${topic.id}`,
        topic.ownerId,
        JSON.stringify(topic.participantIds),
        topic.roomId || null,
        topic.conversationId || null,
        topic.chatEntryId || null,
        topic.identitySource,
        JSON.stringify(topic.seenCursors || {}),
        topic.lastActivityAt,
      ],
    );
  }

  private queueUpsertHandoff(handoff: Handoff) {
    this.queueQuery(
      `INSERT INTO channel_topic_handoffs (
  company_id, id, topic_id, room_id, conversation_id, chat_entry_id, action_id,
  from_id, to_id, message, created_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (company_id, id) DO UPDATE SET
  topic_id = EXCLUDED.topic_id,
  room_id = EXCLUDED.room_id,
  conversation_id = EXCLUDED.conversation_id,
  chat_entry_id = EXCLUDED.chat_entry_id,
  action_id = EXCLUDED.action_id,
  from_id = EXCLUDED.from_id,
  to_id = EXCLUDED.to_id,
  message = EXCLUDED.message,
  created_at = EXCLUDED.created_at`,
      [
        this.companyId,
        handoff.id,
        handoff.topicId,
        handoff.roomId || null,
        handoff.conversationId || null,
        handoff.chatEntryId || null,
        handoff.actionId || null,
        handoff.fromId,
        handoff.toId,
        handoff.message,
        handoff.createdAt,
      ],
    );
  }

  private queueQuery(sql: string, params?: readonly unknown[]) {
    this.pendingWriteCount += 1;
    this.pendingWrites = this.pendingWrites
      .then(() => this.client.query(sql, params))
      .finally(() => {
        this.pendingWriteCount -= 1;
      });
  }
}
