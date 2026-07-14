import type { IncomingMessage, ServerResponse } from "node:http";

import { assertNoForbiddenPublicCarrierFields } from "../contracts/conversation-message-contract.js";
import type {
  ConversationDto,
  ConversationRuntimeLinkTargetKind,
  MarkConversationReadResult,
  MessagePage,
  SendMessageResult,
} from "../contracts/conversation-message-contract.js";
import {
  assertChatEntryContractBoundary,
  ensureChatEntryCompanyScope,
} from "../contracts/chat-entry-contract.js";
import {
  assertChatProjectionBoundary,
  normalizeChatViewerIdentity,
  type ChatParticipantIdentitySelector,
  type ChatProjectionPage,
  type ChatViewerIdentity,
} from "../chat/chat-projection-service.js";
import type {
  ChatCreateEntryInput,
  ChatCreateEntryResponse,
} from "../chat/chat-create-entry-service.js";
import type { MessageServiceSendMessageOptions } from "../message/message-service.js";
import type { MessageServiceParticipantSelector } from "../message/message-service.js";
import type { TinyOfficeRealtimePublisher } from "../contracts/tinyoffice-realtime-contract.js";

export interface ChatProjectionApiService {
  listChatProjection(
    companyId: string,
    viewer: ChatViewerIdentity,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<ChatProjectionPage>;
}

export interface ChatCreateEntryApiService {
  createEntry(input: ChatCreateEntryInput): Promise<ChatCreateEntryResponse>;
}

export interface ChatRoomMessageApiService {
  getConversation(companyId: string, conversationId: string): Promise<ConversationDto | undefined>;
  listMessages(
    companyId: string,
    conversationId: string,
    cursor?: { cursor?: string; limit?: number },
  ): Promise<MessagePage>;
  sendMessage(
    companyId: string,
    conversationId: string,
    sender: MessageServiceParticipantSelector,
    body: string,
    options?: MessageServiceSendMessageOptions,
  ): Promise<SendMessageResult>;
  markConversationRead(
    companyId: string,
    conversationId: string,
    viewer: MessageServiceParticipantSelector,
    lastReadMessageId?: string,
  ): Promise<MarkConversationReadResult>;
  updateConversationTitle(
    companyId: string,
    conversationId: string,
    input: { title: string; titleStatus: "manual" },
  ): Promise<ConversationDto>;
  archiveConversationTopic(
    companyId: string,
    conversationId: string,
    actor: MessageServiceParticipantSelector,
  ): Promise<ConversationDto>;
  restoreConversationTopic(
    companyId: string,
    conversationId: string,
    actor: MessageServiceParticipantSelector,
  ): Promise<ConversationDto>;
}

export type ChatDispatchApiEvent =
  | {
      source: "chat_entry";
      companyId: string;
      roomId: string;
      actorMemberId?: string;
      messageId: string;
      body: string;
      mentionedMemberIds?: string[];
      containerId: string;
      entryId: string;
      openTargetKind: ChatCreateEntryResponse["openTarget"]["kind"];
      attemptId?: string;
    }
  | {
      source: "chat_room_message";
      companyId: string;
      roomId: string;
      actorMemberId?: string;
      messageId: string;
      body: string;
      mentionedMemberIds?: string[];
      attemptId?: string;
    };

export interface ChatDispatchApiSink {
  assertCanDispatch?(companyId: string, input: { roomId: string; actor: ChatParticipantIdentitySelector }): Promise<void>;
  getActiveChatRun?(companyId: string, input: { roomId: string; actor: ChatParticipantIdentitySelector }): Promise<{
    companyId: string;
    roomId: string;
    chainId: string;
    runId: string;
    sourceMessageId: string;
    targetMemberId: string;
    status: "active" | "cancel_requested";
  } | null>;
  handleChatDispatchEvent(event: ChatDispatchApiEvent): void | Promise<void>;
  cancelChatRun?(companyId: string, input: {
    runId: string;
    actor: ChatParticipantIdentitySelector;
    reason?: string;
  }): Promise<{
    companyId: string;
    runId: string;
    status: "cancel_requested" | "canceled" | "not_found";
    canceledCount: number;
  }>;
  retryChatRun?(companyId: string, input: {
    roomId: string;
    sourceMessageId: string;
    targetMemberId: string;
    actor: ChatParticipantIdentitySelector;
  }): Promise<{ companyId: string; roomId: string; sourceMessageId: string; status: "retry_queued" }>;
}

export interface ChatProjectionApiRouteOptions {
  chatProjectionService: ChatProjectionApiService | ((companyId: string) => Promise<ChatProjectionApiService>);
  chatCreateEntryService?: ChatCreateEntryApiService | ((companyId: string) => Promise<ChatCreateEntryApiService>);
  chatRoomMessageService?: ChatRoomMessageApiService | ((companyId: string) => Promise<ChatRoomMessageApiService>);
  realtimePublisher?: TinyOfficeRealtimePublisher;
  chatDispatchSink?: ChatDispatchApiSink;
}

interface RouteMatch {
  companyId: string;
  roomId?: string;
  child?: "entries" | "messages" | "read" | "title" | "archive" | "restore";
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberFrom(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function routeMatch(pathname: string): RouteMatch | undefined {
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length === 4 && parts[0] === "api" && parts[1] === "companies" && parts[3] === "chat") {
    return { companyId: parts[2] ?? "" };
  }
  if (parts.length === 5 && parts[0] === "api" && parts[1] === "companies" && parts[3] === "chat" && parts[4] === "entries") {
    return { companyId: parts[2] ?? "", child: "entries" };
  }
  if (parts.length === 6 && parts[0] === "api" && parts[1] === "companies" && parts[3] === "chat" && parts[4] === "rooms") {
    return { companyId: parts[2] ?? "", roomId: parts[5] ?? "" };
  }
  if (
    parts.length === 7 &&
    parts[0] === "api" &&
    parts[1] === "companies" &&
    parts[3] === "chat" &&
    parts[4] === "rooms" &&
    (parts[6] === "messages" || parts[6] === "read" || parts[6] === "title" || parts[6] === "archive" || parts[6] === "restore")
  ) {
    return { companyId: parts[2] ?? "", roomId: parts[5] ?? "", child: parts[6] };
  }
  return undefined;
}

async function resolveChatProjectionService(
  options: ChatProjectionApiRouteOptions,
  companyId: string,
): Promise<ChatProjectionApiService> {
  return typeof options.chatProjectionService === "function"
    ? await options.chatProjectionService(companyId)
    : options.chatProjectionService;
}

async function resolveChatCreateEntryService(
  options: ChatProjectionApiRouteOptions,
  companyId: string,
): Promise<ChatCreateEntryApiService> {
  if (!options.chatCreateEntryService) {
    throw new Error("chat create-entry service is not configured");
  }
  return typeof options.chatCreateEntryService === "function"
    ? await options.chatCreateEntryService(companyId)
    : options.chatCreateEntryService;
}

async function resolveChatRoomMessageService(
  options: ChatProjectionApiRouteOptions,
  companyId: string,
): Promise<ChatRoomMessageApiService> {
  if (!options.chatRoomMessageService) {
    throw new Error("chat room message service is not configured");
  }
  return typeof options.chatRoomMessageService === "function"
    ? await options.chatRoomMessageService(companyId)
    : options.chatRoomMessageService;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid json body");
  }
}

function cursorFromUrl(url: URL): { cursor?: string; limit?: number } {
  return {
    cursor: stringFrom(url.searchParams.get("cursor")),
    limit: numberFrom(url.searchParams.get("limit")),
  };
}

function identityFromQuery(url: URL, fieldName: string): ChatParticipantIdentitySelector {
  const viewerMemberId = stringFrom(url.searchParams.get(`${fieldName}MemberId`));
  if (viewerMemberId) {
    return { participantKind: "company_member", memberId: viewerMemberId };
  }
  throw new Error(`${fieldName} identity is required`);
}

function actorIdentityFromBody(body: Record<string, unknown>): ChatParticipantIdentitySelector {
  const actorMemberId = stringFrom(body.actorMemberId);
  if (actorMemberId) {
    return { participantKind: "company_member", memberId: actorMemberId };
  }
  return { participantKind: "company_member", memberId: requireString(body, "actorMemberId") };
}

function viewerIdentityFromBody(body: Record<string, unknown>): ChatParticipantIdentitySelector {
  const viewerMemberId = stringFrom(body.viewerMemberId);
  if (viewerMemberId) {
    return { participantKind: "company_member", memberId: viewerMemberId };
  }
  return { participantKind: "company_member", memberId: requireString(body, "viewerMemberId") };
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  assertNoForbiddenPublicCarrierFields(value);
  if (value && typeof value === "object" && "containers" in value) {
    assertChatProjectionBoundary(value as ChatProjectionPage);
  }
  if (value && typeof value === "object" && "entry" in value) {
    const createEntryResponse = value as ChatCreateEntryResponse;
    assertChatEntryContractBoundary(createEntryResponse.container);
    assertChatEntryContractBoundary(createEntryResponse.entry);
  }
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function writeError(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : undefined;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    writeJson(res, statusCode, { error: message });
    return;
  }
  if (/explicit companyId is required| is required|must be|invalid .*body|forbidden carrier field|runtime evidence identity|unsupported Chat containerId/.test(message)) {
    writeJson(res, 400, { error: message });
    return;
  }
  if (/companyId mismatch/.test(message)) {
    writeJson(res, 403, { error: message });
    return;
  }
  if (/not found/.test(message)) {
    writeJson(res, 404, { error: message });
    return;
  }
  writeJson(res, 500, { error: message });
}

export async function handleChatProjectionApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ChatProjectionApiRouteOptions,
): Promise<boolean> {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const match = routeMatch(requestUrl.pathname);
  if (!match) {
    return false;
  }

  try {
    const companyId = ensureChatEntryCompanyScope({ companyId: match.companyId });

    if (req.method === "POST" && match.child === "entries" && !match.roomId) {
      const body = await readJsonBody(req);
      assertNoForbiddenPublicCarrierFields(body);
      const chatCreateEntryService = await resolveChatCreateEntryService(options, companyId);
      const parsed = parseCreateEntryBody(body, companyId);
      const created = await chatCreateEntryService.createEntry(parsed);
      publishChatEntryCreated(options.realtimePublisher, created, actorIdentityFromCreateEntry(parsed));
      dispatchChatEntryCreated(options.chatDispatchSink, created, parsed);
      writeJson(res, 201, created);
      return true;
    }

    if (match.roomId) {
      const roomId = requireStringValue(match.roomId, "roomId");
      const messageService = await resolveChatRoomMessageService(options, companyId);
      if (req.method === "GET" && !match.child) {
        const conversation = await messageService.getConversation(companyId, roomId);
        if (!conversation) {
          throw new Error(`chat room not found: ${roomId}`);
        }
        writeJson(res, 200, conversation);
        return true;
      }
      if (req.method === "GET" && match.child === "messages") {
        writeJson(res, 200, await messageService.listMessages(companyId, roomId, cursorFromUrl(requestUrl)));
        return true;
      }
      if (req.method === "POST" && match.child === "messages") {
        const body = parseSendMessageBody(await readJsonBody(req), companyId);
        await options.chatDispatchSink?.assertCanDispatch?.(companyId, {
          roomId,
          actor: normalizeChatViewerIdentity(body.actor, "actor"),
        });
        const sent = await messageService.sendMessage(companyId, roomId, body.actor, body.body, {
          ...body.options,
        });
        publishChatMessageCreated(options.realtimePublisher, sent);
        dispatchChatRoomMessageCreated(options.chatDispatchSink, sent, body);
        writeJson(
          res,
          201,
          sent,
        );
        return true;
      }
      if (req.method === "POST" && match.child === "read") {
        const body = parseReadBody(await readJsonBody(req), companyId);
        const read = await messageService.markConversationRead(companyId, roomId, body.viewer, body.lastReadMessageId);
        publishChatReadStateUpdated(options.realtimePublisher, read, body.viewer);
        writeJson(
          res,
          200,
          read,
        );
        return true;
      }
      if (req.method === "PATCH" && match.child === "title") {
        const body = parseUpdateTitleBody(await readJsonBody(req), companyId);
        const conversation = await messageService.updateConversationTitle(companyId, roomId, {
          title: body.title,
          titleStatus: "manual",
        });
        publishChatConversationTitleUpdated(options.realtimePublisher, conversation);
        writeJson(
          res,
          200,
          conversation,
        );
        return true;
      }
      if (req.method === "POST" && match.child === "archive") {
        const body = parseArchiveTopicBody(await readJsonBody(req), companyId);
        const conversation = await messageService.archiveConversationTopic(companyId, roomId, body.actor);
        publishChatConversationTitleUpdated(options.realtimePublisher, conversation);
        writeJson(
          res,
          200,
          conversation,
        );
        return true;
      }
      if (req.method === "POST" && match.child === "restore") {
        const body = parseRestoreTopicBody(await readJsonBody(req), companyId);
        const conversation = await messageService.restoreConversationTopic(companyId, roomId, body.actor);
        publishChatConversationTitleUpdated(options.realtimePublisher, conversation);
        writeJson(
          res,
          200,
          conversation,
        );
        return true;
      }
      return false;
    }

    if (req.method !== "GET" || match.child) {
      return false;
    }
    const viewer = identityFromQuery(requestUrl, "viewer");
    const chatProjectionService = await resolveChatProjectionService(options, companyId);
    writeJson(
      res,
      200,
      await chatProjectionService.listChatProjection(companyId, viewer, cursorFromUrl(requestUrl)),
    );
    return true;
  } catch (error) {
    if (!res.headersSent) {
      writeError(res, error);
    }
    return true;
  }
}

