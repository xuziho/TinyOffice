export type OperatingEventSeverity = "info" | "success" | "warning" | "error";

export interface OperatingEventSourceRef {
  intakeEventId?: string;
  kind?: string;
  id?: string;
}

export interface OperatingEventRecord {
  id: string;
  timestamp: string;
  actorMemberId: string;
  category?: string;
  severity: OperatingEventSeverity;
  title: string;
  message: string;
  source: OperatingEventSourceRef;
  metadata?: Record<string, unknown>;
}
