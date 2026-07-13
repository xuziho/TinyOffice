import { assertNoForbiddenPublicCarrierFields } from "../../collaboration/contracts/conversation-message-contract.js";
import type { RuntimeSessionRepositoryLike, RuntimeSessionStatus } from "../storage/runtime-session-repository.js";
import type {
  TinyOfficeChatTurnDispatchDecision,
  TinyOfficeChatTurnDispatchIgnoredReason,
} from "./tinyoffice-chat-dispatch-decision.js";

export type TinyOfficeChatExecutionDispatchRepository =
  Pick<RuntimeSessionRepositoryLike, "upsertSessionRecord" | "appendSessionEvent"> &
  Partial<Pick<RuntimeSessionRepositoryLike, "save">>;

export type TinyOfficeChatExecutionStatusRepository =
  Pick<RuntimeSessionRepositoryLike, "upsertSessionRecord" | "appendSessionEvent" | "getSessionRecord" | "getSessionDetail"> &
  Partial<Pick<RuntimeSessionRepositoryLike, "save">>;

export type TinyOfficeChatExecutionDispatchResult =
  | {
      kind: "started";
      eventKey: string;
      sessionRecordId: string;
      sessionEventId: string;
      sessionKey: string;
      companyId: string;
      targetMemberId: string;
    }
  | {
      kind: "ignored";
      eventKey: string;
      reason: TinyOfficeChatTurnDispatchIgnoredReason;
    };

export type TinyOfficeChatExecutionTerminalStatus = Extract<RuntimeSessionStatus, "completed" | "failed" | "canceled">;

export async function handleTinyOfficeChatExecutionDispatch(input: {
  decision: TinyOfficeChatTurnDispatchDecision;
  repository: TinyOfficeChatExecutionDispatchRepository;
  now?: () => string;
}): Promise<TinyOfficeChatExecutionDispatchResult> {
  assertNoForbiddenPublicCarrierFields(input.decision);
  if (input.decision.kind === "ignored") {
    return {
      kind: "ignored",
      reason: input.decision.reason,
      eventKey: input.decision.eventKey,
    };
  }

  const timestamp = input.now?.() || new Date().toISOString();
  const sessionRecordId = `tinyoffice-chat-session:${input.decision.eventKey}`;
  const sessionEventId = `${sessionRecordId}|intent:${input.decision.messageId}`;
  const payload = {
    companyId: input.decision.companyId,
    roomId: input.decision.roomId,
    messageId: input.decision.messageId,
    actorMemberId: input.decision.actorMemberId,
    targetMemberId: input.decision.targetMemberId,
    source: input.decision.source,
    reason: input.decision.reason,
    eventKey: input.decision.eventKey,
    sceneType: input.decision.sceneType,
    sessionKey: input.decision.sessionKey,
    preferredLanguage: input.decision.preferredLanguage,
    prefersChinese: input.decision.prefersChinese,
  };
  assertNoForbiddenPublicCarrierFields(payload);

  input.repository.upsertSessionRecord({
    id: sessionRecordId,
    employeeId: input.decision.targetMemberId,
    sessionKey: input.decision.sessionKey,
    sessionId: sessionRecordId,
    sceneType: input.decision.sceneType,
    requesterId: input.decision.actorMemberId,
    status: "running",
    title: `${input.decision.targetMemberId} owned Chat session`,
    summary: `Owned Chat dispatch intent recorded from ${input.decision.roomId}.`,
    startedAt: timestamp,
    updatedAt: timestamp,
  });
  input.repository.appendSessionEvent({
    id: sessionEventId,
    sessionRecordId,
    sequence: 1,
    timestamp,
    kind: "owned_chat_execution_intent",
    role: "user",
    sceneId: input.decision.sessionKey,
    turnId: `${input.decision.sessionKey}|${input.decision.messageId}`,
    runId: sessionRecordId,
    source: "tinyoffice.chat_dispatch",
    visibility: "user_visible",
    semanticRole: "user_message",
    rawEventKind: "owned_chat_execution_intent",
    title: "Owned Chat execution intent",
    summary: input.decision.normalizedMessage.slice(0, 900),
    preview: input.decision.normalizedMessage.slice(0, 1200),
    payload,
    byteSize: Buffer.byteLength(input.decision.normalizedMessage, "utf8"),
  });
  await input.repository.save?.();

  return {
    kind: "started",
    eventKey: input.decision.eventKey,
    sessionRecordId,
    sessionEventId,
    sessionKey: input.decision.sessionKey,
    companyId: input.decision.companyId,
    targetMemberId: input.decision.targetMemberId,
  };
}

export async function updateTinyOfficeChatExecutionDispatchStatus(input: {
  decision: TinyOfficeChatTurnDispatchDecision;
  repository: TinyOfficeChatExecutionStatusRepository;
  status: TinyOfficeChatExecutionTerminalStatus;
  summary: string;
  now?: () => string;
}): Promise<void> {
  assertNoForbiddenPublicCarrierFields(input.decision);
  if (input.decision.kind === "ignored") {
    return;
  }

  const timestamp = input.now?.() || new Date().toISOString();
  const sessionRecordId = `tinyoffice-chat-session:${input.decision.eventKey}`;
  const detail = input.repository.getSessionDetail(sessionRecordId);
  const existing = detail?.record || input.repository.getSessionRecord(sessionRecordId);
  if (!existing) {
    throw new Error(`Owned Chat execution intent ${sessionRecordId} was not recorded before status ${input.status}`);
  }

  input.repository.upsertSessionRecord({
    ...existing,
    status: input.status,
    summary: input.summary,
    updatedAt: timestamp,
  });
  input.repository.appendSessionEvent({
    id: `${sessionRecordId}|status:${input.status}:${timestamp}`,
    sessionRecordId,
    sequence: (detail?.events.length ?? 1) + 1,
    timestamp,
    kind: "owned_chat_execution_status",
    role: "system",
    sceneId: input.decision.sessionKey,
    turnId: `${input.decision.sessionKey}|${input.decision.messageId}`,
    runId: sessionRecordId,
    source: "tinyoffice.chat_dispatch",
    visibility: "user_visible",
    semanticRole: input.status === "canceled" ? "cancellation" : "runtime_status",
    rawEventKind: "owned_chat_execution_status",
    title: `Owned Chat execution ${input.status}`,
    summary: input.summary,
    preview: input.summary,
    payload: {
      companyId: input.decision.companyId,
      roomId: input.decision.roomId,
      messageId: input.decision.messageId,
      targetMemberId: input.decision.targetMemberId,
      eventKey: input.decision.eventKey,
      status: input.status,
    },
    byteSize: Buffer.byteLength(input.summary, "utf8"),
  });
  await input.repository.save?.();
}
