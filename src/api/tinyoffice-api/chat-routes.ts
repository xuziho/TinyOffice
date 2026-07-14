import type { Hono } from "hono";

import type { MessageDto, MessagePage } from "../../collaboration/contracts/conversation-message-contract.js";
import { buildRuntimeActivity } from "../../runtime/activity/runtime-activity-projection.js";
import { addUsage, usageFromEvent, usageMagnitude, usageTotals } from "../../runtime/pi/session-explorer-projection-utils.js";
import { RuntimeSessionRepository, type RuntimeSessionEvent, type RuntimeSessionRecord, type RuntimeSessionRepositoryLike } from "../../runtime/storage/runtime-session-repository.js";
import type { ChatRunControlApiService, TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerChatRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { actorIdentityFromCreateEntry, actorIdentityFromRequest, assertChatEntryResponse, assertChatProjectionResponse, authorizedConversation, chatParticipantIdentity, cursorFromContext, dispatchChatEntryCreated, dispatchChatRoomMessageCreated, ensureChatEntryCompanyScope, filterProjectionForViewer, jsonResponse, parseAddChannelMembersBody, parseArchiveTopicBody, parseChannelCreateBody, parseCreateEntryBody, parseDissolveChannelBody, parseReadBody, parseRemoveChannelMemberBody, parseRestoreTopicBody, parseSendBody, parseUpdateChannelDetailsBody, parseUpdateTitleBody, participantMemberIds, publishChatEntryCreated, publishChatMessageCreated, publishChatProjectionChanged, publishChatReadStateUpdated, readJsonBody, requireParam, resolveChannelService, resolveChatCreateEntryService, resolveChatProjectionService, resolveChatRoomMessageService, resolveProcessTraceService, viewerIdentityFromRequest } = api;

  app.get("/api/companies/:companyId/chat/channels", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const channelService = await resolveChannelService(options, companyId);
    return jsonResponse(c, {
      channels: await channelService.listChannelsForViewer(
        companyId,
        chatParticipantIdentity(viewerIdentityFromRequest(options, c, companyId)),
      ),
    });
  });

  app.post("/api/companies/:companyId/chat/channels", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const channelService = await resolveChannelService(options, companyId);
    const parsed = parseChannelCreateBody(options, c, await readJsonBody(c), companyId);
    const channel = await channelService.createChannel(parsed);
    if (options.realtimePublisher) {
      publishChatProjectionChanged(options.realtimePublisher, companyId, parsed.actor);
    }
    return jsonResponse(c, channel, 201);
  });

  app.post("/api/companies/:companyId/chat/channels/:chatChannelId/members", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const channelId = requireParam(c, "chatChannelId");
    const channelService = await resolveChannelService(options, companyId);
    const parsed = parseAddChannelMembersBody(options, c, await readJsonBody(c), companyId, channelId);
    const channel = await channelService.addMembers(parsed);
    if (options.realtimePublisher) {
      publishChatProjectionChanged(options.realtimePublisher, companyId, parsed.actor);
      for (const member of parsed.members) {
        publishChatProjectionChanged(options.realtimePublisher, companyId, {
          participantKind: "company_member",
          memberId: member.memberId,
        });
      }
    }
    return jsonResponse(c, channel);
  });

  app.patch("/api/companies/:companyId/chat/channels/:chatChannelId", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const channelId = requireParam(c, "chatChannelId");
    const channelService = await resolveChannelService(options, companyId);
    const parsed = parseUpdateChannelDetailsBody(options, c, await readJsonBody(c), companyId, channelId);
    const channel = await channelService.updateDetails(parsed);
    if (options.realtimePublisher) {
      for (const member of channel.members) {
        publishChatProjectionChanged(options.realtimePublisher, companyId, {
          participantKind: "company_member",
          memberId: member.memberId,
        });
      }
    }
    return jsonResponse(c, channel);
  });

  app.delete("/api/companies/:companyId/chat/channels/:chatChannelId", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const channelId = requireParam(c, "chatChannelId");
    const channelService = await resolveChannelService(options, companyId);
    const parsed = parseDissolveChannelBody(options, c, await readJsonBody(c), companyId, channelId);
    const result = await channelService.dissolveChannel(parsed);
    if (options.realtimePublisher) {
      publishChatProjectionChanged(options.realtimePublisher, companyId, parsed.actor);
    }
    return jsonResponse(c, result);
  });

  app.delete("/api/companies/:companyId/chat/channels/:chatChannelId/members", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const channelId = requireParam(c, "chatChannelId");
    const channelService = await resolveChannelService(options, companyId);
    const parsed = parseRemoveChannelMemberBody(options, c, await readJsonBody(c), companyId, channelId);
    const channel = await channelService.removeMember(parsed);
    if (options.realtimePublisher) {
      publishChatProjectionChanged(options.realtimePublisher, companyId, parsed.actor);
      publishChatProjectionChanged(options.realtimePublisher, companyId, parsed.member);
    }
    return jsonResponse(c, channel);
  });

  app.get("/api/companies/:companyId/chat", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const chatProjectionService = await resolveChatProjectionService(options, companyId);
    const viewer = viewerIdentityFromRequest(options, c, companyId);
    return jsonResponse(
      c,
      await filterProjectionForViewer({
        options,
        companyId,
        page: assertChatProjectionResponse(await chatProjectionService.listChatProjection(companyId, viewer, cursorFromContext(c))),
        viewer,
      }),
    );
  });

  app.post("/api/companies/:companyId/chat/entries", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const chatCreateEntryService = await resolveChatCreateEntryService(options, companyId);
    const parsed = parseCreateEntryBody(options, c, await readJsonBody(c), companyId);
    const created = assertChatEntryResponse(await chatCreateEntryService.createEntry(parsed));
    publishChatEntryCreated(options.realtimePublisher, created, actorIdentityFromCreateEntry(parsed));
    dispatchChatEntryCreated(options.chatDispatchSink, created, parsed);
    return jsonResponse(c, created, 201);
  });

  app.post("/api/companies/:companyId/chat/runs/:runId/cancel", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const body = await readJsonBody(c);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("cancel Chat run body is required");
    }
    const record = body as Record<string, unknown>;
    const service = await resolveChatRunControlService(options, companyId);
    return jsonResponse(c, await service.cancelChatRun(companyId, {
      runId: requireParam(c, "runId"),
      actor: chatParticipantIdentity(actorIdentityFromRequest(options, c, record, companyId)),
      reason: typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : undefined,
    }));
  });

  app.get("/api/companies/:companyId/chat/rooms/:roomId/active-run", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const service = await resolveChatRunControlService(options, companyId);
    if (!service.getActiveChatRun) {
      throw new Error("active Chat run lookup is not configured");
    }
    return jsonResponse(c, await service.getActiveChatRun(companyId, {
      roomId: requireParam(c, "roomId"),
      actor: chatParticipantIdentity(viewerIdentityFromRequest(options, c, companyId)),
    }));
  });

  app.post("/api/companies/:companyId/chat/runs/:runId/retry", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const body = await readJsonBody(c);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("retry Chat run body is required");
    const record = body as Record<string, unknown>;
    if (!options.chatDispatchSink?.retryChatRun) throw new Error("Chat retry is not configured");
    const requiredBodyString = (key: string): string => {
      const value = record[key];
      if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
      return value.trim();
    };
    return jsonResponse(c, await options.chatDispatchSink.retryChatRun(companyId, {
      roomId: requiredBodyString("roomId"),
      sourceMessageId: requiredBodyString("sourceMessageId"),
      targetMemberId: requiredBodyString("targetMemberId"),
      actor: chatParticipantIdentity(actorIdentityFromRequest(options, c, record, companyId)),
    }));
  });

  app.get("/api/companies/:companyId/chat/rooms/:roomId/process-trace", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const messageService = await resolveChatRoomMessageService(options, companyId);
    const processTraceService = await resolveProcessTraceService(options, companyId);
    const roomId = requireParam(c, "roomId");
    await authorizedConversation({
      messageService,
      companyId,
      roomId,
      identity: viewerIdentityFromRequest(options, c, companyId),
      label: "viewer",
      notFoundLabel: "chat room",
    });
    const requestUrl = new URL(c.req.url, "http://127.0.0.1");
    const sourceMessageId = requestUrl.searchParams.get("sourceMessageId")?.trim() || undefined;
    const processTraceId = requestUrl.searchParams.get("processTraceId")?.trim() || undefined;
    const sessionKey = requestUrl.searchParams.get("sessionKey")?.trim() || undefined;
    const limitValue = Number(requestUrl.searchParams.get("limit") ?? 200);
    return jsonResponse(c, {
      events: await processTraceService.listProcessTraceEvents(companyId, {
        conversationId: roomId,
        ...(sourceMessageId ? { sourceMessageId } : {}),
        ...(processTraceId ? { processTraceId } : {}),
        ...(sessionKey ? { sessionKey } : {}),
        limit: Number.isFinite(limitValue) && limitValue > 0 ? Math.min(Math.floor(limitValue), 500) : 200,
      }),
    });
  });

  app.get("/api/companies/:companyId/chat/rooms/:roomId/activity", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const messageService = await resolveChatRoomMessageService(options, companyId);
    const processTraceService = await resolveProcessTraceService(options, companyId);
    const roomId = requireParam(c, "roomId");
    await authorizedConversation({
      messageService,
      companyId,
      roomId,
      identity: viewerIdentityFromRequest(options, c, companyId),
      label: "viewer",
      notFoundLabel: "chat room",
    });
    const requestUrl = new URL(c.req.url, "http://127.0.0.1");
    const sourceMessageId = requestUrl.searchParams.get("sourceMessageId")?.trim() || undefined;
    const processTraceId = requestUrl.searchParams.get("processTraceId")?.trim() || undefined;
    const sessionKey = requestUrl.searchParams.get("sessionKey")?.trim() || undefined;
    const limitValue = Number(requestUrl.searchParams.get("limit") ?? 200);
    const events = await processTraceService.listProcessTraceEvents(companyId, {
      conversationId: roomId,
      ...(sourceMessageId ? { sourceMessageId } : {}),
      ...(processTraceId ? { processTraceId } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      limit: Number.isFinite(limitValue) && limitValue > 0 ? Math.min(Math.floor(limitValue), 500) : 200,
    });
    return jsonResponse(c, buildRuntimeActivity(events));
  });

  app.get("/api/companies/:companyId/chat/rooms/:roomId/messages", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const messageService = await resolveChatRoomMessageService(options, companyId);
    const roomId = requireParam(c, "roomId");
    await authorizedConversation({
      messageService,
      companyId,
      roomId,
      identity: viewerIdentityFromRequest(options, c, companyId),
      label: "viewer",
      notFoundLabel: "chat room",
    });
    return jsonResponse(c, await withRuntimeUsage({
      options,
      companyId,
      page: await messageService.listMessages(companyId, roomId, cursorFromContext(c)),
    }));
  });

  app.get("/api/companies/:companyId/chat/rooms/:roomId", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const roomId = requireParam(c, "roomId");
    const messageService = await resolveChatRoomMessageService(options, companyId);
    return jsonResponse(c, await authorizedConversation({
      messageService,
      companyId,
      roomId,
      identity: viewerIdentityFromRequest(options, c, companyId),
      label: "viewer",
      notFoundLabel: "chat room",
    }));
  });

  app.post("/api/companies/:companyId/chat/rooms/:roomId/messages", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const messageService = await resolveChatRoomMessageService(options, companyId);
    const body = parseSendBody(options, c, await readJsonBody(c), companyId, "send Chat room message body");
    const roomId = requireParam(c, "roomId");
    await authorizedConversation({
      messageService,
      companyId,
      roomId,
      identity: body.actor,
      label: "actor",
      notFoundLabel: "chat room",
    });
    await options.chatDispatchSink?.assertCanDispatch?.(companyId, {
      roomId,
      actor: chatParticipantIdentity(body.actor),
    });
    const sent = await messageService.sendMessage(companyId, roomId, body.actor, body.body, body.options);
    publishChatMessageCreated(options.realtimePublisher, sent);
    dispatchChatRoomMessageCreated(options.chatDispatchSink, sent, {
      ...body,
      actor: chatParticipantIdentity(body.actor),
    });
    return jsonResponse(c, sent, 201);
  });

  app.post("/api/companies/:companyId/chat/rooms/:roomId/read", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const messageService = await resolveChatRoomMessageService(options, companyId);
    const body = parseReadBody(options, c, await readJsonBody(c), companyId, "mark Chat room read body");
    const roomId = requireParam(c, "roomId");
    await authorizedConversation({
      messageService,
      companyId,
      roomId,
      identity: body.viewer,
      label: "viewer",
      notFoundLabel: "chat room",
    });
    const read = await messageService.markConversationRead(companyId, roomId, body.viewer, body.lastReadMessageId);
    publishChatReadStateUpdated(options.realtimePublisher, read, chatParticipantIdentity(body.viewer));
    return jsonResponse(c, read);
  });

  app.patch("/api/companies/:companyId/chat/rooms/:roomId/title", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const messageService = await resolveChatRoomMessageService(options, companyId);
    const body = parseUpdateTitleBody(options, c, await readJsonBody(c), companyId);
    const roomId = requireParam(c, "roomId");
    await authorizedConversation({
      messageService,
      companyId,
      roomId,
      identity: body.actor,
      label: "actor",
      notFoundLabel: "chat room",
    });
    const renamed = await messageService.updateConversationTitle(companyId, roomId, {
      title: body.title,
      titleStatus: "manual",
    });
    if (options.realtimePublisher) {
      for (const memberId of participantMemberIds(renamed)) {
        publishChatProjectionChanged(options.realtimePublisher, companyId, {
          participantKind: "company_member",
          memberId,
        });
      }
    }
    return jsonResponse(c, renamed);
  });

  app.post("/api/companies/:companyId/chat/rooms/:roomId/archive", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const messageService = await resolveChatRoomMessageService(options, companyId);
    const body = parseArchiveTopicBody(options, c, await readJsonBody(c), companyId);
    const roomId = requireParam(c, "roomId");
    await authorizedConversation({
      messageService,
      companyId,
      roomId,
      identity: body.actor,
      label: "actor",
      notFoundLabel: "chat room",
    });
    const archived = await messageService.archiveConversationTopic(companyId, roomId, body.actor);
    if (options.realtimePublisher) {
      for (const memberId of participantMemberIds(archived)) {
        publishChatProjectionChanged(options.realtimePublisher, companyId, {
          participantKind: "company_member",
          memberId,
        });
      }
    }
    return jsonResponse(c, archived);
  });

  app.post("/api/companies/:companyId/chat/rooms/:roomId/restore", async (c) => {
    const companyId = ensureChatEntryCompanyScope({ companyId: requireParam(c, "companyId") });
    const messageService = await resolveChatRoomMessageService(options, companyId);
    const body = parseRestoreTopicBody(options, c, await readJsonBody(c), companyId);
    const roomId = requireParam(c, "roomId");
    await authorizedConversation({
      messageService,
      companyId,
      roomId,
      identity: body.actor,
      label: "actor",
      notFoundLabel: "chat room",
    });
    const restored = await messageService.restoreConversationTopic(companyId, roomId, body.actor);
    if (options.realtimePublisher) {
      for (const memberId of participantMemberIds(restored)) {
        publishChatProjectionChanged(options.realtimePublisher, companyId, {
          participantKind: "company_member",
          memberId,
        });
      }
    }
    return jsonResponse(c, restored);
  });
}

