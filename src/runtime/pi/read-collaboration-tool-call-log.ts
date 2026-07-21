import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import {
  RuntimeSessionRepository,
  type CollaborationActionEvent,
} from "../storage/runtime-session-repository.js";

export interface ToolCallLogRecord {
  timestamp: string;
  toolName: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanFrom(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function participantFrom(value: unknown): ParticipantRef | undefined {
  const candidate = recordFrom(value);
  const id = stringFrom(candidate.id);
  if (!id) {
    return undefined;
  }
  return {
    id,
    displayName: stringFrom(candidate.displayName),
    role: stringFrom(candidate.role),
    summary: stringFrom(candidate.summary),
    isDefaultRequester: booleanFrom(candidate.isDefaultRequester),
    isFinalReportTarget: booleanFrom(candidate.isFinalReportTarget),
    isApprovalAuthority: booleanFrom(candidate.isApprovalAuthority),
  };
}

function payloadFromActionEvent(event: CollaborationActionEvent) {
  return recordFrom(event.payload);
}

function resultFromActionEvent(event: CollaborationActionEvent) {
  const actionPayload = payloadFromActionEvent(event);
  const handoffPayload = recordFrom(actionPayload.handoff);
  if (Object.keys(handoffPayload).length > 0) {
    const result = recordFrom(handoffPayload.result);
    return {
      status: stringFrom(result.status) || event.decision || event.status,
      payload: {
        channelTopicId: stringFrom(handoffPayload.channelTopicId) || event.channelTopicId,
        roomId: stringFrom(handoffPayload.roomId),
        conversationId: stringFrom(handoffPayload.conversationId),
        chatEntryId: stringFrom(handoffPayload.chatEntryId),
        actionId: stringFrom(handoffPayload.actionId) || event.id,
        senderEmployeeId: stringFrom(result.senderEmployeeId) || event.employeeId,
        recipientParticipantId:
          stringFrom(handoffPayload.recipientParticipantId) ||
          event.recipientId,
        recipientParticipant: result.recipientParticipant,
        recipientEmployeeId: stringFrom(result.recipientEmployeeId),
        message: stringFrom(handoffPayload.message) || event.message,
        previousOwnerEmployeeId: stringFrom(result.previousOwnerEmployeeId),
        newOwnerEmployeeId: stringFrom(result.newOwnerEmployeeId),
      },
    };
  }

  const stored = recordFrom(actionPayload.result);
  if (Object.keys(stored).length > 0) {
    return stored;
  }

  return {
    status: event.decision || event.status,
    payload: {
      channelTopicId: event.channelTopicId,
      actionId: event.id,
      senderEmployeeId: event.employeeId,
      recipientParticipantId: event.recipientId,
      message: event.message,
    },
  };
}

function paramsFromActionEvent(event: CollaborationActionEvent): Record<string, unknown> {
  const actionPayload = payloadFromActionEvent(event);
  const handoffPayload = recordFrom(actionPayload.handoff);
  const fallback: Record<string, unknown> = {
    channelTopicId: event.channelTopicId,
  };
  if (Object.keys(handoffPayload).length > 0) {
    return {
      ...fallback,
      toId: stringFrom(handoffPayload.recipientParticipantId) || event.recipientId,
      message: stringFrom(handoffPayload.message) || event.message,
    };
  }

  const stored = recordFrom(actionPayload.params);
  if (Object.keys(stored).length > 0) {
    return {
      ...fallback,
      ...stored,
    };
  }

  return {
    ...fallback,
    toId: event.recipientId,
    message: event.message,
  };
}

export function collaborationActionEventToToolCallLogRecord(
  event: CollaborationActionEvent,
): ToolCallLogRecord {
  return {
    timestamp: event.timestamp,
    toolName: event.actionName,
    params: paramsFromActionEvent(event),
    result: resultFromActionEvent(event),
  };
}

export async function listCollaborationToolCallRecords(input: {
  repoRoot: string;
  companyId: string;
  channelTopicId?: string;
  actionName?: string;
  sinceIso?: string;
}): Promise<ToolCallLogRecord[]> {
  const repository = await RuntimeSessionRepository.open(input.repoRoot, {
    companyId: input.companyId,
    domains: ["collaborationActions"],
  });
  try {
    return repository
      .listCollaborationActionEvents({
        channelTopicId: input.channelTopicId,
        actionName: input.actionName,
      })
      .filter((event) => !input.sinceIso || event.timestamp >= input.sinceIso)
      .map(collaborationActionEventToToolCallLogRecord);
  } finally {
    repository.close();
  }
}

export interface HandoffResult {
  timestamp: string;
  channelTopicId?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  chatEntryId?: string;
  actionId?: string;
  recipientParticipantId: string;
  recipientParticipant?: ParticipantRef;
  targetMemberId?: string;
  recipientEmployeeId?: string;
  message: string;
  previousOwnerEmployeeId?: string;
  newOwnerEmployeeId?: string;
}

function sessionKeyPath(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function employeeTranscriptDir(input: {
  repoRoot: string;
  employeeId: string;
  threadId: string;
}) {
  const sessionKey = `${input.employeeId}|channel_thread|${input.threadId}`;
  return path.join(
    input.repoRoot,
    "employees",
    input.employeeId,
    "workspace",
    ".scratch",
    "pi-sessions",
    input.employeeId,
    sessionKeyPath(sessionKey),
  );
}

function transcriptEventToHandoffCall(
  event: unknown,
  threadId: string,
  sinceIso: string,
): HandoffResult | undefined {
  const record = recordFrom(event);
  const message = recordFrom(record.message);
  if (message.role !== "toolResult" || message.toolName !== "handoff") {
    return undefined;
  }

  const timestamp = stringFrom(message.timestamp) || stringFrom(record.timestamp);
  if (!timestamp || timestamp < sinceIso) {
    return undefined;
  }

  const details = recordFrom(message.details);
  if (stringFrom(details.status) !== "allowed") {
    return undefined;
  }

  const payload = recordFrom(details.payload);
  const payloadThreadId = stringFrom(payload.threadId);
  if (payloadThreadId && payloadThreadId !== threadId) {
    return undefined;
  }

  const channelTopicId = stringFrom(payload.channelTopicId);
  const roomId = stringFrom(payload.roomId);
  const conversationId = stringFrom(payload.conversationId);
  const chatEntryId = stringFrom(payload.chatEntryId);
  const actionId = stringFrom(payload.actionId);
  const recipientParticipantId = stringFrom(payload.recipientParticipantId);
  const handoffMessage = stringFrom(payload.message);
  if (
    !recipientParticipantId ||
    !handoffMessage ||
    (!channelTopicId && !roomId && !conversationId && !chatEntryId && !actionId)
  ) {
    return undefined;
  }

  return {
    timestamp,
    ...(channelTopicId ? { channelTopicId } : {}),
    ...(payloadThreadId || threadId ? { threadId: payloadThreadId || threadId } : {}),
    ...(roomId ? { roomId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(chatEntryId ? { chatEntryId } : {}),
    ...(actionId ? { actionId } : {}),
    recipientParticipantId,
    recipientParticipant: participantFrom(payload.recipientParticipant),
    recipientEmployeeId: stringFrom(payload.recipientEmployeeId),
    message: handoffMessage,
    previousOwnerEmployeeId: stringFrom(payload.previousOwnerEmployeeId),
    newOwnerEmployeeId: stringFrom(payload.newOwnerEmployeeId),
  };
}

async function readTranscriptHandoffCalls(input: {
  repoRoot: string;
  employeeId?: string;
  threadId: string;
  sinceIso: string;
}): Promise<HandoffResult[]> {
  if (!input.employeeId) {
    return [];
  }

  const transcriptDir = employeeTranscriptDir({
    repoRoot: input.repoRoot,
    employeeId: input.employeeId,
    threadId: input.threadId,
  });
  const filenames = await readdir(transcriptDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [] as string[];
    }
    throw error;
  });

  const calls: HandoffResult[] = [];
  for (const filename of filenames.filter((entry) => entry.endsWith(".jsonl")).sort()) {
    const filePath = path.join(transcriptDir, filename);
    const text = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    });
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const call = transcriptEventToHandoffCall(
          JSON.parse(line),
          input.threadId,
          input.sinceIso,
        );
        if (call) {
          calls.push(call);
        }
      } catch {
        // Ignore malformed transcript lines; replay can still use database truth.
      }
    }
  }

  return calls;
}