function dispatchChatEntryCreated(
  sink: ChatDispatchApiSink | undefined,
  created: ChatCreateEntryResponse,
  input: ChatCreateEntryInput,
): void {
  if (!sink) {
    return;
  }
  dispatchWithoutBlocking(sink, {
    source: "chat_entry",
    companyId: created.companyId,
    roomId: created.openTarget.roomId,
    ...(input.actorMemberId ? { actorMemberId: input.actorMemberId } : {}),
    messageId: created.firstMessageId,
    body: input.firstMessage.body,
    mentionedMemberIds: input.firstMessage.mentionedMemberIds,
    containerId: created.entry.parentContainerId,
    entryId: created.entry.entryId,
    openTargetKind: created.openTarget.kind,
  });
}

function dispatchChatRoomMessageCreated(
  sink: ChatDispatchApiSink | undefined,
  sent: SendMessageResult,
  input: {
    actor: ChatParticipantIdentitySelector;
    body: string;
    options: MessageServiceSendMessageOptions;
  },
): void {
  if (!sink) {
    return;
  }
  dispatchWithoutBlocking(sink, {
    source: "chat_room_message",
    companyId: sent.message.companyId,
    roomId: sent.message.conversationId,
    ...(input.actor.memberId ? { actorMemberId: input.actor.memberId } : {}),
    messageId: sent.message.messageId,
    body: input.body,
    mentionedMemberIds: input.options.mentionedMemberIds,
  });
}