async function withRuntimeUsage(input: {
  options: TinyOfficeApiOptions;
  companyId: string;
  page: MessagePage;
}): Promise<MessagePage> {
  const sessionTargets = [...new Set(input.page.messages.flatMap(sessionTargetsForMessage))];
  if (sessionTargets.length === 0 || (!input.options.repoRoot && !input.options.runtimeSessionRepository)) {
    return input.page;
  }
  const { repository, shouldClose } = await resolveRuntimeSessionRepository(input.options, input.companyId);
  try {
    const recordsByTarget = new Map<string, RuntimeSessionRecord>();
    for (const target of sessionTargets) {
      const record = repository.getSessionRecord(target) ||
        repository.listSessionRecords({ sessionKey: target, limit: 1 })[0];
      if (record) {
        recordsByTarget.set(target, record);
      }
    }
    if (recordsByTarget.size === 0) {
      return input.page;
    }
    return {
      ...input.page,
      messages: input.page.messages.map((message) => {
        const runtimeUsage = runtimeUsageForMessage({ message, repository, recordsByTarget });
        return runtimeUsage
          ? {
              ...message,
              runtimeUsage,
            }
          : message;
      }),
    };
  } finally {
    if (shouldClose) {
      repository.close();
    }
  }
}

async function resolveRuntimeSessionRepository(
  options: TinyOfficeApiOptions,
  companyId: string,
): Promise<{ repository: RuntimeSessionRepositoryLike; shouldClose: boolean }> {
  if (options.runtimeSessionRepository) {
    return {
      repository: typeof options.runtimeSessionRepository === "function"
        ? await options.runtimeSessionRepository(companyId)
        : options.runtimeSessionRepository,
      shouldClose: false,
    };
  }
  if (!options.repoRoot) {
    throw new Error("runtime session repository is not configured");
  }
  return {
    repository: await RuntimeSessionRepository.open(options.repoRoot, { companyId }),
    shouldClose: true,
  };
}

