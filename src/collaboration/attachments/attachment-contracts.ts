export const CHAT_ATTACHMENT_SCHEMA = "chat-attachment" as const;
export const CHAT_ATTACHMENT_CONTRACT_VERSION = 1 as const;

export type SupportedChatImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ChatAttachmentRecord {
  schema: typeof CHAT_ATTACHMENT_SCHEMA;
  version: typeof CHAT_ATTACHMENT_CONTRACT_VERSION;
  companyId: string;
  attachmentId: string;
  ownerMemberId: string;
  fileName: string;
  mimeType: SupportedChatImageMimeType;
  byteLength: number;
  storageKey: string;
  contentSha256: string;
  createdAt: string;
  localPath: string;
}

export type PublicChatAttachment = Omit<ChatAttachmentRecord, "localPath"> & {
  previewUrl: string;
  downloadUrl: string;
  localPath?: never;
};

export function assertSupportedChatImageMimeType(value: string): SupportedChatImageMimeType {
  if (value === "image/png" || value === "image/jpeg" || value === "image/webp") {
    return value;
  }
  throw new Error(`unsupported Chat image attachment MIME type: ${value}`);
}

export function publicChatAttachment(record: ChatAttachmentRecord): PublicChatAttachment {
  return {
    schema: record.schema,
    version: record.version,
    companyId: record.companyId,
    attachmentId: record.attachmentId,
    ownerMemberId: record.ownerMemberId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    byteLength: record.byteLength,
    storageKey: record.storageKey,
    contentSha256: record.contentSha256,
    createdAt: record.createdAt,
    previewUrl: `/api/companies/${encodeURIComponent(record.companyId)}/chat/attachments/${encodeURIComponent(record.attachmentId)}/content`,
    downloadUrl: `/api/companies/${encodeURIComponent(record.companyId)}/chat/attachments/${encodeURIComponent(record.attachmentId)}/content?download=1`,
  };
}
