import { rm } from "node:fs/promises";
import path from "node:path";

import { endCompanyPostgresPool, openConfiguredPostgresConnection } from "../../runtime/company-config/postgres-runtime-connection.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresOpenOptions,
  CompanyPostgresPoolLike,
} from "../../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../../runtime/company-config/company-paths.js";
import {
  CHAT_CHANNEL_MEMBER_DTO_SCHEMA,
  CHAT_ENTRY_CONTRACT_VERSION,
  type ChatChannelMemberDto,
} from "../contracts/chat-entry-contract.js";
import type {
  ChannelParticipantIdentitySelector,
  ChannelRepository,
  ChatChannelRecord,
} from "./channel-service.js";

export interface PostgresChannelRepositoryOpenOptions extends CompanyPostgresOpenOptions {
  companyId: string;
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : undefined;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

export class PostgresChannelRepository implements ChannelRepository {
  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
    private readonly deleteAttachmentFiles: (localPaths: string[]) => Promise<void> = async () => undefined,
  ) {}

  static async open(repoRoot: string, options: PostgresChannelRepositoryOpenOptions): Promise<PostgresChannelRepository> {
    const companyId = normalizeCompanyId(options.companyId);
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("Channel Service requires PostgreSQL runtime configuration.");
    }
    return new PostgresChannelRepository(
      postgres.client,
      postgres.pool,
      companyId,
      (localPaths) => deleteLocalChatAttachmentFiles(repoRoot, companyId, localPaths),
    );
  }

  close(): void {
    this.client.release();
    void endCompanyPostgresPool(this.pool);
  }

  async upsertChannel(channel: ChatChannelRecord): Promise<ChatChannelRecord> {
    await this.client.query("BEGIN");
    try {
      await this.client.query(
        `INSERT INTO chat_channels (
  company_id, channel_id, title, summary, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (company_id, channel_id) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  updated_at = EXCLUDED.updated_at`,
        [
          channel.companyId,
          channel.chatChannelId,
          channel.title,
          channel.summary ?? null,
          channel.createdAt,
          channel.updatedAt,
        ],
      );
      await this.client.query(
        "DELETE FROM chat_channel_members WHERE company_id = $1 AND channel_id = $2",
        [channel.companyId, channel.chatChannelId],
      );
      for (const member of channel.members) {
        await this.client.query(
          `INSERT INTO chat_channel_members (
  company_id, channel_id, member_id, display_name, joined_at
)
VALUES ($1, $2, $3, $4, $5)`,
          [
            member.companyId,
            member.chatChannelId,
            member.memberId,
            member.displayName,
            member.joinedAt,
          ],
        );
      }
      await this.client.query("COMMIT");
    } catch (error) {
      await this.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    return await this.requireChannel(channel.companyId, channel.chatChannelId);
  }

  async deleteChannel(companyId: string, channelId: string): Promise<void> {
    let orphanedAttachmentPaths: string[] = [];
    await this.client.query("BEGIN");
    try {
      const activeExecutions = await this.client.query<{ conversation_id: string }>(
        `SELECT DISTINCT conversation.conversation_id
FROM conversations conversation
JOIN session_events event
  ON event.company_id = conversation.company_id
 AND event.payload_json ->> 'roomId' = conversation.conversation_id
JOIN session_records session
  ON session.company_id = event.company_id
 AND session.id = event.session_record_id
WHERE conversation.company_id = $1
  AND conversation.conversation_kind = 'topic'
  AND conversation.topic_state_json ->> 'chatChannelId' = $2
  AND session.status = 'running'
LIMIT 1`,
        [companyId, channelId],
      );
      if (activeExecutions.rows.length > 0) {
        const error = new Error(
          `Channel ${channelId} has active Chat execution in ${activeExecutions.rows[0].conversation_id}. Stop it before dissolving the Channel.`,
        ) as Error & { statusCode?: number };
        error.statusCode = 409;
        throw error;
      }
      await this.client.query(
        `UPDATE work_tasks task
SET metadata_json = COALESCE(task.metadata_json, '{}'::jsonb) || jsonb_build_object(
      'sourceConversationUnavailable', true,
      'sourceConversationUnavailableReason', 'Source Channel was dissolved.'
    ),
    updated_at = NOW()
WHERE task.company_id = $1
  AND task.metadata_json ->> 'conversationId' IN (
    SELECT conversation.conversation_id
    FROM conversations conversation
    WHERE conversation.company_id = $1
      AND conversation.conversation_kind = 'topic'
      AND conversation.topic_state_json ->> 'chatChannelId' = $2
  )`,
        [companyId, channelId],
      );
      await this.client.query(
        `UPDATE governance_approvals approval
SET status = 'canceled',
    decision_note = 'Source Channel was dissolved.',
    updated_at = NOW(),
    resolved_at = NOW()
WHERE approval.company_id = $1
  AND approval.context_kind = 'channel_topic'
  AND approval.status = 'pending'
  AND approval.context_id IN (
    SELECT conversation.conversation_id
    FROM conversations conversation
    WHERE conversation.company_id = $1
      AND conversation.conversation_kind = 'topic'
      AND conversation.topic_state_json ->> 'chatChannelId' = $2
  )`,
        [companyId, channelId],
      );
      await this.client.query(
        `DELETE FROM approval_grants grant_row
WHERE grant_row.company_id = $1
  AND grant_row.context_kind = 'channel_topic'
  AND grant_row.context_id IN (
    SELECT conversation.conversation_id
    FROM conversations conversation
    WHERE conversation.company_id = $1
      AND conversation.conversation_kind = 'topic'
      AND conversation.topic_state_json ->> 'chatChannelId' = $2
  )`,
        [companyId, channelId],
      );
      const deletedAttachments = await this.client.query<{ local_path: string }>(
        `DELETE FROM chat_attachments attachment
WHERE attachment.company_id = $1
  AND EXISTS (
    SELECT 1
    FROM chat_attachment_references reference
    JOIN conversations conversation
      ON conversation.company_id = reference.company_id
     AND conversation.conversation_id = reference.conversation_id
    WHERE reference.company_id = $1
      AND conversation.conversation_kind = 'topic'
      AND conversation.topic_state_json ->> 'chatChannelId' = $2
      AND reference.attachment_id = attachment.attachment_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM chat_attachment_references reference
    JOIN conversations conversation
      ON conversation.company_id = reference.company_id
     AND conversation.conversation_id = reference.conversation_id
    WHERE reference.company_id = $1
      AND NOT (
        conversation.conversation_kind = 'topic'
        AND conversation.topic_state_json ->> 'chatChannelId' = $2
      )
      AND reference.attachment_id = attachment.attachment_id
  )
RETURNING attachment.local_path`,
        [companyId, channelId],
      );
      orphanedAttachmentPaths = deletedAttachments.rows.map((row) => row.local_path);
      await this.client.query(
        `DELETE FROM conversations
WHERE company_id = $1
  AND conversation_kind = 'topic'
  AND topic_state_json ->> 'chatChannelId' = $2`,
        [companyId, channelId],
      );
      await this.client.query(
        "DELETE FROM chat_channels WHERE company_id = $1 AND channel_id = $2",
        [companyId, channelId],
      );
      await this.client.query("COMMIT");
    } catch (error) {
      await this.client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    try {
      await this.deleteAttachmentFiles(orphanedAttachmentPaths);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Channel ${channelId} was dissolved, but orphaned attachment file cleanup failed: ${message}`);
    }
  }

  async listChannelsForViewer(companyId: string, viewer: ChannelParticipantIdentitySelector): Promise<ChatChannelRecord[]> {
    const rows = await this.client.query<{ channel_id: string }>(
      `SELECT DISTINCT c.channel_id
FROM chat_channels c
JOIN chat_channel_members m ON m.company_id = c.company_id AND m.channel_id = c.channel_id
WHERE c.company_id = $1
  AND ($2::text IS NOT NULL AND m.member_id = $2::text)
ORDER BY c.channel_id ASC`,
      [companyId, viewer.memberId ?? null],
    );
    const channels: ChatChannelRecord[] = [];
    for (const row of rows.rows) {
      const channel = await this.getChannel(companyId, row.channel_id);
      if (channel) {
        channels.push(channel);
      }
    }
    return channels.sort((left, right) => left.title.localeCompare(right.title) || left.chatChannelId.localeCompare(right.chatChannelId));
  }

  async listChannelsForCompany(companyId: string): Promise<ChatChannelRecord[]> {
    const rows = await this.client.query<{ channel_id: string }>(
      `SELECT channel_id
FROM chat_channels
WHERE company_id = $1
ORDER BY title ASC, channel_id ASC`,
      [companyId],
    );
    const channels: ChatChannelRecord[] = [];
    for (const row of rows.rows) {
      const channel = await this.getChannel(companyId, row.channel_id);
      if (channel) {
        channels.push(channel);
      }
    }
    return channels.sort((left, right) => left.title.localeCompare(right.title) || left.chatChannelId.localeCompare(right.chatChannelId));
  }

  async getChannel(companyId: string, channelId: string): Promise<ChatChannelRecord | undefined> {
    const channelRows = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM chat_channels WHERE company_id = $1 AND channel_id = $2",
      [companyId, channelId],
    );
    const channel = channelRows.rows[0];
    if (!channel) {
      return undefined;
    }
    const memberRows = await this.client.query<Record<string, unknown>>(
      `SELECT
  m.*,
  COALESCE(member.display_name, m.display_name) AS authoritative_display_name,
  member.avatar_seed AS authoritative_avatar_seed,
  member.role AS authoritative_role,
  (runtime.member_id IS NOT NULL AND runtime.lifecycle_status = 'active') AS has_runtime_profile
FROM chat_channel_members m
LEFT JOIN company_members member
  ON member.company_id = m.company_id
 AND member.id = m.member_id
LEFT JOIN member_runtime_profiles runtime
  ON runtime.company_id = m.company_id
 AND runtime.member_id = m.member_id
WHERE m.company_id = $1 AND m.channel_id = $2
ORDER BY COALESCE(member.display_name, m.display_name) ASC`,
      [companyId, channelId],
    );
    return {
      companyId: String(channel.company_id),
      chatChannelId: String(channel.channel_id),
      title: String(channel.title),
      summary: typeof channel.summary === "string" ? channel.summary : undefined,
      members: memberRows.rows.map((row) => this.memberFromRow(row)),
      createdAt: timestamp(channel.created_at),
      updatedAt: timestamp(channel.updated_at),
    };
  }

  private async requireChannel(companyId: string, channelId: string): Promise<ChatChannelRecord> {
    const channel = await this.getChannel(companyId, channelId);
    if (!channel) {
      throw new Error(`Channel not found after upsert: ${channelId}`);
    }
    return channel;
  }

  private memberFromRow(row: Record<string, unknown>): ChatChannelMemberDto {
    return {
      schema: CHAT_CHANNEL_MEMBER_DTO_SCHEMA,
      version: CHAT_ENTRY_CONTRACT_VERSION,
      companyId: String(row.company_id),
      chatChannelId: String(row.channel_id),
      memberId: String(row.member_id),
      ...(typeof row.authoritative_avatar_seed === "string" && row.authoritative_avatar_seed.trim()
        ? { avatarSeed: row.authoritative_avatar_seed.trim() }
        : {}),
      displayName: String(row.authoritative_display_name ?? row.display_name),
      ...(typeof row.authoritative_role === "string" && row.authoritative_role.trim()
        ? { role: row.authoritative_role.trim() }
        : {}),
      hasRuntimeProfile: Boolean(row.has_runtime_profile),
      joinedAt: timestamp(row.joined_at),
    };
  }
}

async function deleteLocalChatAttachmentFiles(
  repoRoot: string,
  companyId: string,
  localPaths: string[],
): Promise<void> {
  const attachmentRoot = path.resolve(repoRoot, ".data", "companies", companyId, "chat-attachments");
  for (const localPath of localPaths) {
    const attachmentDirectory = path.resolve(path.dirname(localPath));
    const relative = path.relative(attachmentRoot, attachmentDirectory);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Attachment path is outside the Company attachment root: ${localPath}`);
    }
    await rm(attachmentDirectory, { recursive: true, force: true });
  }
}