function dispatchWithoutBlocking(sink: ChatDispatchApiSink, event: ChatDispatchApiEvent): void {
  try {
    void Promise.resolve(sink.handleChatDispatchEvent(event)).catch(() => undefined);
  } catch {
    // The message mutation is already durable; dispatch failure must not roll it back.
  }
}

function publishChatEntryCreated(
  publisher: TinyOfficeRealtimePublisher | undefined,
  created: ChatCreateEntryResponse,
  actor: ChatParticipantIdentitySelector,
): void {
  if (!publisher) {
    return;
  }
  publisher.publish({
    type: "chat.entry.created",
    companyId: created.companyId,
    containerId: created.entry.parentContainerId,
    entryId: created.entry.entryId,
    roomId: created.openTarget.roomId,
  });
  publisher.publish({
    type: "chat.message.created",
    companyId: created.companyId,
    conversationId: created.openTarget.roomId,
    roomId: created.openTarget.roomId,
    messageId: created.firstMessageId,
  });
  publishChatProjectionChanged(publisher, created.companyId, actor);
}

function publishChatMessageCreated(
  publisher: TinyOfficeRealtimePublisher | undefined,
  sent: SendMessageResult,
): void {
  if (!publisher) {
    return;
  }
  publisher.publish({
    type: "chat.message.created",
    companyId: sent.message.companyId,
    conversationId: sent.message.conversationId,
    roomId: sent.message.conversationId,
    messageId: sent.message.messageId,
  });
  for (const memberId of participantMemberIds(sent.conversation)) {
    publishChatProjectionChanged(publisher, sent.message.companyId, { participantKind: "company_member", memberId });
  }
}

