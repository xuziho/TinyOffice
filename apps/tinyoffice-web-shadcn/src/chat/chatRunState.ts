import type { ChatRuntimeStatus, TinyOfficeRealtimeEvent } from "tinyoffice/realtime-contracts";
import { chatUserFacingErrorMessage } from "./chatErrorMessages";

export type ChatRunRecord = {
  companyId: string;
  conversationId: string;
  roomId: string;
  runId: string;
  sourceMessageId: string;
  replyMessageId?: string;
  targetMemberId: string;
  status: ChatRuntimeStatus;
  errorMessage?: string;
  streamedContent: string;
  sequence: number;
};

export type ChatRunState = {
  runs: Record<string, ChatRunRecord>;
};

export type StreamingReply = {
  companyId: string;
  conversationId: string;
  roomId: string;
  runId: string;
  sourceMessageId: string;
  targetMemberId: string;
  content: string;
  sequence: number;
};

export type DraftReply = StreamingReply & {
  replyMessageId?: string;
  status: ChatRuntimeStatus;
  errorMessage?: string;
  isTerminal: boolean;
};

const terminalStatuses = new Set<ChatRuntimeStatus>(["completed", "canceled", "failed"]);

export function emptyChatRunState(): ChatRunState {
  return { runs: {} };
}

export function applyChatRunRealtimeEvent(state: ChatRunState, event: TinyOfficeRealtimeEvent): ChatRunState {
  if (event.type === "chat.runtime_status.changed") {
    return upsertRun(state, event.runId, {
      companyId: event.companyId,
      conversationId: event.conversationId,
      roomId: event.roomId,
      runId: event.runId,
      sourceMessageId: event.sourceMessageId,
      replyMessageId: event.replyMessageId,
      targetMemberId: event.targetMemberId,
      status: event.status,
      ...(event.errorMessage ? { errorMessage: chatUserFacingErrorMessage(event.errorMessage) } : {}),
      sequence: event.sequence,
    });
  }

  if (event.type === "chat.reply.delta") {
    const existing = state.runs[event.runId];
    return upsertRun(state, event.runId, {
      companyId: event.companyId,
      conversationId: event.conversationId,
      roomId: event.roomId,
      runId: event.runId,
      sourceMessageId: event.sourceMessageId,
      targetMemberId: event.targetMemberId,
      status: "streaming",
      streamedContent: `${existing?.streamedContent ?? ""}${event.delta}`,
      sequence: event.sequence,
    });
  }

  if (event.type === "chat.reply.snapshot") {
    return upsertRun(state, event.runId, {
      companyId: event.companyId,
      conversationId: event.conversationId,
      roomId: event.roomId,
      runId: event.runId,
      sourceMessageId: event.sourceMessageId,
      targetMemberId: event.targetMemberId,
      status: "streaming",
      streamedContent: event.content,
      sequence: event.sequence,
    });
  }

  if (event.type === "chat.process_trace.appended") {
    const existing = state.runs[event.runId];
    return upsertRun(state, event.runId, {
      companyId: event.companyId,
      conversationId: event.conversationId,
      roomId: event.roomId,
      runId: event.runId,
      sourceMessageId: event.sourceMessageId,
      replyMessageId: event.replyMessageId,
      targetMemberId: event.targetMemberId,
      status: existing?.status ?? "thinking",
      sequence: event.sequence,
    });
  }

  return state;
}

export function activeChatRunForRoom(state: ChatRunState, roomId: string | undefined): ChatRunRecord | undefined {
  if (!roomId) {
    return undefined;
  }
  return Object.values(state.runs)
    .filter((run) => run.roomId === roomId && !terminalStatuses.has(run.status))
    .sort((left, right) => right.sequence - left.sequence)[0];
}

export function streamingReplyForRoom(state: ChatRunState, roomId: string | undefined): StreamingReply | undefined {
  const run = activeChatRunForRoom(state, roomId);
  if (!run?.streamedContent.trim()) {
    return undefined;
  }
  return {
    companyId: run.companyId,
    conversationId: run.conversationId,
    roomId: run.roomId,
    runId: run.runId,
    sourceMessageId: run.sourceMessageId,
    targetMemberId: run.targetMemberId,
    content: run.streamedContent,
    sequence: run.sequence,
  };
}

export function draftReplyForRoom(state: ChatRunState, roomId: string | undefined): DraftReply | undefined {
  if (!roomId) {
    return undefined;
  }
  const run = latestRunForRoom(state, roomId);
  const content = run?.streamedContent.trim() || (run?.status === "failed" ? run.errorMessage : undefined);
  if (!run || !content || run.status === "canceled") {
    return undefined;
  }
  return {
    companyId: run.companyId,
    conversationId: run.conversationId,
    roomId: run.roomId,
    runId: run.runId,
    sourceMessageId: run.sourceMessageId,
    targetMemberId: run.targetMemberId,
    ...(run.replyMessageId ? { replyMessageId: run.replyMessageId } : {}),
    content,
    ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
    sequence: run.sequence,
    status: run.status,
    isTerminal: terminalStatuses.has(run.status),
  };
}

function latestRunForRoom(state: ChatRunState, roomId: string): ChatRunRecord | undefined {
  return Object.values(state.runs)
    .filter((run) => run.roomId === roomId)
    .sort((left, right) => right.sequence - left.sequence)[0];
}

function upsertRun(
  state: ChatRunState,
  runId: string,
  patch: Omit<Partial<ChatRunRecord>, "runId"> & Pick<ChatRunRecord, "runId">,
): ChatRunState {
  const existing = state.runs[runId];
  return {
    runs: {
      ...state.runs,
      [runId]: {
        companyId: requiredRunValue(patch.companyId ?? existing?.companyId, "companyId"),
        conversationId: requiredRunValue(patch.conversationId ?? existing?.conversationId, "conversationId"),
        roomId: requiredRunValue(patch.roomId ?? existing?.roomId, "roomId"),
        runId,
        sourceMessageId: requiredRunValue(patch.sourceMessageId ?? existing?.sourceMessageId, "sourceMessageId"),
        ...(patch.replyMessageId ?? existing?.replyMessageId
          ? { replyMessageId: patch.replyMessageId ?? existing?.replyMessageId }
          : {}),
        targetMemberId: requiredRunValue(patch.targetMemberId ?? existing?.targetMemberId, "targetMemberId"),
        status: patch.status ?? existing?.status ?? "queued",
        ...(patch.errorMessage ?? existing?.errorMessage
          ? { errorMessage: patch.errorMessage ?? existing?.errorMessage }
          : {}),
        streamedContent: patch.streamedContent ?? existing?.streamedContent ?? "",
        sequence: patch.sequence ?? existing?.sequence ?? 0,
      },
    },
  };
}

function requiredRunValue(value: string | undefined, label: string): string {
  if (!value?.trim()) {
    throw new Error(`${label} is required for Chat run state`);
  }
  return value;
}
