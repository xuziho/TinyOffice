import { createHash } from "node:crypto";

export type RuntimeTurnSceneType =
  | "dm_thread"
  | "channel_thread"
  | "intake_event"
  | "work_run_execution"
  | "chat_direct_room"
  | "chat_topic_room";

export interface RuntimeTurnIdentityInput {
  employeeId: string;
  sessionKey: string;
  turnKey?: string;
}

export interface RuntimeTurnIdentity {
  employeeId: string;
  sessionKey: string;
  sessionRecordId: string;
  sceneType: RuntimeTurnSceneType;
  sceneId: string;
  turnId: string;
  runId: string;
  primaryModelCallId: string;
}

export function buildRuntimeTurnIdentity(input: RuntimeTurnIdentityInput): RuntimeTurnIdentity {
  const sessionRecordId = buildRuntimeSessionRecordId(input.employeeId, input.sessionKey);
  const sceneType = deriveRuntimeSceneType(input.sessionKey);
  const sceneSubjectId = deriveRuntimeSubjectId(input.sessionKey);
  const sceneId = `${input.employeeId}|${sceneType}|${sceneSubjectId}`;
  const turnSuffix = input.turnKey ? `|${stableBoundarySegment(input.turnKey)}` : "";
  const turnId = `${sceneId}|turn${turnSuffix}`;
  const runId = sessionRecordId;

  return {
    employeeId: input.employeeId,
    sessionKey: input.sessionKey,
    sessionRecordId,
    sceneType,
    sceneId,
    turnId,
    runId,
    primaryModelCallId: buildRuntimeModelCallId(sessionRecordId, "primary", input.turnKey),
  };
}

export function buildRuntimeModelCallId(
  sessionRecordId: string,
  purpose: "primary",
  turnKey?: string,
): string {
  if (turnKey) {
    return `${sessionRecordId}|turn|${stableBoundarySegment(turnKey)}|model_call|${purpose}`;
  }
  return `${sessionRecordId}|model_call|${purpose}`;
}

export function buildRuntimeSessionRecordId(employeeId: string, sessionKey: string): string {
  const stable = Buffer.from(`${employeeId}|${sessionKey}`).toString("base64url").slice(0, 96);
  return `runtime-session-${stable}`;
}

export function deriveRuntimeSceneType(sessionKey: string): RuntimeTurnSceneType {
  const [, scene] = sessionKey.split("|");
  if (
    scene === "dm_thread" ||
    scene === "channel_thread" ||
    scene === "intake_event" ||
    scene === "work_run_execution" ||
    scene === "chat_direct_room" ||
    scene === "chat_topic_room"
  ) {
    return scene;
  }
  return "channel_thread";
}

export function deriveRuntimeSubjectId(sessionKey: string): string {
  const parts = sessionKey.split("|");
  return parts.at(-1) || "unknown-subject";
}

function stableBoundarySegment(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 24);
}
