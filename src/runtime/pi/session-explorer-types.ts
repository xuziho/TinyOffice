import type { RuntimeSessionInspection } from "../session-inspector/session-inspector.js";
import type { RuntimeActivityItem } from "../activity/runtime-activity-projection.js";

export interface SessionExplorerMessageEvent {
  index: number;
  timestamp?: string;
  eventType: string;
  role?: string;
  text: string;
  fileName: string;
}

export type SessionExplorerEvidenceLinkKind =
  | "session"
  | "work_run"
  | "process_trace";

export interface SessionExplorerEvidenceLink {
  kind: SessionExplorerEvidenceLinkKind;
  label: string;
  targetId: string;
  href?: string;
}

export interface SessionExplorerChatReturnTarget {
  surface: "direct" | "channel";
  conversationId: string;
}

export interface SessionExplorerSessionSummary {
  employeeId: string;
  displayName: string;
  role: string;
  sessionId: string;
  sessionDirPath: string;
  cwd?: string;
  sessionKey?: string;
  sceneType?: string;
  requesterUsername?: string;
  startedAt?: string;
  lastActivityAt?: string;
  transcriptFileCount: number;
  eventCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  tokenInputTotal: number;
  tokenOutputTotal: number;
  tokenCacheTotal: number;
  modelProvider?: string;
  modelId?: string;
  lastUserMessagePreview?: string;
  lastAssistantMessagePreview?: string;
  chatReturnTarget?: SessionExplorerChatReturnTarget;
  evidenceLinks: SessionExplorerEvidenceLink[];
}

export interface SessionExplorerSessionDetail {
  summary: SessionExplorerSessionSummary;
  overview: SessionExplorerSessionOverview;
  runtimeTurns: SessionExplorerRuntimeTurn[];
  conversationTurns: SessionExplorerConversationTurn[];
  promptInputPackages: SessionExplorerPromptInputPackage[];
  workDone: SessionExplorerWorkDone;
  usage: SessionExplorerUsage;
  rawEvidence: SessionExplorerRawEvidence;
  transcriptFiles: string[];
  events: SessionExplorerMessageEvent[];
  aiCallTranscript: SessionExplorerAiCallTranscript;
  runtimeInspection: RuntimeSessionInspection;
  actionSummary: SessionExplorerActionSummary;
}

export interface SessionExplorerPromptInputPackage {
  turnId?: string;
  modelCallId?: string;
  createdAt?: string;
  employeeId: string;
  sessionKey?: string;
  sceneType?: string;
  systemPrompt: string;
  runtimePrompt: string;
  runtimeContext: string;
  contextBlocks: Array<{
    role: string;
    source: string;
    label: string;
    text: string;
  }>;
  triggerMessage: string;
  userMessage: string;
  promptBlocks: Array<{
    id: string;
    sha256?: string;
    content?: string;
  }>;
  employeeInstructions: Array<{
    path: string;
    sha256?: string;
    content?: string;
  }>;
  tools: string[];
  skills: string[];
  cacheEvidence: {
    fullInputSha256?: string;
    stablePrefixSha256?: string;
    estimatedStablePrefixChars?: number;
  };
}

export interface SessionExplorerIndex {
  generatedAt: string;
  employeeCount: number;
  sessionCount: number;
  sessions: SessionExplorerSessionSummary[];
}

export interface SessionExplorerActionSummary {
  items: string[];
  sourceEventCount: number;
}

export type SessionExplorerTranscriptDirection =
  | "sent_to_ai"
  | "received_from_ai"
  | "tool_call"
  | "tool_result"
  | "collaboration_action"
  | "runtime"
  | "debug";

export interface SessionExplorerAiCallTranscriptEntry {
  index: number;
  timestamp?: string;
  direction: SessionExplorerTranscriptDirection;
  label: string;
  eventType: string;
  role?: string;
  text: string;
  source: "session_events" | "process_trace_events" | "collaboration_action_events";
  complete: boolean;
}

export interface SessionExplorerAiCallTranscriptTurn {
  index: number;
  title: string;
  startedAt?: string;
  entries: SessionExplorerAiCallTranscriptEntry[];
}

export interface SessionExplorerAiCallTranscript {
  turns: SessionExplorerAiCallTranscriptTurn[];
  rawEventCount: number;
}

export interface SessionExplorerUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

export interface SessionExplorerSessionOverview {
  status: string;
  surface: string;
  turns: number;
  messages: {
    user: number;
    employee: number;
  };
  modelCalls: number;
  tools: number;
  usage: SessionExplorerUsageTotals;
  startedAt?: string;
  lastActivityAt?: string;
  requester?: string;
  model?: string;
  cwd?: string;
}

export interface SessionExplorerConversationTurn {
  index: number;
  turnId: string;
  startedAt?: string;
  completedAt?: string;
  modelCallId?: string;
  userMessage?: {
    messageId?: string;
    timestamp?: string;
    text: string;
  };
  employeeReply?: {
    timestamp?: string;
    text: string;
  };
  usage: SessionExplorerUsageTotals;
  toolCalls: Array<{
    name: string;
    summary: string;
  }>;
}

export type SessionExplorerRuntimeActivityItem = RuntimeActivityItem;

export interface SessionExplorerRuntimeTurn {
  index: number;
  turnId: string;
  startedAt?: string;
  completedAt?: string;
  modelCallId?: string;
  usage: SessionExplorerUsageTotals;
  triggerMessage?: {
    label: string;
    timestamp?: string;
    text: string;
    source?: string;
  };
  inputPackage?: SessionExplorerPromptInputPackage;
  activity: {
    items: SessionExplorerRuntimeActivityItem[];
  };
  outputMessage?: {
    label: string;
    timestamp?: string;
    text: string;
    source?: string;
  };
}

export interface SessionExplorerWorkDone {
  toolCalls: Array<{
    name: string;
    summary: string;
    timestamp?: string;
  }>;
  toolResults: Array<{
    name: string;
    summary: string;
    timestamp?: string;
  }>;
  actions: string[];
  artifacts: string[];
}

export interface SessionExplorerUsage {
  total: SessionExplorerUsageTotals;
  byTurn: Array<{
    turnId: string;
    modelCallId?: string;
    usage: SessionExplorerUsageTotals;
  }>;
}

export interface SessionExplorerRawEvidence {
  sessionEventCount: number;
  processTraceEventCount: number;
  collaborationActionEventCount: number;
  rawEventCount: number;
  sources: string[];
  diagnostics: string[];
}
