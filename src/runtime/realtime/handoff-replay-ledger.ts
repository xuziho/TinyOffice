import { createHash } from "node:crypto";

import type { HandoffResult } from "../pi/read-collaboration-tool-call-log.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "../company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../company-config/company-paths.js";

export type HandoffResolution = "emitted" | "suppressed";

interface HandoffReplayLedgerEntry {
  key: string;
  resolution: HandoffResolution;
  resolvedAt: string;
  senderMemberId: string;
  threadId?: string;
  channelTopicId?: string;
  roomId?: string;
  conversationId?: string;
  chatEntryId?: string;
  actionId?: string;
  callTimestamp: string;
  recipientParticipantId: string;
}

function nowIso() {
  return new Date().toISOString();
}

export function buildHandoffReplayKey(input: {
  senderMemberId: string;
  handoff: HandoffResult;
}) {
  const handoff = input.handoff;
  const ownedIdentity = handoff.actionId
    ? { actionId: handoff.actionId }
    : handoff.roomId || handoff.conversationId || handoff.chatEntryId
      ? {
          timestamp: handoff.timestamp,
          channelTopicId: handoff.channelTopicId,
          roomId: handoff.roomId,
          conversationId: handoff.conversationId,
          chatEntryId: handoff.chatEntryId,
          recipientParticipantId: handoff.recipientParticipantId,
          targetMemberId: handoff.targetMemberId,
          message: handoff.message,
        }
      : {
          timestamp: handoff.timestamp,
          channelTopicId: handoff.channelTopicId,
          threadId: handoff.threadId,
          recipientParticipantId: handoff.recipientParticipantId,
          targetMemberId: handoff.targetMemberId,
          message: handoff.message,
        };
  return createHash("sha256")
    .update(
      JSON.stringify({
        senderMemberId: input.senderMemberId,
        ...ownedIdentity,
      }),
    )
    .digest("hex");
}

export class HandoffReplayLedger {
  private readonly entries = new Map<string, HandoffReplayLedgerEntry>();

  constructor(
    private readonly repoRoot: string,
    private readonly companyId: string,
  ) {}

  static async load(repoRoot: string, companyId: string) {
    const ledger = new HandoffReplayLedger(repoRoot, normalizeCompanyId(companyId));
    await ledger.loadFromDatabase();
    return ledger;
  }

  close(): void {
  }

  has(key: string) {
    return this.entries.has(key);
  }

  async mark(input: {
    key: string;
    resolution: HandoffResolution;
    senderMemberId: string;
    handoff: HandoffResult;
  }) {
    if (this.entries.has(input.key)) {
      return;
    }

    this.entries.set(input.key, {
      key: input.key,
      resolution: input.resolution,
      resolvedAt: nowIso(),
      senderMemberId: input.senderMemberId,
      ...(input.handoff.threadId ? { threadId: input.handoff.threadId } : {}),
      ...(input.handoff.channelTopicId ? { channelTopicId: input.handoff.channelTopicId } : {}),
      ...(input.handoff.roomId ? { roomId: input.handoff.roomId } : {}),
      ...(input.handoff.conversationId ? { conversationId: input.handoff.conversationId } : {}),
      ...(input.handoff.chatEntryId ? { chatEntryId: input.handoff.chatEntryId } : {}),
      ...(input.handoff.actionId ? { actionId: input.handoff.actionId } : {}),
      callTimestamp: input.handoff.timestamp,
      recipientParticipantId: input.handoff.recipientParticipantId,
    });
    await this.saveEntry(this.entries.get(input.key) as HandoffReplayLedgerEntry);
  }

  private async loadFromDatabase() {
    const postgres = await openConfiguredPostgresConnection(this.repoRoot);
    if (!postgres) {
      throw new Error("Handoff replay ledger requires PostgreSQL runtime configuration.");
    }
    try {
      const rows = await postgres.client.query<HandoffReplayLedgerEntry>(`
SELECT
  key,
  resolution,
  resolved_at AS "resolvedAt",
  sender_member_id AS "senderMemberId",
  thread_id AS "threadId",
  channel_topic_id AS "channelTopicId",
  room_id AS "roomId",
  conversation_id AS "conversationId",
  chat_entry_id AS "chatEntryId",
  action_id AS "actionId",
  call_timestamp AS "callTimestamp",
  recipient_participant_id AS "recipientParticipantId"
FROM handoff_replay_ledger
WHERE company_id = $1
ORDER BY resolved_at ASC
`, [this.companyId]);
      for (const entry of rows.rows) {
        this.entries.set(entry.key, entry);
      }
    } finally {
      postgres.client.release();
      await endCompanyPostgresPool(postgres.pool);
    }
  }

  private async saveEntry(entry: HandoffReplayLedgerEntry) {
    const postgres = await openConfiguredPostgresConnection(this.repoRoot);
    if (!postgres) {
      throw new Error("Handoff replay ledger requires PostgreSQL runtime configuration.");
    }
    try {
      await postgres.client.query(
        `INSERT INTO handoff_replay_ledger (
  company_id, key, resolution, resolved_at, sender_member_id, thread_id, channel_topic_id,
  room_id, conversation_id, chat_entry_id, action_id, call_timestamp, recipient_participant_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (company_id, key) DO NOTHING`,
        [
          this.companyId,
          entry.key,
          entry.resolution,
          entry.resolvedAt,
          entry.senderMemberId,
          entry.threadId || null,
          entry.channelTopicId || null,
          entry.roomId || null,
          entry.conversationId || null,
          entry.chatEntryId || null,
          entry.actionId || null,
          entry.callTimestamp,
          entry.recipientParticipantId,
        ],
      );
    } finally {
      postgres.client.release();
      await endCompanyPostgresPool(postgres.pool);
    }
  }
}