function sessionTargetsForMessage(message: MessageDto): string[] {
  return message.runtimeLinks
    .filter((link) => link.targetKind === "session" && link.targetId.trim())
    .map((link) => link.targetId.trim());
}

function runtimeUsageForMessage(input: {
  message: MessageDto;
  repository: RuntimeSessionRepositoryLike;
  recordsByTarget: Map<string, RuntimeSessionRecord>;
}): MessageDto["runtimeUsage"] | undefined {
  for (const link of input.message.runtimeLinks) {
    if (link.targetKind !== "session" || !link.targetId.trim()) {
      continue;
    }
    const record = input.recordsByTarget.get(link.targetId.trim());
    if (!record) {
      continue;
    }
    const turnUsage = link.sourceMessageId
      ? runtimeUsageForSourceMessage(input.repository.listSessionEvents(record.id), link.sourceMessageId)
      : undefined;
    if (turnUsage && usageMagnitude(turnUsage) > 0) {
      return turnUsage;
    }
    const sessionUsage = usageTotals({
      inputTokens: record.tokenInputTotal,
      outputTokens: record.tokenOutputTotal,
      cacheTokens: record.tokenCacheTotal,
    });
    if (usageMagnitude(sessionUsage) > 0) {
      return sessionUsage;
    }
  }
  return undefined;
}

