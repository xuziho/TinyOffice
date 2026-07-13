import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeCompanyId } from "../../runtime/company-config/company-paths.js";
import {
  assertSupportedChatImageMimeType,
  CHAT_ATTACHMENT_CONTRACT_VERSION,
  CHAT_ATTACHMENT_SCHEMA,
  type ChatAttachmentRecord,
} from "./attachment-contracts.js";

export class LocalChatAttachmentStore {
  constructor(private readonly repoRoot: string) {}

  async writeImage(input: {
    companyId: string;
    ownerMemberId: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    now?: string;
  }): Promise<ChatAttachmentRecord> {
    const companyId = normalizeCompanyId(input.companyId);
    const attachmentId = `att-${randomUUID()}`;
    const mimeType = assertSupportedChatImageMimeType(input.mimeType);
    const contentSha256 = createHash("sha256").update(input.bytes).digest("hex");
    const storageKey = `companies/${companyId}/chat-attachments/${attachmentId}/original`;
    const localPath = path.join(this.repoRoot, ".data", "companies", companyId, "chat-attachments", attachmentId, "original");
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, input.bytes);
    return {
      schema: CHAT_ATTACHMENT_SCHEMA,
      version: CHAT_ATTACHMENT_CONTRACT_VERSION,
      companyId,
      attachmentId,
      ownerMemberId: input.ownerMemberId,
      fileName: input.fileName,
      mimeType,
      byteLength: input.bytes.byteLength,
      storageKey,
      contentSha256,
      localPath,
      createdAt: input.now ?? new Date().toISOString(),
    };
  }

  async read(record: ChatAttachmentRecord): Promise<Uint8Array> {
    return readFile(record.localPath);
  }

  async delete(record: ChatAttachmentRecord): Promise<void> {
    const companyRoot = path.resolve(this.repoRoot, ".data", "companies", record.companyId, "chat-attachments");
    const attachmentDirectory = path.resolve(path.dirname(record.localPath));
    const relative = path.relative(companyRoot, attachmentDirectory);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Attachment path is outside the Company attachment root: ${record.localPath}`);
    }
    await rm(attachmentDirectory, { recursive: true, force: true });
  }
}