function handoffCallKey(call: HandoffResult) {
  return [
    call.timestamp,
    call.channelTopicId,
    call.actionId || "",
    call.roomId || "",
    call.conversationId || "",
    call.chatEntryId || "",
    call.threadId,
    call.recipientParticipantId,
    call.message,
  ].join("\u0000");
}

export async function readRecentHandoffResults(input: {
  repoRoot: string;
  companyId: string;
  threadId: string;
  sinceIso: string;
  employeeId?: string;
}): Promise<HandoffResult[]> {
  const repository = await RuntimeSessionRepository.open(input.repoRoot, {
    companyId: input.companyId,
    domains: ["collaborationActions"],
  });
  try {
    const databaseCalls = repository
      .listCollaborationActionEvents({
        actionName: "handoff",
      })
      .filter((entry) => entry.timestamp >= input.sinceIso)
      .filter((entry) => entry.emitted && entry.decision === "allowed")
      .flatMap((entry) => {
        const result = resultFromActionEvent(entry);
        const params = paramsFromActionEvent(entry);
        const payload = recordFrom(result.payload);
        const channelTopicId =
          stringFrom(payload.channelTopicId) ||
          stringFrom(params.channelTopicId) ||
          entry.channelTopicId;
        const roomId = stringFrom(payload.roomId) || stringFrom(params.roomId);
        const conversationId = stringFrom(payload.conversationId) || stringFrom(params.conversationId);
        const chatEntryId = stringFrom(payload.chatEntryId) || stringFrom(params.chatEntryId);
        const actionId = stringFrom(payload.actionId) || stringFrom(params.actionId) || entry.id;
        if (!channelTopicId && !roomId && !conversationId && !chatEntryId && !actionId) {
          return [];
        }
        return [{
          timestamp: entry.timestamp,
          ...(channelTopicId ? { channelTopicId } : {}),
          ...(stringFrom(payload.threadId) || stringFrom(params.threadId) || input.threadId
            ? {
                threadId:
                  stringFrom(payload.threadId) ||
                  stringFrom(params.threadId) ||
                  input.threadId,
             }
            : {}),
          ...(roomId ? { roomId } : {}),
          ...(conversationId ? { conversationId } : {}),
          ...(chatEntryId ? { chatEntryId } : {}),
          ...(actionId ? { actionId } : {}),
          recipientParticipantId:
            stringFrom(payload.recipientParticipantId) ||
            stringFrom(params.toId) ||
            entry.recipientId ||
            "unknown-recipient",
          recipientParticipant: participantFrom(payload.recipientParticipant),
          recipientEmployeeId: stringFrom(payload.recipientEmployeeId),
          message:
            stringFrom(payload.message) ||
            stringFrom(params.message) ||
            entry.message ||
            "",
          previousOwnerEmployeeId: stringFrom(payload.previousOwnerEmployeeId),
          newOwnerEmployeeId: stringFrom(payload.newOwnerEmployeeId),
        }];
      });
    const transcriptCalls = await readTranscriptHandoffCalls(input);
    const callsByKey = new Map<string, HandoffResult>();
    for (const call of [...databaseCalls, ...transcriptCalls]) {
      callsByKey.set(handoffCallKey(call), call);
    }
    return [...callsByKey.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  } finally {
    repository.close();
  }
}
