export type IntakePriority = "low" | "normal" | "high" | "urgent";

export type IntakeProcessingStatus = "processed" | "rejected";

export interface IntakeRouting {
  targetMemberId?: string;
}

export interface IntakeEventInput {
  schemaVersion: string;
  source: string;
  sourceEventId: string;
  category: string;
  eventType?: string;
  routing?: IntakeRouting;
  priority?: IntakePriority;
  occurredAt?: string;
  summary?: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

export interface IntakeProcessingResult {
  kind: string;
  [key: string]: unknown;
}

export interface IntakeEventRecord {
  id: string;
  receivedAt: string;
  processedAt?: string;
  status: IntakeProcessingStatus;
  input: IntakeEventInput;
  result?: IntakeProcessingResult;
  error?: string;
}

export interface IntakeEventState {
  events: IntakeEventRecord[];
}

export function createEmptyIntakeEventState(): IntakeEventState {
  return {
    events: [],
  };
}
