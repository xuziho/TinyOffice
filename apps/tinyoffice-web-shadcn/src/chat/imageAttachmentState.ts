export type PendingImageAttachment = {
  localId: string;
  file: File;
  fileName: string;
  mimeType: string;
  previewObjectUrl: string;
  status: "queued" | "uploading" | "uploaded" | "failed";
  attachmentId?: string;
  error?: string;
};

export function canAcceptImageFile(file: File): boolean {
  return file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp";
}

export function pendingImageFromFile(file: File): PendingImageAttachment {
  return {
    localId: crypto.randomUUID(),
    file,
    fileName: file.name,
    mimeType: file.type,
    previewObjectUrl: URL.createObjectURL(file),
    status: "queued",
  };
}
