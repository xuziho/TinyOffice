import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Pool } from "pg";

import { PostgresChannelRepository } from "../../src/collaboration/channel/postgres-channel-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";

const timestamp = "2026-07-13T08:00:00.000Z";

test("Channel dissolve closes Topic Access and deletes only attachment files without surviving Message references", async () => {
  const databaseUrl = process.env.TINYOFFICE_DATABASE_URL;
  assert.ok(databaseUrl);
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-channel-dissolve-"));
  const orphanPath = path.join(repoRoot, ".data", "companies", DEFAULT_COMPANY_ID, "chat-attachments", "att-orphan", "original");
  const sharedPath = path.join(repoRoot, ".data", "companies", DEFAULT_COMPANY_ID, "chat-attachments", "att-shared", "original");
  await mkdir(path.dirname(orphanPath), { recursive: true });
  await mkdir(path.dirname(sharedPath), { recursive: true });
  await writeFile(orphanPath, "orphan");
  await writeFile(sharedPath, "shared");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `INSERT INTO chat_channels (company_id, channel_id, title, summary, created_at, updated_at)
VALUES ($1, 'channel-close', 'Close me', NULL, $2, $2)`,
      [DEFAULT_COMPANY_ID, timestamp],
    );
    for (const [conversationId, kind, topicState] of [
      ["topic-close", "topic", { chatChannelId: "channel-close", topicId: "topic-close" }],
      ["dm-survive", "direct", {}],
    ] as const) {
      await pool.query(
        `INSERT INTO conversations (
  company_id, conversation_id, title, conversation_kind, participants_json,
  topic_state_json, participant_states_json, runtime_links_json, created_at, updated_at
) VALUES ($1, $2, $2, $3, '[]'::jsonb, $4::jsonb, '[]'::jsonb, '[]'::jsonb, $5, $5)`,
        [DEFAULT_COMPANY_ID, conversationId, kind, JSON.stringify(topicState), timestamp],
      );
    }
    for (const [conversationId, messageId, attachmentIds] of [
      ["topic-close", "message-topic", ["att-orphan", "att-shared"]],
      ["dm-survive", "message-dm", ["att-shared"]],
    ] as const) {
      await pool.query(
        `INSERT INTO conversation_messages (
  company_id, conversation_id, message_id, sender_json, body, attachments_json,
  mentions_json, runtime_links_json, delivery_state, created_at, updated_at
) VALUES ($1, $2, $3, '{}'::jsonb, '', $4::jsonb, '[]'::jsonb, '[]'::jsonb, 'sent', $5, $5)`,
        [DEFAULT_COMPANY_ID, conversationId, messageId, JSON.stringify(attachmentIds.map((attachmentId) => ({ attachmentId }))), timestamp],
      );
    }
    for (const [attachmentId, localPath] of [["att-orphan", orphanPath], ["att-shared", sharedPath]] as const) {
      await pool.query(
        `INSERT INTO chat_attachments (
  company_id, attachment_id, owner_member_id, file_name, mime_type, byte_length,
  storage_key, content_sha256, local_path, created_at
) VALUES ($1, $2, 'xuziho', $2, 'image/png', 1, $2, $2, $3, $4)`,
        [DEFAULT_COMPANY_ID, attachmentId, localPath, timestamp],
      );
    }
    for (const [attachmentId, messageId, conversationId] of [
      ["att-orphan", "message-topic", "topic-close"],
      ["att-shared", "message-topic", "topic-close"],
      ["att-shared", "message-dm", "dm-survive"],
    ] as const) {
      await pool.query(
        `INSERT INTO chat_attachment_references (
  company_id, attachment_id, message_id, conversation_id, created_at
) VALUES ($1, $2, $3, $4, $5)`,
        [DEFAULT_COMPANY_ID, attachmentId, messageId, conversationId, timestamp],
      );
    }
    for (const [id, contextKind, contextId, status] of [
      ["approval-topic", "channel_topic", "topic-close", "pending"],
      ["approval-dm", "dm_thread", "dm-survive", "pending"],
    ] as const) {
      await pool.query(
        `INSERT INTO governance_approvals (
  company_id, id, context_kind, context_id, session_key, requested_by_member_id,
  requested_action, status, reason, created_at, updated_at
) VALUES ($1, $2, $3, $4, $4, 'worker', 'read_file', $5, 'Need access', $6, $6)`,
        [DEFAULT_COMPANY_ID, id, contextKind, contextId, status, timestamp],
      );
    }
    for (const [id, approvalId, contextKind, contextId] of [
      ["grant-topic", "approval-topic", "channel_topic", "topic-close"],
      ["grant-dm", "approval-dm", "dm_thread", "dm-survive"],
    ] as const) {
      await pool.query(
        `INSERT INTO approval_grants (
  company_id, id, approval_id, member_id, action, scope, context_kind, context_id, created_at
) VALUES ($1, $2, $3, 'worker', 'read_file', 'session', $4, $5, $6)`,
        [DEFAULT_COMPANY_ID, id, approvalId, contextKind, contextId, timestamp],
      );
    }

    const repository = await PostgresChannelRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
    try {
      await repository.deleteChannel(DEFAULT_COMPANY_ID, "channel-close");
    } finally {
      repository.close();
    }

    const attachments = await pool.query<{ attachment_id: string }>(
      "SELECT attachment_id FROM chat_attachments WHERE company_id = $1 ORDER BY attachment_id",
      [DEFAULT_COMPANY_ID],
    );
    assert.deepEqual(attachments.rows.map((row) => row.attachment_id), ["att-shared"]);
    await assert.rejects(access(orphanPath));
    await access(sharedPath);

    const approvals = await pool.query<{ id: string; status: string; decision_note: string | null }>(
      "SELECT id, status, decision_note FROM governance_approvals WHERE company_id = $1 ORDER BY id",
      [DEFAULT_COMPANY_ID],
    );
    assert.deepEqual(approvals.rows, [
      { id: "approval-dm", status: "pending", decision_note: null },
      { id: "approval-topic", status: "canceled", decision_note: "Source Channel was dissolved." },
    ]);
    const grants = await pool.query<{ id: string }>(
      "SELECT id FROM approval_grants WHERE company_id = $1 ORDER BY id",
      [DEFAULT_COMPANY_ID],
    );
    assert.deepEqual(grants.rows.map((row) => row.id), ["grant-dm"]);
  } finally {
    await pool.end();
  }
});
