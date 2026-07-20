import type { QueryClient } from "@tanstack/react-query";
import {
  addChatChannelMembers,
  archiveChatRoomTopic,
  cancelChatRun,
  createChatChannel,
  createChatEntry,
  dissolveChatChannel,
  removeChatChannelMember,
  restoreChatRoomTopic,
  sendChatRoomMessage,
  updateChatChannelDetails,
  updateChatRoomTitle,
} from "@/api/chatClient";
import type {
  AccessRequestDecision,
  AccessRequestDto,
  ChatChannelMemberDto,
  CompanyDirectoryMemberEntryDto,
  MessagePage,
  TinyOfficeCurrentSession,
} from "tinyoffice/frontend-api-contracts";
import { accessDecisionContinuationMessage, accessRequestForegroundRoomId } from "./chatAccessRequests";
import { memberDisplayNamesForCreateEntry } from "./chatCreateEntryDisplayNames";
import { mentionedMemberIdsForChatSubmit } from "./chatMentionRouting";
import { chatQueryKeys } from "./chatQueryKeys";
import type { ChatRunRecord } from "./chatRunState";
import type { ChatShellModel } from "./chatShellModel";
import { activeEntryContainerId } from "./chatUiUtils";
import { activitySourceForMessage } from "./messageActivitySource";
import type { ComposerSubmitValue } from "./mentionComposerModel";

export type ActivitySourceSummary = {
  senderName: string;
  createdAt: string;
};

export function activitySourceSummaryForSelection(
  messages: MessagePage["messages"],
  sourceMessageId: string | undefined,
): ActivitySourceSummary | undefined {
  if (!sourceMessageId) {
    return undefined;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const source = activitySourceForMessage(message);
    if (source?.sourceMessageId === sourceMessageId) {
      return {
        senderName: message.sender.displayName,
        createdAt: message.createdAt,
      };
    }
  }
  return undefined;
}

export function viewerFromSession(session: TinyOfficeCurrentSession | undefined): { memberId?: string } {
  return session?.member ? { memberId: session.member.memberId } : {};
}

export async function createEntryFromSelectedContainer(
  value: ComposerSubmitValue,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<Awaited<ReturnType<typeof createChatEntry>>> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const containerId = requiredTinyOfficeValue(activeEntryContainerId(model), "containerId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  const mentionedMemberIds = mentionedMemberIdsForChatSubmit(value, model.mentionCandidates);
  const memberDisplayNames = memberDisplayNamesForCreateEntry(model);
  return createChatEntry({
    companyId,
    containerId,
    actorMemberId,
    actorDisplayName: session?.member?.displayName ?? session?.user.displayName,
    ...(memberDisplayNames ? { memberDisplayNames } : {}),
    firstMessage: {
      body: value.body,
      ...(value.attachmentIds?.length ? { attachmentIds: value.attachmentIds } : {}),
      ...(mentionedMemberIds.length ? { mentionedMemberIds } : {}),
    },
  });
}

export async function sendReplyToSelectedRoom(
  value: ComposerSubmitValue,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<Awaited<ReturnType<typeof sendChatRoomMessage>>> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const roomId = requiredTinyOfficeValue(model.selectedRoomId, "roomId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  const mentionedMemberIds = mentionedMemberIdsForChatSubmit(value, model.mentionCandidates);
  return sendChatRoomMessage({
    companyId,
    roomId,
    actorMemberId,
    actorDisplayName: session?.member?.displayName ?? session?.user.displayName,
    body: value.body,
    mentionedMemberIds,
    attachmentIds: value.attachmentIds,
  });
}

export async function postAccessDecisionContinuation(input: {
  request: AccessRequestDto;
  decision: AccessRequestDecision;
  note?: string;
  model: ChatShellModel;
  session: TinyOfficeCurrentSession | undefined;
}): Promise<void> {
  const companyId = requiredTinyOfficeValue(input.model.companyId, "companyId");
  const roomId = requiredTinyOfficeValue(
    accessRequestForegroundRoomId(input.request),
    "roomId",
  );
  const actorMemberId = requiredTinyOfficeValue(input.session?.member?.memberId, "actorMemberId");
  const targetMemberId = input.request.requestedByMemberId.trim();
  await sendChatRoomMessage({
    companyId,
    roomId,
    actorMemberId,
    actorDisplayName: input.session?.member?.displayName ?? input.session?.user.displayName,
    body: accessDecisionContinuationMessage({
      request: input.request,
      decision: input.decision,
      note: input.note,
    }),
    mentionedMemberIds: targetMemberId && targetMemberId !== actorMemberId ? [targetMemberId] : [],
  });
}

export async function updateSelectedRoomTitle(
  title: string,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const roomId = requiredTinyOfficeValue(model.selectedRoomId, "roomId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return updateChatRoomTitle({
    companyId,
    roomId,
    actorMemberId,
    title,
  });
}

export async function archiveEntryFromModel(
  entryId: string,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<Awaited<ReturnType<typeof archiveChatRoomTopic>>> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const entry = model.rooms.find((candidate) => candidate.entryId === entryId);
  const roomId = requiredTinyOfficeValue(entry?.openTarget.roomId, "roomId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return archiveChatRoomTopic({
    companyId,
    roomId,
    actorMemberId,
    confirmation: "ARCHIVE",
  });
}