function runtimeUsageForSourceMessage(
  events: RuntimeSessionEvent[],
  sourceMessageId: string,
): MessageDto["runtimeUsage"] | undefined {
  const turnIds = new Set(
    events
      .filter((event) => event.turnId?.includes(sourceMessageId) || payloadReferencesMessage(event.payload, sourceMessageId))
      .map((event) => event.turnId)
      .filter((turnId): turnId is string => Boolean(turnId)),
  );
  const total = events.reduce((current, event) => {
    const usage = usageFromEvent(event);
    if (!usage) {
      return current;
    }
    if ((event.turnId && turnIds.has(event.turnId)) || (!event.turnId && payloadReferencesMessage(event.payload, sourceMessageId))) {
      return addUsage(current, usage);
    }
    return current;
  }, usageTotals());
  return usageMagnitude(total) > 0 ? total : undefined;
}

function payloadReferencesMessage(payload: RuntimeSessionEvent["payload"], messageId: string): boolean {
  if (!payload) {
    return false;
  }
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if ((key === "messageId" || key === "sourceMessageId") && value === messageId) {
        return true;
      }
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return false;
}

async function resolveChatRunControlService(options: TinyOfficeApiOptions, companyId: string): Promise<ChatRunControlApiService> {
  if (options.chatRunControlService) {
    return typeof options.chatRunControlService === "function"
      ? await options.chatRunControlService(companyId)
      : options.chatRunControlService;
  }
  if (options.chatDispatchSink?.cancelChatRun) {
    const cancelChatRun = options.chatDispatchSink.cancelChatRun.bind(options.chatDispatchSink);
    const getActiveChatRun = options.chatDispatchSink.getActiveChatRun?.bind(options.chatDispatchSink);
    return { cancelChatRun, ...(getActiveChatRun ? { getActiveChatRun } : {}) };
  }
  throw new Error("chat run control service is not configured");
}
