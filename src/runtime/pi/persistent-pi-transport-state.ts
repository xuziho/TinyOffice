import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const PI_TRANSPORT_ENV = "PI_EMPLOYEE_PI_TRANSPORT";
const PI_TRANSPORT_FAILURE_COOLDOWN_MS_ENV = "PI_EMPLOYEE_PI_TRANSPORT_FAILURE_COOLDOWN_MS";
const PI_TRANSPORT_MAX_FAILURES_ENV = "PI_EMPLOYEE_PI_TRANSPORT_MAX_FAILURES";
const PI_WEBSOCKET_CONNECT_TIMEOUT_MS_ENV = "PI_EMPLOYEE_PI_WEBSOCKET_CONNECT_TIMEOUT_MS";
const PI_TRANSPORTS = ["auto", "sse", "websocket", "websocket-cached"] as const;
export type PiTransportSetting = typeof PI_TRANSPORTS[number];
const DEFAULT_PI_TRANSPORT_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_PI_TRANSPORT_MAX_FAILURES = 2;
const TRANSPORT_OBSERVATIONS_FILE = "transport-observations.jsonl";

export interface PiTransportState {
  consecutiveFailures: number;
  cooldownUntilMs?: number;
}

export interface PiTransportSelection {
  requested: PiTransportSetting;
  effective: PiTransportSetting;
  cooldownActive: boolean;
  cooldownUntil?: string;
  consecutiveFailures: number;
  maxFailures: number;
  cooldownMs: number;
  websocketConnectTimeoutMs?: number;
}

export type PiTransportObservation =
  | {
      type: "transport_selected";
      timestamp: string;
      requested: PiTransportSetting;
      effective: PiTransportSetting;
      cooldownActive: boolean;
      cooldownUntil?: string;
      consecutiveFailures: number;
      maxFailures: number;
      cooldownMs: number;
      websocketConnectTimeoutMs?: number;
    }
  | {
      type: "transport_success";
      timestamp: string;
      phase: "start" | "reply";
      requested: PiTransportSetting;
      effective: PiTransportSetting;
      durationMs: number;
    }
  | {
      type: "transport_failure";
      timestamp: string;
      phase: "start" | "reply";
      requested: PiTransportSetting;
      effective: PiTransportSetting;
      outputStarted: boolean;
      error: string;
      consecutiveFailures: number;
      cooldownUntil?: string;
    }
  | {
      type: "transport_retry_sse";
      timestamp: string;
      phase: "start" | "reply";
      reason: string;
    };

const transportStates = new Map<string, PiTransportState>();
function resolvePiTransport(env: NodeJS.ProcessEnv): PiTransportSetting {
  const raw = env[PI_TRANSPORT_ENV]?.trim();
  if (!raw) {
    return "auto";
  }
  if ((PI_TRANSPORTS as readonly string[]).includes(raw)) {
    return raw as PiTransportSetting;
  }
  throw new Error(`${PI_TRANSPORT_ENV} must be one of: ${PI_TRANSPORTS.join(", ")}`);
}

function resolvePositiveIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return parsed;
}

function resolveOptionalNonNegativeIntegerEnv(
  env: NodeJS.ProcessEnv,
  key: string,
): number | undefined {
  const raw = env[key]?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative integer.`);
  }
  return parsed;
}

export function resolveTransportSelection(input: {
  env: NodeJS.ProcessEnv;
  sessionDir: string;
  nowMs?: number;
  forceTransport?: PiTransportSetting;
}): PiTransportSelection {
  const requested = resolvePiTransport(input.env);
  const cooldownMs = resolvePositiveIntegerEnv(
    input.env,
    PI_TRANSPORT_FAILURE_COOLDOWN_MS_ENV,
    DEFAULT_PI_TRANSPORT_FAILURE_COOLDOWN_MS,
  );
  const maxFailures = resolvePositiveIntegerEnv(
    input.env,
    PI_TRANSPORT_MAX_FAILURES_ENV,
    DEFAULT_PI_TRANSPORT_MAX_FAILURES,
  );
  const websocketConnectTimeoutMs = resolveOptionalNonNegativeIntegerEnv(
    input.env,
    PI_WEBSOCKET_CONNECT_TIMEOUT_MS_ENV,
  );
  const state = transportStates.get(input.sessionDir) || { consecutiveFailures: 0 };
  const nowMs = input.nowMs ?? Date.now();
  const cooldownActive =
    requested !== "sse" &&
    state.cooldownUntilMs !== undefined &&
    state.cooldownUntilMs > nowMs;
  const effective = input.forceTransport ?? (cooldownActive ? "sse" : requested);

  return {
    requested,
    effective,
    cooldownActive,
    cooldownUntil: state.cooldownUntilMs ? new Date(state.cooldownUntilMs).toISOString() : undefined,
    consecutiveFailures: state.consecutiveFailures,
    maxFailures,
    cooldownMs,
    websocketConnectTimeoutMs,
  };
}

export function canFallbackToSse(selection: PiTransportSelection): boolean {
  return selection.effective !== "sse" && selection.requested !== "sse";
}

export function recordTransportSuccess(sessionDir: string, selection: PiTransportSelection): void {
  if (selection.effective === "sse") return;
  const state = transportStates.get(sessionDir);
  if (!state) return;
  state.consecutiveFailures = 0;
  state.cooldownUntilMs = undefined;
}

export function recordTransportFailure(input: {
  sessionDir: string;
  selection: PiTransportSelection;
  nowMs?: number;
}): PiTransportState {
  const state = transportStates.get(input.sessionDir) || { consecutiveFailures: 0 };
  if (input.selection.effective === "sse") {
    transportStates.set(input.sessionDir, state);
    return state;
  }
  state.consecutiveFailures += 1;
  const nowMs = input.nowMs ?? Date.now();
  if (
    input.selection.requested !== "sse" &&
    state.consecutiveFailures >= input.selection.maxFailures
  ) {
    state.cooldownUntilMs = nowMs + input.selection.cooldownMs;
  }
  transportStates.set(input.sessionDir, state);
  return state;
}

export async function writeTransportObservation(
  sessionDir: string,
  observation: PiTransportObservation,
): Promise<void> {
  await mkdir(sessionDir, { recursive: true });
  await appendFile(
    path.join(sessionDir, TRANSPORT_OBSERVATIONS_FILE),
    `${JSON.stringify(observation)}\n`,
    "utf8",
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function __recordPiTransportFailureForTests(input: {
  sessionDir: string;
  env: NodeJS.ProcessEnv;
  nowMs?: number;
}): PiTransportState {
  return recordTransportFailure({
    sessionDir: input.sessionDir,
    selection: resolveTransportSelection(input),
    nowMs: input.nowMs,
  });
}

export function __clearPiTransportStateForTests(): void {
  transportStates.clear();
}

export function nowIso() {
  return new Date().toISOString();
}

