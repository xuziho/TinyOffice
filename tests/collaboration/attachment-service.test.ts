import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSupportedChatImageMimeType,
  publicChatAttachment,
} from "../../src/collaboration/attachments/attachment-contracts.js";
import { PostgresChatAttachmentRepository } from "../../src/collaboration/attachments/postgres-attachment-repository.js";
import type { CompanyPostgresClient } from "../../src/runtime/company-config/postgres-runtime-connection.js";

class FakePostgresAttachmentClient implements CompanyPostgresClient {
  readonly attachments = new Map<string, Record<string, unknown>>();

  release(): void {}

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
    if (/INSERT INTO chat_attachments/.test(sql) && params) {
      assert.doesNotMatch(sql, /\bowner_employee_id\b/);
      const row = {
        company_id: params[0],
        attachment_id: params[1],
        owner_member_id: params[2],
        file_name: params[3],
        mime_type: params[4],
        byte_length: params[5],
        storage_key: params[6],
        content_sha256: params[7],
        local_path: params[8],
        created_at: params[9],
      };
      this.attachments.set(`${params[0]}:${params[1]}`, row);
      return { rows: [] as T[] };
    }
    if (/attachment_id = ANY/.test(sql) && params) {
      const ids = Array.isArray(params[1]) ? params[1] : [];
      return {
        rows: ids
          .map((attachmentId) => this.attachments.get(`${params[0]}:${attachmentId}`))
          .filter(Boolean) as T[],
      };
    }
    if (/SELECT \* FROM chat_attachments/.test(sql) && params) {
      return {
        rows: [this.attachments.get(`${params[0]}:${params[1]}`)].filter(Boolean) as T[],
      };
    }
    return { rows: [] as T[] };
  }
}

test("Chat image attachment validation accepts png jpeg and webp", () => {
  assert.equal(assertSupportedChatImageMimeType("image/png"), "image/png");
  assert.equal(assertSupportedChatImageMimeType("image/jpeg"), "image/jpeg");
  assert.equal(assertSupportedChatImageMimeType("image/webp"), "image/webp");
});

test("Chat image attachment validation rejects non-image files and gif for v1", () => {
  assert.throws(() => assertSupportedChatImageMimeType("application/pdf"), /unsupported Chat image attachment MIME type/);
  assert.throws(() => assertSupportedChatImageMimeType("image/gif"), /unsupported Chat image attachment MIME type/);
});

test("public Chat attachment projection never exposes absolute filesystem paths", () => {
  const projected = publicChatAttachment({
    schema: "chat-attachment",
    version: 1,
    companyId: "ziho-co",
    attachmentId: "att-1",
    ownerMemberId: "xuziho",
    fileName: "screenshot.png",
    mimeType: "image/png",
    byteLength: 12,
    storageKey: "companies/ziho-co/chat-attachments/att-1/original",
    contentSha256: "sha",
    createdAt: "2026-07-03T00:00:00.000Z",
    localPath: "D:/private/file.png",
  });

  assert.equal(projected.localPath, undefined);
  assert.equal(projected.previewUrl, "/api/companies/ziho-co/chat/attachments/att-1/content");
  assert.equal(projected.downloadUrl, "/api/companies/ziho-co/chat/attachments/att-1/content?download=1");
});

test("PostgresChatAttachmentRepository saves and loads company-scoped attachments", async () => {
  const repository = new PostgresChatAttachmentRepository(new FakePostgresAttachmentClient());

  const saved = await repository.saveAttachment({
    schema: "chat-attachment",
    version: 1,
    companyId: "ziho-co",
    attachmentId: "att-1",
    ownerMemberId: "xuziho",
    fileName: "screenshot.png",
    mimeType: "image/png",
    byteLength: 4,
    storageKey: "companies/ziho-co/chat-attachments/att-1/original",
    contentSha256: "sha",
    createdAt: "2026-07-03T00:00:00.000Z",
    localPath: "D:/repo/.data/companies/ziho-co/chat-attachments/att-1/original",
  });

  assert.equal(saved.attachmentId, "att-1");
  assert.equal((await repository.getAttachment("ziho-co", "att-1"))?.fileName, "screenshot.png");
  assert.deepEqual((await repository.listAttachments("ziho-co", ["att-1"])).map((attachment) => attachment.attachmentId), ["att-1"]);
  assert.equal(await repository.getAttachment("other-co", "att-1"), undefined);
});
