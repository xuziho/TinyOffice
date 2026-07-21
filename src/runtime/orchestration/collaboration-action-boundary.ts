import type { CollaborationActionEvent } from "../storage/runtime-session-repository.js";
import { RuntimeSessionRepository } from "../storage/runtime-session-repository.js";

export interface CollaborationActionToolLogEntry {
  timestamp?: unknown;
  toolName?: unknown;
  params?: unknown;
  result?: unknown;
  context?: unknown;
  __testBeforeSave?: unknown;
  [key: string]: unknown;
}

export interface HandoffActionCallBoundary {
  timestamp: string;
  channelTopicId?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  chatEntryId?: string;
  actionId?: string;
  recipientParticipantId: string;
  recipientParticipant?: unknown;
  recipientEmployeeId?: string;
  message: string;
  previousOwnerEmployeeId?: string;
  newOwnerEmployeeId?: string;
}

export function buildCollaborationActionEventFromToolLog(
  entry: CollaborationActionToolLogEntry,
  options: {
    now?: () => string;
    createId?: (actionName: string) => string;
  } = {},
): CollaborationActionEvent {
  const timestamp = stringFrom(entry.timestamp) || options.now?.() || nowIso();
  const actionName = stringFrom(entry.toolName) || "unknown_action";
  const params = recordFrom(entry.params);
  const result = recordFrom(entry.result);
  const context = recordFrom(entry.context);
  const payload = payloadFromResult(result);
  const employeeId =
    stringFrom(payload.senderEmployeeId) ||
    stringFrom(payload.requesterEmployeeId) ||
    stringFrom(result.actorEmployeeId) ||
    stringFrom(context.runtimeEmployeeId) ||
    "unknown-employee";
  const channelTopicId =
    stringFrom(payload.channelTopicId) ||
    stringFrom(params.channelTopicId) ||
    stringFrom(context.channelTopicId);
  const status = stringFrom(result.status);
  const recipientId =
    stringFrom(payload.recipientParticipantId) ||
    stringFrom(payload.recipientEmployeeId) ||
    stringFrom(params.toId) ||
    stringFrom(params.recipient);
  const message =
    stringFrom(payload.message) ||
    stringFrom(params.message) ||
    stringFrom(params.reason) ||
    stringFrom(params.title);
  const progressSummary = stringFrom(payload.progressSummary);
  const decision = stringFrom(result.status);
  const emitted = decision !== "denied";

  return {
    id: options.createId?.(actionName) || createCollaborationActionEventId(actionName),
    timestamp,
    employeeId,
    actionName,
    channelTopicId,
    workRunId: stringFrom(payload.workRunId) || stringFrom(params.workRunId),
    status,
    recipientId,
    message,
    progressSummary,
    decision,
    emitted,
    payload: {
      ...entry,
      timestamp,
      context,
    },
  };
}

export function buildSuppressedHandoffActionEvent(input: {
  senderEmployeeId: string;
  handoff: HandoffActionCallBoundary;
  suppressedReason: string;
  now?: () => string;
  createId?: () => string;
}): CollaborationActionEvent {
  return {
    id: input.createId?.() || createSuppressedHandoffActionEventId(),
    timestamp: input.now?.() || nowIso(),
    employeeId: input.senderEmployeeId,
    actionName: "handoff",
    channelTopicId: input.handoff.channelTopicId,
    recipientId: input.handoff.recipientParticipantId,
    message: input.handoff.message,
    decision: "suppressed",
    emitted: false,
    suppressedReason: input.suppressedReason,
    payload: {
      handoff: input.handoff,
      phase: "natural_language.structured_action_suppressed",
    },
  };
}

export function buildRecoveredEmittedHandoffActionEvent(input: {
  senderEmployeeId: string;
  handoff: HandoffActionCallBoundary;
  replayKey: string;
}): CollaborationActionEvent {
  return {
    id: `action-handoff-emitted-${input.replayKey}`,
    timestamp: input.handoff.timestamp,
    employeeId: input.senderEmployeeId,
    actionName: "handoff",
    channelTopicId: input.handoff.channelTopicId,
    recipientId: input.handoff.recipientParticipantId,
    message: input.handoff.message,
    decision: "allowed",
    emitted: true,
    payload: {
      timestamp: input.handoff.timestamp,
      handoff: {
        channelTopicId: input.handoff.channelTopicId,
        threadId: input.handoff.threadId,
        roomId: input.handoff.roomId,
        conversationId: input.handoff.conversationId,
        chatEntryId: input.handoff.chatEntryId,
        actionId: input.handoff.actionId,
        recipientParticipantId: input.handoff.recipientParticipantId,
        message: input.handoff.message,
        result: {
          status: "allowed",
          senderEmployeeId: input.senderEmployeeId,
          recipientParticipant: input.handoff.recipientParticipant,
          recipientEmployeeId: input.handoff.recipientEmployeeId,
          previousOwnerEmployeeId: input.handoff.previousOwnerEmployeeId,
          newOwnerEmployeeId: input.handoff.newOwnerEmployeeId,
        },
      },
      phase: "natural_language.structured_action_emitted_recovered",
    },
  };
}

export async function persistCollaborationActionEvent(
  repoRoot: string,
  companyId: string,
  event: CollaborationActionEvent,
  options: {
    beforeSave?: () => Promise<void>;
  } = {},
): Promise<void> {
  const maxSaveAttempts = 20;
  for (let attempt = 0; attempt < maxSaveAttempts; attempt += 1) {
    const repository = await RuntimeSessionRepository.open(repoRoot, {
      companyId,
      domains: ["collaborationActions"],
    });
    try {
      const exists = repository
        .listCollaborationActionEvents({
          employeeId: event.employeeId,
          actionName: event.actionName,
        })
        .some((stored) => stored.id === event.id);
      if (!exists) {
        repository.appendCollaborationActionEvent(event);
      }
      await options.beforeSave?.();
      await repository.save();
      return;
    } catch (error) {
      if (attempt < maxSaveAttempts - 1 && isStaleDatabaseSave(error)) {
        await waitForRetryTurn();
        continue;
      }
      throw error;
    } finally {
      repository.close();
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createCollaborationActionEventId(actionName: string) {
  return `action-${Date.now()}-${actionName}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSuppressedHandoffActionEventId() {
  return `action-${Date.now()}-handoff-suppressed-${Math.random().toString(36).slice(2, 10)}`;
}

function payloadFromResult(result: Record<string, unknown>) {
  return recordFrom(result.payload);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isStaleDatabaseSave(error: unknown) {
  return error instanceof Error && /Runtime store changed after this handle was opened/.test(error.message);
}

function waitForRetryTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
