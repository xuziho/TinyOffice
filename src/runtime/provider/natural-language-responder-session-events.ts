import type { RuntimeSessionEventInput } from "./natural-language-responder-contracts.js";

export function buildRuntimeSessionEventId(sessionRecordId: string, turnId: string, eventOrdinal: number) {
  return `${sessionRecordId}|${turnId}|event|${String(eventOrdinal).padStart(6, "0")}`;
}

export function inferRuntimeSessionEventSource(event: {
  kind: string;
  role?: string;
  source?: string;
}): string {
  if (event.source) {
    return event.source;
  }
  if (event.kind === "user_message") {
    return "tinyoffice.chat.user_message";
  }
  if (event.kind === "assistant_message") {
    return "pi.employee_reply";
  }
  if (event.kind === "error") {
    return "runtime.responder";
  }
  return "pi.session_event";
}

export function inferRuntimeSessionEventVisibility(event: {
  kind: string;
  role?: string;
  visibility?: RuntimeSessionEventInput["visibility"];
}): RuntimeSessionEventInput["visibility"] {
  if (event.visibility) {
    return event.visibility;
  }
  if (
    (event.kind === "user_message" && event.role === "user")
    || (event.kind === "assistant_message" && event.role === "assistant")
  ) {
    return "user_visible";
  }
  if (event.role === "user") {
    return "model_input";
  }
  if (event.kind === "error") {
    return "diagnostic";
  }
  return "raw_evidence";
}

export function inferRuntimeSessionEventSemanticRole(event: {
  kind: string;
  role?: string;
  semanticRole?: string;
}): string {
  if (event.semanticRole) {
    return event.semanticRole;
  }
  if (event.kind === "user_message" && event.role === "user") {
    return "user_message";
  }
  if (event.kind === "assistant_message" && event.role === "assistant") {
    return "assistant_visible_message";
  }
  if (event.role === "user") {
    return "prompt_package";
  }
  if (event.kind === "stream_event") {
    return "model_delta";
  }
  if (event.kind === "error") {
    return "runtime_error";
  }
  return "raw_model_event";
}
