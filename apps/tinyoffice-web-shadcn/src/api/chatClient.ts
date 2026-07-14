import type {
  AddChatChannelMembersRequest,
  ChatAttachmentUploadResponse,
  ChatChannelResponse,
  ChatProjectionPage,
  ChatRoomActivityPage,
  CreateChatChannelRequest,
  CreateChatEntryRequest,
  CreateChatEntryResponse,
  DissolveChatChannelRequest,
  DissolveChatChannelResponse,
  MessagePage,
  RemoveChatChannelMemberRequest,
  TinyOfficeContextParams,
  UpdateChatChannelDetailsRequest,
} from "tinyoffice/frontend-api-contracts";
import { chatChannelPath, chatEntriesPath, chatRoomPath, companyChatPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";
import { viewerQuery } from "./viewerQuery";

export async function getChatProjection(params: TinyOfficeContextParams): Promise<ChatProjectionPage> {
  const companyId = required(params.companyId, "companyId");
  const query = viewerQuery(params);
  return requestJson<ChatProjectionPage>(`${companyChatPath(companyId)}${query ? `?${query}` : ""}`);
}

export async function listChatRoomMessages(input: {
  companyId?: string;
  roomId?: string;
} & TinyOfficeContextParams): Promise<MessagePage> {
  const companyId = required(input.companyId, "companyId");
  const roomId = required(input.roomId, "roomId");
  const query = viewerQuery(input);
  return requestJson<MessagePage>(`${chatRoomPath(companyId, roomId)}/messages${query ? `?${query}` : ""}`);
}

export async function listChatRoomActivity(input: {
  companyId?: string;
  roomId?: string;
  sourceMessageId?: string;
  processTraceId?: string;
  sessionKey?: string;
  limit?: number;
} & TinyOfficeContextParams): Promise<ChatRoomActivityPage> {
  const companyId = required(input.companyId, "companyId");
  const roomId = required(input.roomId, "roomId");
  const query = new URLSearchParams(viewerQuery(input));
  if (input.sourceMessageId?.trim()) {
    query.set("sourceMessageId", input.sourceMessageId.trim());
  }
  if (input.processTraceId?.trim()) {
    query.set("processTraceId", input.processTraceId.trim());
  }
  if (input.sessionKey?.trim()) {
    query.set("sessionKey", input.sessionKey.trim());
  }
  if (input.limit) {
    query.set("limit", String(input.limit));
  }
  const queryString = query.toString();
  return requestJson<ChatRoomActivityPage>(`${chatRoomPath(companyId, roomId)}/activity${queryString ? `?${queryString}` : ""}`);
}

export async function markChatRoomRead(input: {
  companyId?: string;
  roomId?: string;
  lastReadMessageId?: string;
} & TinyOfficeContextParams): Promise<void> {
  const companyId = required(input.companyId, "companyId");
  const roomId = required(input.roomId, "roomId");
  await requestJson<unknown>(`${chatRoomPath(companyId, roomId)}/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...viewerBody(input),
      ...(input.lastReadMessageId ? { lastReadMessageId: input.lastReadMessageId } : {}),
    }),
  });
}

export async function sendChatRoomMessage(input: {
  companyId?: string;
  roomId?: string;
  actorMemberId?: string;
  actorDisplayName?: string;
  body: string;
  mentionedMemberIds?: string[];
  attachmentIds?: string[];
}): Promise<unknown> {
  const companyId = required(input.companyId, "companyId");
  const roomId = required(input.roomId, "roomId");
  const trimmedBody = input.body.trim();
  if (!trimmedBody && !input.attachmentIds?.length) {
    throw new Error("body or attachmentIds is required");
  }
  return requestJson<unknown>(`${chatRoomPath(companyId, roomId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      ...(input.actorDisplayName?.trim() ? { actorDisplayName: input.actorDisplayName.trim() } : {}),
      body: trimmedBody,
      ...(input.mentionedMemberIds?.length ? { mentionedMemberIds: input.mentionedMemberIds } : {}),
      ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
    }),
  });
}

