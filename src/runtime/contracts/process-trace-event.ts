export type ProcessTraceEventKind =
  | "turn_received"
  | "target_resolved"
  | "channel_topic_context_ready"
  | "employee_reply_started"
  | "model_action_plan"
  | "progress_update"
  | "tool_activity"
  | "model_reasoning_observed"
  | "model_tool_call"
  | "model_tool_result"
  | "model_reply_observed"
  | "model_text_delta"
  | "provider_retry"
  | "tool_call_detected"
  | "structured_action_replayed"
  | "turn_completed"
  | "turn_failed";

export type ProcessTraceEventStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "skipped";

export interface ProcessTraceEvent {
  id: string;
  timestamp: string;
  kind: ProcessTraceEventKind;
  sessionKey: string;
  workTaskId?: string;
  workRunId?: string;
  channelId?: string;
  channelTopicId?: string;
  employeeId?: string;
  title: string;
  summary?: string;
  preview?: string;
  status?: ProcessTraceEventStatus;
  metadata?: Record<string, unknown>;
}
