export const RUNTIME_EVENT_SCHEMA = "runtime-event" as const;
export const RUNTIME_COMMAND_SCHEMA = "runtime-command" as const;
export const RUNTIME_COMMAND_ACK_SCHEMA = "runtime-command-ack" as const;
export const RUNTIME_REALTIME_CONTRACT_VERSION = 1 as const;

export type RuntimeEventType =
  | "work_run.created"
  | "work_run.updated"
  | "work_run.stale"
  | "work_task.updated"
  | "work_schedule.updated"
  | "employee.status_changed"
  | "session.started"
  | "session.updated"
  | "session.completed"
  | "process_trace.appended"
  | "runtime.policy_changed";

export type RuntimeEntityKind =
  | "work_run"
  | "work_task"
  | "work_schedule"
  | "employee"
  | "session"
  | "process_trace"
  | "runtime_policy";

export interface RuntimeEntityRef {
  kind: RuntimeEntityKind;
  id: string;
}

export interface RuntimeEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  schema: typeof RUNTIME_EVENT_SCHEMA;
  version: typeof RUNTIME_REALTIME_CONTRACT_VERSION;
  eventId: string;
  type: RuntimeEventType;
  occurredAt: string;
  sequence: number;
  entity: RuntimeEntityRef;
  payload: TPayload;
}

export type RuntimeCommandName =
  | "work_run.cancel"
  | "work_run.retry"
  | "work_run.retry_dispatch"
  | "work_task.cancel"
  | "employee.reload"
  | "employees.reload_all";

export interface RuntimeCommand<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  schema: typeof RUNTIME_COMMAND_SCHEMA;
  version: typeof RUNTIME_REALTIME_CONTRACT_VERSION;
  commandId: string;
  name: RuntimeCommandName;
  issuedAt: string;
  payload: TPayload;
}

export type RuntimeCommandAckStatus = "accepted" | "rejected" | "failed";

export interface RuntimeCommandAckError {
  code: string;
  message: string;
}

export interface RuntimeCommandAck {
  schema: typeof RUNTIME_COMMAND_ACK_SCHEMA;
  version: typeof RUNTIME_REALTIME_CONTRACT_VERSION;
  commandId: string;
  status: RuntimeCommandAckStatus;
  acceptedAt: string;
  error?: RuntimeCommandAckError;
}

export type CreateRuntimeEventInput<TPayload extends Record<string, unknown>> = Omit<
  RuntimeEvent<TPayload>,
  "schema" | "version"
>;

export type CreateRuntimeCommandInput<TPayload extends Record<string, unknown>> = Omit<
  RuntimeCommand<TPayload>,
  "schema" | "version"
>;

export type CreateRuntimeCommandAckInput = Omit<RuntimeCommandAck, "schema" | "version">;

export function createRuntimeEvent<TPayload extends Record<string, unknown>>(
  input: CreateRuntimeEventInput<TPayload>,
): RuntimeEvent<TPayload> {
  return {
    schema: RUNTIME_EVENT_SCHEMA,
    version: RUNTIME_REALTIME_CONTRACT_VERSION,
    ...input,
  };
}

export function createRuntimeCommand<TPayload extends Record<string, unknown>>(
  input: CreateRuntimeCommandInput<TPayload>,
): RuntimeCommand<TPayload> {
  return {
    schema: RUNTIME_COMMAND_SCHEMA,
    version: RUNTIME_REALTIME_CONTRACT_VERSION,
    ...input,
  };
}

export function createCommandAck(input: CreateRuntimeCommandAckInput): RuntimeCommandAck {
  return {
    schema: RUNTIME_COMMAND_ACK_SCHEMA,
    version: RUNTIME_REALTIME_CONTRACT_VERSION,
    ...input,
  };
}

export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RuntimeEvent>;
  return (
    candidate.schema === RUNTIME_EVENT_SCHEMA &&
    candidate.version === RUNTIME_REALTIME_CONTRACT_VERSION &&
    typeof candidate.eventId === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.occurredAt === "string" &&
    typeof candidate.sequence === "number" &&
    Boolean(candidate.entity) &&
    typeof candidate.entity?.kind === "string" &&
    typeof candidate.entity?.id === "string" &&
    Boolean(candidate.payload) &&
    typeof candidate.payload === "object"
  );
}
