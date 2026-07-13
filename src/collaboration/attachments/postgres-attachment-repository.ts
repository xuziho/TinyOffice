import type { CompanyPostgresClient } from "../../runtime/company-config/postgres-runtime-connection.js";
import {
  assertSupportedChatImageMimeType,
  CHAT_ATTACHMENT_CONTRACT_VERSION,
  CHAT_ATTACHMENT_SCHEMA,
  type ChatAttachmentRecord,
} from "./attachment-contracts.js";

export class PostgresChatAttachmentRepository {
  constructor(private readonly client: CompanyPostgresClient) {}

  async saveAttachment(record: ChatAttachmentRecord): Promise<ChatAttachmentRecord> {
    await this.client.query(
      `INSERT INTO chat_attachments (
        company_id, attachment_id, owner_member_id, file_name,
        mime_type, byte_length, storage_key, content_sha256, local_path, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (company_id, attachment_id) DO UPDATE SET
        file_name = EXCLUDED.file_name,
        mime_type = EXCLUDED.mime_type,
        byte_length = EXCLUDED.byte_length,
        storage_key = EXCLUDED.storage_key,
        content_sha256 = EXCLUDED.content_sha256,
        local_path = EXCLUDED.local_path`,
      [
        record.companyId,
        record.attachmentId,
        record.ownerMemberId,
        record.fileName,
        record.mimeType,
        record.byteLength,
        record.storageKey,
        record.contentSha256,
        record.localPath,
        record.createdAt,
      ],
    );
    const saved = await this.getAttachment(record.companyId, record.attachmentId);
    if (!saved) {
      throw new Error(`Chat attachment not found after save: ${record.attachmentId}`);
    }
    return saved;
  }

  async getAttachment(companyId: string, attachmentId: string): Promise<ChatAttachmentRecord | undefined> {
    const result = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM chat_attachments WHERE company_id = $1 AND attachment_id = $2",
      [companyId, attachmentId],
    );
    const row = result.rows[0];
    return row ? this.recordFromRow(row) : undefined;
  }

  async listAttachments(companyId: string, attachmentIds: string[]): Promise<ChatAttachmentRecord[]> {
    if (attachmentIds.length === 0) {
      return [];
    }
    const result = await this.client.query<Record<string, unknown>>(
      "SELECT * FROM chat_attachments WHERE company_id = $1 AND attachment_id = ANY($2::text[])",
      [companyId, attachmentIds],
    );
    return result.rows.map((row) => this.recordFromRow(row));
  }

  async listReferenceConversationIds(companyId: string, attachmentId: string): Promise<string[]> {
    const result = await this.client.query<{ conversation_id: string }>(
      `SELECT DISTINCT conversation_id
FROM chat_attachment_references
WHERE company_id = $1 AND attachment_id = $2
ORDER BY conversation_id ASC`,
      [companyId, attachmentId],
    );
    return result.rows.map((row) => row.conversation_id);
  }

  async deleteUnreferencedAttachment(input: {
    companyId: string;
    attachmentId: string;
    ownerMemberId: string;
  }): Promise<ChatAttachmentRecord | undefined> {
    const result = await this.client.query<Record<string, unknown>>(
      `DELETE FROM chat_attachments attachment
WHERE attachment.company_id = $1
  AND attachment.attachment_id = $2
  AND attachment.owner_member_id = $3
  AND NOT EXISTS (
    SELECT 1 FROM chat_attachment_references reference
    WHERE reference.company_id = attachment.company_id
      AND reference.attachment_id = attachment.attachment_id
  )
RETURNING attachment.*`,
      [input.companyId, input.attachmentId, input.ownerMemberId],
    );
    const row = result.rows[0];
    return row ? this.recordFromRow(row) : undefined;
  }

  async deleteStaleUnreferencedAttachments(input: {
    companyId: string;
    olderThan: string;
    limit?: number;
  }): Promise<ChatAttachmentRecord[]> {
    const result = await this.client.query<Record<string, unknown>>(
      `DELETE FROM chat_attachments attachment
WHERE (attachment.company_id, attachment.attachment_id) IN (
  SELECT candidate.company_id, candidate.attachment_id
  FROM chat_attachments candidate
  WHERE candidate.company_id = $1
    AND candidate.created_at < $2
    AND NOT EXISTS (
      SELECT 1 FROM chat_attachment_references reference
      WHERE reference.company_id = candidate.company_id
        AND reference.attachment_id = candidate.attachment_id
    )
  ORDER BY candidate.created_at ASC
  LIMIT $3
)
RETURNING attachment.*`,
      [input.companyId, input.olderThan, input.limit ?? 100],
    );
    return result.rows.map((row) => this.recordFromRow(row));
  }

  private recordFromRow(row: Record<string, unknown>): ChatAttachmentRecord {
    return {
      schema: CHAT_ATTACHMENT_SCHEMA,
      version: CHAT_ATTACHMENT_CONTRACT_VERSION,
      companyId: String(row.company_id),
      attachmentId: String(row.attachment_id),
      ownerMemberId: String(row.owner_member_id),
      fileName: String(row.file_name),
      mimeType: assertSupportedChatImageMimeType(String(row.mime_type)),
      byteLength: Number(row.byte_length),
      storageKey: String(row.storage_key),
      contentSha256: String(row.content_sha256),
      localPath: String(row.local_path),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }
}