function publishChatReadStateUpdated(
  publisher: TinyOfficeRealtimePublisher | undefined,
  read: MarkConversationReadResult,
  viewer: ChatParticipantIdentitySelector,
): void {
  if (!publisher) {
    return;
  }
  if (!viewer.memberId) {
    return;
  }
  publisher.publish({
    type: "chat.read_state.updated",
    companyId: read.conversation.companyId,
    roomId: read.conversation.conversationId,
    memberId: viewer.memberId,
  });
  publishChatProjectionChanged(publisher, read.conversation.companyId, viewer);
}

function publishChatConversationTitleUpdated(
  publisher: TinyOfficeRealtimePublisher | undefined,
  conversation: ConversationDto,
): void {
  if (!publisher) {
    return;
  }
  for (const memberId of participantMemberIds(conversation)) {
    publishChatProjectionChanged(publisher, conversation.companyId, { participantKind: "company_member", memberId });
  }
}

function participantMemberIds(conversation: ConversationDto): string[] {
  return [...new Set(
    conversation.participants
      .map((participant) => participant.memberId?.trim())
      .filter((memberId): memberId is string => Boolean(memberId)),
  )];
}

function publishChatProjectionChanged(
  publisher: TinyOfficeRealtimePublisher,
  companyId: string,
  viewer: ChatParticipantIdentitySelector,
): void {
  if (viewer.memberId) {
    publisher.publish({
      type: "chat.projection.changed",
      companyId,
      viewerMemberId: viewer.memberId,
    });
    return;
  }
}

