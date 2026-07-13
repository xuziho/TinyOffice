import type { Hono } from "hono";
import { isChatParticipantAllowed } from "../../collaboration/chat/chat-permissions.js";

import type { TinyOfficeApiOptions } from "./context.js";
import {
  jsonResponse,
  requireParam,
  chatParticipantIdentity,
  chatAccessIdentity,
  resolveAttachmentService,
  resolveChatRoomMessageService,
  viewerIdentityFromRequest,
} from "./context.js";

export function registerAttachmentRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  app.post("/api/companies/:companyId/chat/attachments", async (c) => {
    const companyId = requireParam(c, "companyId");
    const form = await c.req.formData();
    assertKnownFormFields(form, ["file"], "Chat attachment upload");
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("file is required");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const owner = chatParticipantIdentity(viewerIdentityFromRequest(options, c, companyId));
    if (!owner.memberId) {
      throw new Error("ownerMemberId is required for Chat attachments");
    }
    const service = await resolveAttachmentService(options, companyId);
    const attachment = await service.uploadChatImageAttachment(companyId, {
      ownerMemberId: owner.memberId,
      fileName: file.name,
      mimeType: file.type,
      bytes,
    });
    return jsonResponse(c, { attachment }, 201);
  });

  app.get("/api/companies/:companyId/chat/attachments/:attachmentId/content", async (c) => {
    const companyId = requireParam(c, "companyId");
    const attachmentId = requireParam(c, "attachmentId");
    const viewer = viewerIdentityFromRequest(options, c, companyId);
    const service = await resolveAttachmentService(options, companyId);
    const attachment = await service.getChatAttachment(companyId, attachmentId);
    if (!attachment) {
      return c.text("Attachment not found", 404);
    }
    const referenceConversationIds = await service.listChatAttachmentReferenceConversationIds(companyId, attachmentId);
    const mayReadUnreferencedUpload = referenceConversationIds.length === 0 && attachment.ownerMemberId === viewer.memberId;
    let mayReadReferencedAttachment = false;
    if (referenceConversationIds.length > 0) {
      const messageService = await resolveChatRoomMessageService(options, companyId);
      for (const roomId of referenceConversationIds) {
        const conversation = await messageService.getConversation(companyId, roomId);
        if (conversation && isChatParticipantAllowed(conversation, chatAccessIdentity(viewer))) {
          mayReadReferencedAttachment = true;
          break;
        }
      }
    }
    if (!mayReadUnreferencedUpload && !mayReadReferencedAttachment) {
      return c.text("Attachment not found", 404);
    }
    const bytes = await service.readChatAttachment(attachment);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(attachment.byteLength),
        "content-disposition": c.req.query("download") === "1"
          ? `attachment; filename="${attachment.fileName.replaceAll("\"", "")}"`
          : "inline",
      },
    });
  });

  app.delete("/api/companies/:companyId/chat/attachments/:attachmentId", async (c) => {
    const companyId = requireParam(c, "companyId");
    const attachmentId = requireParam(c, "attachmentId");
    const owner = chatParticipantIdentity(viewerIdentityFromRequest(options, c, companyId));
    if (!owner.memberId) {
      throw new Error("ownerMemberId is required for Chat attachments");
    }
    const service = await resolveAttachmentService(options, companyId);
    if (!service.discardChatAttachment) {
      throw new Error("Chat attachment discard service is unavailable");
    }
    await service.discardChatAttachment(companyId, {
      attachmentId,
      ownerMemberId: owner.memberId,
    });
    return jsonResponse(c, { companyId, attachmentId, discarded: true });
  });
}

function assertKnownFormFields(form: FormData, allowedFields: string[], label: string): void {
  const allowed = new Set(allowedFields);
  for (const field of form.keys()) {
    if (!allowed.has(field)) {
      throw new Error(`unknown ${label} field: ${field}`);
    }
  }
}