export async function uploadChatImageAttachment(input: {
  companyId?: string;
  file: File;
} & TinyOfficeContextParams): Promise<ChatAttachmentUploadResponse> {
  const companyId = required(input.companyId, "companyId");
  const query = viewerQuery(input);
  const form = new FormData();
  form.append("file", input.file);
  return requestJson<ChatAttachmentUploadResponse>(`${companyChatPath(companyId)}/attachments${query ? `?${query}` : ""}`, {
    method: "POST",
    body: form,
  });
}

export async function discardChatImageAttachment(input: {
  companyId?: string;
  attachmentId?: string;
} & TinyOfficeContextParams): Promise<void> {
  const companyId = required(input.companyId, "companyId");
  const attachmentId = required(input.attachmentId, "attachmentId");
  const query = viewerQuery(input);
  await requestJson<unknown>(`${companyChatPath(companyId)}/attachments/${encodeURIComponent(attachmentId)}${query ? `?${query}` : ""}`, {
    method: "DELETE",
  });
}

export async function updateChatRoomTitle(input: {
  companyId?: string;
  roomId?: string;
  actorMemberId?: string;
  title: string;
}): Promise<ChatRoomTitleUpdateResponse> {
  const companyId = required(input.companyId, "companyId");
  const roomId = required(input.roomId, "roomId");
  const title = required(input.title, "title");
  return requestJson<ChatRoomTitleUpdateResponse>(`${chatRoomPath(companyId, roomId)}/title`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      title,
    }),
  });
}

export async function archiveChatRoomTopic(input: {
  companyId?: string;
  roomId?: string;
  actorMemberId?: string;
  confirmation: "ARCHIVE";
}): Promise<ChatRoomArchiveResponse> {
  const companyId = required(input.companyId, "companyId");
  const roomId = required(input.roomId, "roomId");
  return requestJson<ChatRoomArchiveResponse>(`${chatRoomPath(companyId, roomId)}/archive`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      confirmation: input.confirmation,
    }),
  });
}

export async function restoreChatRoomTopic(input: {
  companyId?: string;
  roomId?: string;
  actorMemberId?: string;
  confirmation: "RESTORE";
}): Promise<ChatRoomArchiveResponse> {
  const companyId = required(input.companyId, "companyId");
  const roomId = required(input.roomId, "roomId");
  return requestJson<ChatRoomArchiveResponse>(`${chatRoomPath(companyId, roomId)}/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      confirmation: input.confirmation,
    }),
  });
}

export async function retryChatRun(input: {
  companyId?: string;
  runId?: string;
  roomId?: string;
  sourceMessageId?: string;
  targetMemberId?: string;
  actorMemberId?: string;
}): Promise<{ status: "retry_queued" }> {
  const companyId = required(input.companyId, "companyId");
  const runId = required(input.runId, "runId");
  return requestJson(`${companyChatPath(companyId)}/runs/${encodeURIComponent(runId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...actorBody(input),
      roomId: required(input.roomId, "roomId"),
      sourceMessageId: required(input.sourceMessageId, "sourceMessageId"),
      targetMemberId: required(input.targetMemberId, "targetMemberId"),
    }),
  });
}

export async function updateChatChannelDetails(input: UpdateChatChannelDetailsRequest): Promise<ChatChannelResponse> {
  const companyId = required(input.companyId, "companyId");
  const chatChannelId = required(input.chatChannelId, "chatChannelId");
  const title = required(input.title, "title");
  return requestJson<ChatChannelResponse>(chatChannelPath(companyId, chatChannelId), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      title,
      ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
    }),
  });
}

export async function createChatChannel(input: CreateChatChannelRequest): Promise<ChatChannelResponse> {
  const companyId = required(input.companyId, "companyId");
  const title = required(input.title, "title");
  return requestJson<ChatChannelResponse>(`${companyChatPath(companyId)}/channels`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      ...(input.actorDisplayName?.trim() ? { actorDisplayName: input.actorDisplayName.trim() } : {}),
      title,
      ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
      members: memberInputs(input.members),
    }),
  });
}