function actorIdentityFromCreateEntry(input: ChatCreateEntryInput): ChatParticipantIdentitySelector {
  return normalizeChatViewerIdentity(
    { participantKind: "company_member", memberId: input.actorMemberId },
    "actor",
  );
}

function requireString(input: Record<string, unknown>, fieldName: string): string {
  const value = stringFrom(input[fieldName]);
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function requireStringValue(value: string | undefined, fieldName: string): string {
  const trimmed = stringFrom(value);
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function optionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`${fieldName} must contain strings`);
    }
    return item.trim();
  });
}

function optionalObjectArray(value: unknown, fieldName: string): Record<string, unknown>[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${fieldName} must contain objects`);
    }
    return item as Record<string, unknown>;
  });
}

function optionalDisplayNames(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("memberDisplayNames must be an object");
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([memberId, displayName]) => {
      if (typeof displayName !== "string" || !displayName.trim()) {
        throw new Error("memberDisplayNames must contain strings");
      }
      return [memberId, displayName.trim()];
    }),
  );
}

function parseSendMessageBody(value: unknown, companyId: string): {
  actor: ChatParticipantIdentitySelector;
  body: string;
  options: MessageServiceSendMessageOptions;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("send Chat room message body is required");
  }
  const body = value as Record<string, unknown>;
  assertNoForbiddenPublicCarrierFields(body);
  ensureChatEntryCompanyScope({
    companyId,
    resourceCompanyId: requireString(body, "companyId"),
  });
  const attachments = optionalObjectArray(body.attachments, "attachments");
  const runtimeLinks = optionalObjectArray(body.runtimeLinks, "runtimeLinks");
  if (typeof body.body !== "string") {
    throw new Error("body is required");
  }
  return {
    actor: actorIdentityFromBody(body),
    body: body.body.trim(),
    options: {
      attachmentIds: optionalStringArray(body.attachmentIds, "attachmentIds"),
      attachments: attachments?.map((attachment) => ({
        attachmentId: requireString(attachment, "attachmentId"),
        fileName: stringFrom(attachment.fileName),
        mimeType: stringFrom(attachment.mimeType),
        byteLength: typeof attachment.byteLength === "number" ? attachment.byteLength : undefined,
        downloadUrl: stringFrom(attachment.downloadUrl),
        previewUrl: stringFrom(attachment.previewUrl),
        storageKey: stringFrom(attachment.storageKey),
        contentSha256: stringFrom(attachment.contentSha256),
        metadata: attachment.metadata && typeof attachment.metadata === "object" && !Array.isArray(attachment.metadata)
          ? attachment.metadata as Record<string, unknown>
          : undefined,
      })),
      mentionedMemberIds: optionalStringArray(body.mentionedMemberIds, "mentionedMemberIds"),
      runtimeLinks: runtimeLinks?.map((link) => ({
        linkId: stringFrom(link.linkId),
        targetKind: requireString(link, "targetKind") as ConversationRuntimeLinkTargetKind,
        targetId: requireString(link, "targetId"),
        label: stringFrom(link.label),
        sourceMessageId: stringFrom(link.sourceMessageId),
        createdAt: stringFrom(link.createdAt),
      })),
    },
  };
}

function parseReadBody(value: unknown, companyId: string): {
  viewer: ChatParticipantIdentitySelector;
  lastReadMessageId?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("mark Chat room read body is required");
  }
  const body = value as Record<string, unknown>;
  assertNoForbiddenPublicCarrierFields(body);
  ensureChatEntryCompanyScope({
    companyId,
    resourceCompanyId: requireString(body, "companyId"),
  });
  return {
    viewer: viewerIdentityFromBody(body),
    lastReadMessageId: stringFrom(body.lastReadMessageId),
  };
}

function parseUpdateTitleBody(value: unknown, companyId: string): {
  actor: ChatParticipantIdentitySelector;
  title: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("update Chat room title body is required");
  }
  const body = value as Record<string, unknown>;
  assertNoForbiddenPublicCarrierFields(body);
  ensureChatEntryCompanyScope({
    companyId,
    resourceCompanyId: requireString(body, "companyId"),
  });
  return {
    actor: actorIdentityFromBody(body),
    title: requireString(body, "title"),
  };
}

function parseArchiveTopicBody(value: unknown, companyId: string): {
  actor: ChatParticipantIdentitySelector;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("archive Chat room body is required");
  }
  const body = value as Record<string, unknown>;
  assertNoForbiddenPublicCarrierFields(body);
  ensureChatEntryCompanyScope({
    companyId,
    resourceCompanyId: requireString(body, "companyId"),
  });
  const confirmation = requireString(body, "confirmation");
  if (confirmation !== "ARCHIVE") {
    throw new Error("Chat room archive confirmation must be ARCHIVE");
  }
  return {
    actor: actorIdentityFromBody(body),
  };
}

function parseRestoreTopicBody(value: unknown, companyId: string): {
  actor: ChatParticipantIdentitySelector;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("restore Chat room body is required");
  }
  const body = value as Record<string, unknown>;
  assertNoForbiddenPublicCarrierFields(body);
  ensureChatEntryCompanyScope({
    companyId,
    resourceCompanyId: requireString(body, "companyId"),
  });
  const confirmation = requireString(body, "confirmation");
  if (confirmation !== "RESTORE") {
    throw new Error("Chat room restore confirmation must be RESTORE");
  }
  return {
    actor: actorIdentityFromBody(body),
  };
}

function parseCreateEntryBody(value: unknown, companyId: string): ChatCreateEntryInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("create Chat entry body is required");
  }
  const body = value as Record<string, unknown>;
  assertKnownFields(body, ["companyId", "containerId", "actorMemberId", "actorDisplayName", "title", "memberDisplayNames", "firstMessage"], "create Chat entry body");
  ensureChatEntryCompanyScope({
    companyId,
    resourceCompanyId: requireString(body, "companyId"),
  });
  const firstMessage = body.firstMessage;
  if (!firstMessage || typeof firstMessage !== "object" || Array.isArray(firstMessage)) {
    throw new Error("firstMessage is required");
  }
  const firstMessageBody = firstMessage as Record<string, unknown>;
  assertKnownFields(firstMessageBody, ["body", "attachmentIds", "mentionedMemberIds", "runtimeLinks"], "firstMessage");
  if (firstMessageBody.attachments !== undefined) {
    throw new Error("attachments metadata is not accepted by Chat message APIs; upload files and send attachmentIds");
  }
  if (firstMessageBody.body !== undefined && typeof firstMessageBody.body !== "string") {
    throw new Error("firstMessage.body must be a string");
  }
  const runtimeLinks = optionalObjectArray(firstMessageBody.runtimeLinks, "firstMessage.runtimeLinks");
  return {
    companyId,
    containerId: requireString(body, "containerId"),
    ...actorIdentityBodyFields(body),
    ...(stringFrom(body.actorDisplayName)
      ? { actorDisplayName: stringFrom(body.actorDisplayName) }
      : {}),
    title: stringFrom(body.title),
    memberDisplayNames: optionalDisplayNames(body.memberDisplayNames),
    firstMessage: {
      body: typeof firstMessageBody.body === "string" ? firstMessageBody.body.trim() : "",
      ...(firstMessageBody.attachmentIds !== undefined
        ? { attachmentIds: optionalStringArray(firstMessageBody.attachmentIds, "firstMessage.attachmentIds") }
        : {}),
      mentionedMemberIds: optionalStringArray(firstMessageBody.mentionedMemberIds, "firstMessage.mentionedMemberIds"),
      runtimeLinks: runtimeLinks?.map((link) => ({
        linkId: stringFrom(link.linkId),
        targetKind: requireString(link, "targetKind") as ConversationRuntimeLinkTargetKind,
        targetId: requireString(link, "targetId"),
        label: stringFrom(link.label),
        sourceMessageId: stringFrom(link.sourceMessageId),
        createdAt: stringFrom(link.createdAt),
      })),
    },
  };
}

function actorIdentityBodyFields(body: Record<string, unknown>): Pick<ChatCreateEntryInput, "actorMemberId"> {
  const actorMemberId = stringFrom(body.actorMemberId);
  if (actorMemberId) {
    return { actorMemberId };
  }
  return { actorMemberId: requireString(body, "actorMemberId") };
}

function assertKnownFields(input: Record<string, unknown>, allowedFields: readonly string[], label: string): void {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) {
      throw new Error(`unknown ${label} field: ${field}`);
    }
  }
}