export async function restoreEntryFromModel(
  entryId: string,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<Awaited<ReturnType<typeof restoreChatRoomTopic>>> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const entry = model.archivedDirectoryEntries?.find((candidate) => candidate.entryId === entryId);
  const roomId = requiredTinyOfficeValue(entry?.openTarget.roomId, "roomId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return restoreChatRoomTopic({ companyId, roomId, actorMemberId, confirmation: "RESTORE" });
}

export async function updateSelectedChannelDetails(
  input: { title: string; summary?: string },
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const chatChannelId = requiredTinyOfficeValue(model.selectedContainer?.chatChannelId, "chatChannelId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return updateChatChannelDetails({
    companyId,
    chatChannelId,
    actorMemberId,
    title: input.title,
    summary: input.summary,
  });
}

export async function createChannelFromDirectory(
  input: { title: string; summary?: string; members: CompanyDirectoryMemberEntryDto[] },
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<Awaited<ReturnType<typeof createChatChannel>>> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return createChatChannel({
    companyId,
    actorMemberId,
    actorDisplayName: session?.member?.displayName ?? session?.user.displayName,
    title: input.title,
    summary: input.summary,
    members: input.members.map((member) => ({
      memberId: requiredTinyOfficeValue(member.memberId, "memberId"),
      displayName: member.displayName,
      hasRuntimeProfile: member.hasRuntimeProfile,
    })),
  });
}

export async function addMembersToSelectedChannel(
  members: CompanyDirectoryMemberEntryDto[],
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const chatChannelId = requiredTinyOfficeValue(model.selectedContainer?.chatChannelId, "chatChannelId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return addChatChannelMembers({
    companyId,
    chatChannelId,
    actorMemberId,
    members: members.map((member) => ({
      memberId: requiredTinyOfficeValue(member.memberId, "memberId"),
      displayName: member.displayName,
      hasRuntimeProfile: member.hasRuntimeProfile,
    })),
  });
}

export async function removeMemberFromSelectedChannel(
  member: ChatChannelMemberDto,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const chatChannelId = requiredTinyOfficeValue(model.selectedContainer?.chatChannelId, "chatChannelId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return removeChatChannelMember({
    companyId,
    chatChannelId,
    actorMemberId,
    member: { memberId: requiredTinyOfficeValue(member.memberId, "memberId") },
  });
}

export async function dissolveSelectedChannel(
  confirmation: "DELETE",
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const chatChannelId = requiredTinyOfficeValue(model.selectedContainer?.chatChannelId, "chatChannelId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return dissolveChatChannel({
    companyId,
    chatChannelId,
    actorMemberId,
    confirmation,
  });
}

export async function cancelSelectedRun(
  run: ChatRunRecord,
  model: ChatShellModel,
  session: TinyOfficeCurrentSession | undefined,
): Promise<unknown> {
  const companyId = requiredTinyOfficeValue(model.companyId, "companyId");
  const actorMemberId = requiredTinyOfficeValue(session?.member?.memberId, "actorMemberId");
  return cancelChatRun({
    companyId,
    runId: run.runId,
    actorMemberId,
    reason: "User stopped the reply.",
  });
}

export async function invalidateChatWorkspace(
  queryClient: QueryClient,
  companyId: string | undefined,
  roomId: string | undefined,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: chatQueryKeys.currentSession() }),
    companyId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.projectionScope(companyId) }) : Promise.resolve(),
    companyId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.directory(companyId) }) : Promise.resolve(),
    companyId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.employeeRuntimeSummary(companyId) }) : Promise.resolve(),
    companyId && roomId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.roomMessagesScope(companyId, roomId) }) : Promise.resolve(),
    companyId && roomId ? queryClient.invalidateQueries({ queryKey: chatQueryKeys.roomActivityScope(companyId, roomId) }) : Promise.resolve(),
  ]);
}

export function statusFromQueries(queries: Array<{ isError: boolean; isPending: boolean; fetchStatus: string }>): "loading" | "ready" | "error" {
  if (queries.some((query) => query.isError)) {
    return "error";
  }
  if (queries.some((query) => query.isPending && query.fetchStatus !== "idle")) {
    return "loading";
  }
  return "ready";
}

export function errorFromQueries(queries: Array<{ error: Error | null }>): string | undefined {
  return queries.map((query) => query.error?.message).find(Boolean);
}

export function mutationError(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

export function requiredTinyOfficeValue(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}