export async function addChatChannelMembers(input: AddChatChannelMembersRequest): Promise<ChatChannelResponse> {
  const companyId = required(input.companyId, "companyId");
  const chatChannelId = required(input.chatChannelId, "chatChannelId");
  return requestJson<ChatChannelResponse>(`${chatChannelPath(companyId, chatChannelId)}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      members: memberInputs(input.members),
    }),
  });
}

export async function removeChatChannelMember(input: RemoveChatChannelMemberRequest): Promise<ChatChannelResponse> {
  const companyId = required(input.companyId, "companyId");
  const chatChannelId = required(input.chatChannelId, "chatChannelId");
  return requestJson<ChatChannelResponse>(`${chatChannelPath(companyId, chatChannelId)}/members`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      member: input.member,
    }),
  });
}

export async function dissolveChatChannel(input: DissolveChatChannelRequest): Promise<DissolveChatChannelResponse> {
  const companyId = required(input.companyId, "companyId");
  const chatChannelId = required(input.chatChannelId, "chatChannelId");
  return requestJson<DissolveChatChannelResponse>(chatChannelPath(companyId, chatChannelId), {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      confirmation: input.confirmation,
    }),
  });
}

export async function cancelChatRun(input: {
  companyId?: string;
  runId?: string;
  actorMemberId?: string;
  reason?: string;
}): Promise<ChatRunCancelResponse> {
  const companyId = required(input.companyId, "companyId");
  const runId = required(input.runId, "runId");
  return requestJson<ChatRunCancelResponse>(`${companyChatPath(companyId)}/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyId,
      ...actorBody(input),
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    }),
  });
}

export type ActiveChatRunResponse = {
  companyId: string;
  roomId: string;
  chainId: string;
  runId: string;
  sourceMessageId: string;
  targetMemberId: string;
  status: "active" | "cancel_requested";
} | null;

export async function getActiveChatRun(input: {
  companyId?: string;
  roomId?: string;
  actorMemberId?: string;
}): Promise<ActiveChatRunResponse> {
  const companyId = required(input.companyId, "companyId");
  const roomId = required(input.roomId, "roomId");
  const query = viewerQuery(input);
  return requestJson<ActiveChatRunResponse>(`${chatRoomPath(companyId, roomId)}/active-run${query ? `?${query}` : ""}`);
}

export type ChatRoomTitleUpdateResponse = {
  companyId: string;
  conversationId: string;
  title: string;
  titleStatus?: "placeholder" | "generated" | "manual" | "failed";
  titleSourceMessageId?: string;
  titleFailureReason?: string;
};

export type ChatRoomArchiveResponse = {
  companyId: string;
  conversationId: string;
  topic?: {
    status?: "open" | "waiting" | "resolved" | "archived";
  };
};

export type ChatRunCancelResponse = {
  companyId: string;
  runId: string;
  status: "cancel_requested" | "canceled" | "not_found";
  canceledCount: number;
};

export async function createChatEntry(input: CreateChatEntryRequest): Promise<CreateChatEntryResponse> {
  const { companyId, ...body } = input;
  const requiredCompanyId = required(companyId, "companyId");
  return requestJson<CreateChatEntryResponse>(chatEntriesPath(requiredCompanyId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ companyId: requiredCompanyId, ...body }),
  });
}

function actorBody(params: { actorMemberId?: string }): { actorMemberId: string } {
  if (params.actorMemberId?.trim()) {
    return { actorMemberId: params.actorMemberId.trim() };
  }
  throw new Error("actor identity is required");
}

function memberInputs(
  members: Array<{ memberId: string; displayName: string; hasRuntimeProfile?: boolean }> | undefined,
): Array<{ memberId: string; displayName: string; hasRuntimeProfile?: boolean }> | undefined {
  return members?.map((member) => ({
    memberId: required(member.memberId, "memberId"),
    displayName: required(member.displayName, "displayName"),
    hasRuntimeProfile: member.hasRuntimeProfile ?? false,
  }));
}

function viewerBody(params: TinyOfficeContextParams): { viewerMemberId: string } {
  if (params.viewer?.kind === "member") {
    return { viewerMemberId: params.viewer.memberId };
  }
  if (params.memberId?.trim()) {
    return { viewerMemberId: params.memberId.trim() };
  }
  throw new Error("viewer identity is required");
}
