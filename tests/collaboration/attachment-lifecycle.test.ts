import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Pool } from "pg";

import { LocalChatAttachmentStore } from "../../src/collaboration/attachments/local-attachment-store.js";
import { PostgresChatAttachmentRepository } from "../../src/collaboration/attachments/postgres-attachment-repository.js";
import {
  ATTACHMENT_DTO_SCHEMA,
  CONVERSATION_MESSAGE_CONTRACT_VERSION,
  MESSAGE_DTO_SCHEMA,
  type MessageDto,
} from "../../src/collaboration/contracts/conversation-message-contract.js";
import { PostgresMessageRepository } from "../../src/collaboration/message/postgres-message-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { openConfiguredPostgresConnection } from "../../src/runtime/company-config/postgres-runtime-connection.js";

const oldTimestamp = "2026-07-10T00:00:00.000Z";
const recentTimestamp = "2026-07-13T00:00:00.000Z";

test("Chat attachment references make discard and stale cleanup safe", async () => {
  const databaseUrl = process.env.TINYOFFICE_DATABASE_URL;
  assert.ok(databaseUrl);
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-attachment-lifecycle-"));
  const pool = new Pool({ connectionString: databaseUrl });
  const attachmentConnection = await openConfiguredPostgresConnection(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  assert.ok(attachmentConnection);
  const attachmentRepository = new PostgresChatAttachmentRepository(attachmentConnection.client);
  const store = new LocalChatAttachmentStore(repoRoot);
  try {
    await pool.query(
      `INSERT INTO conversations (
  company_id, conversation_id, title, conversation_kind, participants_json,
  topic_state_json, participant_states_json, runtime_links_json, created_at, updated_at
) VALUES ($1, 'conversation-attachment', 'Attachment lifecycle', 'direct', '[]'::jsonb,
  '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, $2, $2)`,
      [DEFAULT_COMPANY_ID, recentTimestamp],
    );

    const referenced = await saveImage({ store, repository: attachmentRepository, companyId: DEFAULT_COMPANY_ID, now: oldTimestamp, name: "referenced.png" });
    const abandoned = await saveImage({ store, repository: attachmentRepository, companyId: DEFAULT_COMPANY_ID, now: oldTimestamp, name: "abandoned.png" });
    const staleAbandoned = await saveImage({ store, repository: attachmentRepository, companyId: DEFAULT_COMPANY_ID, now: oldTimestamp, name: "stale-abandoned.png" });
    const recent = await saveImage({ store, repository: attachmentRepository, companyId: DEFAULT_COMPANY_ID, now: recentTimestamp, name: "recent.png" });

    const messageRepository = await PostgresMessageRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
    try {
      const message: MessageDto = {
        schema: MESSAGE_DTO_SCHEMA,
        version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
        companyId: DEFAULT_COMPANY_ID,
        conversationId: "conversation-attachment",
        messageId: "message-attachment",
        sender: {
          participantId: "member:xuziho",
          participantKind: "company_member",
          memberId: "xuziho",
          displayName: "Xuziho",
        },
        body: "Attached",
        mentions: [],
        attachments: [{
          schema: ATTACHMENT_DTO_SCHEMA,
          version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
          companyId: DEFAULT_COMPANY_ID,
          conversationId: "conversation-attachment",
          messageId: "message-attachment",
          attachmentId: referenced.attachmentId,
          fileName: referenced.fileName,
          mimeType: referenced.mimeType,
          byteLength: referenced.byteLength,
          storageKey: referenced.storageKey,
          contentSha256: referenced.contentSha256,
          createdAt: recentTimestamp,
        }],
        runtimeLinks: [],
        createdAt: recentTimestamp,
        updatedAt: recentTimestamp,
        deliveryState: "sent",
      };
      await messageRepository.runInTransaction(() => messageRepository.upsertMessage({ message }));
    } finally {
      messageRepository.close();
    }

    const references = await pool.query<{ attachment_id: string; message_id: string }>(
      "SELECT attachment_id, message_id FROM chat_attachment_references WHERE company_id = $1",
      [DEFAULT_COMPANY_ID],
    );
    assert.deepEqual(references.rows, [{ attachment_id: referenced.attachmentId, message_id: "message-attachment" }]);
    assert.deepEqual(
      await attachmentRepository.listReferenceConversationIds(DEFAULT_COMPANY_ID, referenced.attachmentId),
      ["conversation-attachment"],
    );
    assert.deepEqual(
      await attachmentRepository.listReferenceConversationIds(DEFAULT_COMPANY_ID, abandoned.attachmentId),
      [],
    );
    assert.equal(await attachmentRepository.deleteUnreferencedAttachment({
      companyId: DEFAULT_COMPANY_ID,
      attachmentId: referenced.attachmentId,
      ownerMemberId: "xuziho",
    }), undefined);
    assert.equal(await attachmentRepository.deleteUnreferencedAttachment({
      companyId: DEFAULT_COMPANY_ID,
      attachmentId: abandoned.attachmentId,
      ownerMemberId: "other-member",
    }), undefined);

    const deletedAbandoned = await attachmentRepository.deleteUnreferencedAttachment({
      companyId: DEFAULT_COMPANY_ID,
      attachmentId: abandoned.attachmentId,
      ownerMemberId: "xuziho",
    });
    assert.ok(deletedAbandoned);
    await store.delete(deletedAbandoned);
    await assert.rejects(access(abandoned.localPath));

    const stale = await attachmentRepository.deleteStaleUnreferencedAttachments({
      companyId: DEFAULT_COMPANY_ID,
      olderThan: "2026-07-12T00:00:00.000Z",
    });
    assert.deepEqual(stale.map((record) => record.attachmentId), [staleAbandoned.attachmentId]);
    for (const record of stale) {
      await store.delete(record);
    }
    await assert.rejects(access(staleAbandoned.localPath));
    await access(referenced.localPath);
    await access(recent.localPath);
  } finally {
    attachmentConnection.client.release();
    await attachmentConnection.pool.end?.();
    await pool.end();
  }
});

async function saveImage(input: {
  store: LocalChatAttachmentStore;
  repository: PostgresChatAttachmentRepository;
  companyId: string;
  now: string;
  name: string;
}) {
  const record = await input.store.writeImage({
    companyId: input.companyId,
    ownerMemberId: "xuziho",
    fileName: input.name,
    mimeType: "image/png",
    bytes: new Uint8Array([1, 2, 3]),
    now: input.now,
  });
  return input.repository.saveAttachment(record);
}
