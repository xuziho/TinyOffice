import {
  buildRuntimeTurnIdentity,
  type RuntimeTurnIdentity,
  type RuntimeTurnIdentityInput,
} from "./runtime-turn-identity.js";

export type RuntimeModelCallPurpose = "primary";
export type RuntimeModelCallLifecycleKind =
  | "model_call_started"
  | "model_call_delta"
  | "model_call_completed"
  | "model_call_failed";

export interface RuntimeModelCallBoundary {
  id: string;
  purpose: RuntimeModelCallPurpose;
}

export interface RuntimeSceneTurn {
  identity: RuntimeTurnIdentity;
  modelCall: RuntimeModelCallBoundary;
}

export interface RuntimeModelCallLifecycleEventDraft {
  kind: RuntimeModelCallLifecycleKind;
  source: "runtime.model_call";
  visibility: "diagnostic";
  semanticRole: string;
  rawEventKind: RuntimeModelCallLifecycleKind;
  title: string;
  summary?: string;
  preview?: string;
  payload: Record<string, unknown>;
  byteSize: number;
  timestamp?: string;
}

export function buildRuntimeSceneTurn(input: RuntimeTurnIdentityInput): RuntimeSceneTurn {
  const identity = buildRuntimeTurnIdentity(input);
  const id = identity.primaryModelCallId;

  return {
    identity,
    modelCall: {
      id,
      purpose: "primary",
    },
  };
}

export function buildRuntimeModelCallLifecycleEvent(
  turn: RuntimeSceneTurn,
  kind: RuntimeModelCallLifecycleKind,
  input: {
    title: string;
    summary?: string;
    preview?: string;
    payload?: Record<string, unknown>;
    byteSize?: number;
    timestamp?: string;
    semanticRole?: string;
  },
): RuntimeModelCallLifecycleEventDraft {
  return {
    kind,
    source: "runtime.model_call",
    visibility: "diagnostic",
    semanticRole: input.semanticRole || "model_call_lifecycle",
    rawEventKind: kind,
    title: input.title,
    summary: input.summary,
    preview: input.preview,
    payload: {
      ...getRuntimeSceneTurnPayload(turn),
      ...input.payload,
    },
    timestamp: input.timestamp,
    byteSize: input.byteSize ?? Buffer.byteLength(input.preview || input.summary || input.title, "utf8"),
  };
}

export function getRuntimeSceneTurnPayload(turn: RuntimeSceneTurn): Record<string, unknown> {
  return {
    sceneId: turn.identity.sceneId,
    turnId: turn.identity.turnId,
    runId: turn.identity.runId,
    modelCallId: turn.modelCall.id,
    modelCallPurpose: turn.modelCall.purpose,
  };
}
