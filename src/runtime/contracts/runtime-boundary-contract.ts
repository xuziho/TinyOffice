export type RuntimeSceneType =
  | "dm_thread"
  | "channel_thread"
  | "intake_event"
  | "work_run_execution";

export interface SceneRuntimeContract {
  sceneType: RuntimeSceneType;
  sessionKeyPattern: string;
  routingEntry: string;
  promptPackage: {
    builder: string;
    alwaysMountedBlocks: string[];
    mountedSceneBlocks: string[];
    contextSeparated: boolean;
    knownBoundaryDebt: string[];
  };
  toolPolicy: {
    source: string;
    includesHandoff: boolean;
    expectedPrimaryActions: string[];
    completionRuleSource: "scene_prompt_plus_code_validation";
  };
  contextInputs: string[];
  visibilityPolicy: {
    userVisibleTimeline: string;
    diagnostics: string;
    rawEvidence: string;
  };
  tracePolicy: {
    requiresTurnId: boolean;
    requiresModelCallId: boolean;
    modelCallsAreFirstClass: boolean;
  };
  storageBoundary: {
    activeRepository: "postgresql";
    legacyFallbackAllowed: false;
  };
}

export interface RuntimeBoundaryBaselineSummary {
  promptBlocks: {
    alwaysMounted: string[];
    sceneMounted: Record<RuntimeSceneType, string[]>;
    unmountedPromptFiles: string[];
    cleanupRule: string;
  };
  compatibilityPolicy: {
    longTermCompatibilityLayersAllowed: false;
    temporaryBridgeScope: "single_pr_only";
    deletionRule: string;
  };
  storage: {
    activeRuntimeDatabase: "postgresql";
    activeRuntimeLegacyFallbackAllowed: false;
  };
  orchestration: {
    turnIdentityAllocator: "src/runtime/orchestration/runtime-turn-identity.ts";
    sceneTurnBuilder: "src/runtime/orchestration/runtime-scene-turn.ts";
    collaborationActionBoundary: "src/runtime/orchestration/collaboration-action-boundary.ts";
    runtimeNaturalLanguageRequestBuilder: "src/runtime/provider/natural-language-responder.ts";
    runtimeTurnDispatchBoundary: "src/collaboration/runtime-dispatch";
    runtimeRoomContextBoundary: "src/collaboration/chat";
    runtimeSeenEventBoundary: "src/runtime/realtime";
    runtimeProcessTraceBoundary: "src/runtime/realtime/process-trace-store.ts";
    runtimeSceneResponseBoundary: "src/runtime/provider/natural-language-responder.ts";
    collaborationPiToolGateway: "src/collaboration/pi/collaboration-pi-tool-gateway.ts";
    responderUsesAllocator: true;
    responderUsesSceneTurnBuilder: true;
  };
}

export interface RuntimeTraceContract {
  requiredEventFields: Array<
    | "sceneId"
    | "turnId"
    | "runId"
    | "modelCallId"
    | "source"
    | "visibility"
    | "semanticRole"
    | "rawEventKind"
  >;
  visibilityValues: Array<"user_visible" | "diagnostic" | "prompt_context" | "raw_evidence">;
  semanticRoles: Array<
    | "user_message"
    | "user_visible_message"
    | "assistant_visible_message"
    | "runtime_context"
    | "channel_thread_context"
    | "intake_event_context"
    | "work_run_context"
    | "system_prompt"
    | "runtime_prompt_package"
    | "tool_policy"
    | "model_input"
    | "model_output"
    | "model_call_lifecycle"
    | "model_delta"
    | "tool_call"
    | "tool_result"
    | "collaboration_action"
    | "runtime_error"
    | "raw_event"
  >;
  modelCallEvents: Array<
    | "model_call_started"
    | "model_call_delta"
    | "model_call_completed"
    | "model_call_failed"
  >;
  flushIdempotency: {
    required: true;
    acceptedStrategies: Array<"flush_cursor" | "event_fingerprint" | "append_only_event_id_policy">;
  };
  userVisibleTimelineRule: "only_collaboration_surface_visible_events";
  rawEvidenceRule: "preserve_raw_events_without_promoting_them_to_semantic_timeline";
}

const ALWAYS_MOUNTED_PROMPT_BLOCKS: string[] = [];

const STORAGE_BOUNDARY = {
  activeRepository: "postgresql" as const,
  legacyFallbackAllowed: false as const,
};

const DEFAULT_VISIBILITY_POLICY = {
  userVisibleTimeline: "Only messages visible in the collaboration surface belong here.",
  diagnostics: "Runtime prompts, tool policies, wrappers, and empty previews belong in diagnostics.",
  rawEvidence: "Raw events remain inspectable without becoming semantic timeline entries.",
};

export function getSceneRuntimeContracts(): SceneRuntimeContract[] {
  return [
    {
      sceneType: "dm_thread",
      sessionKeyPattern: "{employeeId}|dm_thread|{conversationId}",
      routingEntry: "TinyOffice DM conversation",
      promptPackage: {
        builder: "persistent-pi-employee-agent.buildUserPrompt",
        alwaysMountedBlocks: ALWAYS_MOUNTED_PROMPT_BLOCKS,
        mountedSceneBlocks: ["dm-scene"],
        contextSeparated: true,
        knownBoundaryDebt: [],
      },
      toolPolicy: {
        source: "tinyoffice-runtime-dispatch.buildNaturalLanguageActiveToolNames",
        includesHandoff: false,
        expectedPrimaryActions: [],
        completionRuleSource: "scene_prompt_plus_code_validation",
      },
      contextInputs: ["message", "requester", "reachableParticipants"],
      visibilityPolicy: DEFAULT_VISIBILITY_POLICY,
      tracePolicy: { requiresTurnId: true, requiresModelCallId: true, modelCallsAreFirstClass: true },
      storageBoundary: STORAGE_BOUNDARY,
    },
    {
      sceneType: "channel_thread",
      sessionKeyPattern: "{employeeId}|channel_thread|{topicId}",
      routingEntry: "TinyOffice Chat topic message",
      promptPackage: {
        builder: "persistent-pi-employee-agent.buildUserPrompt",
        alwaysMountedBlocks: ALWAYS_MOUNTED_PROMPT_BLOCKS,
        mountedSceneBlocks: ["channel-scene"],
        contextSeparated: true,
        knownBoundaryDebt: [],
      },
      toolPolicy: {
        source: "tinyoffice-runtime-dispatch.buildNaturalLanguageActiveToolNames",
        includesHandoff: true,
        expectedPrimaryActions: ["handoff_topic_turn"],
        completionRuleSource: "scene_prompt_plus_code_validation",
      },
      contextInputs: ["message", "channelTopic", "threadContext", "requester", "reachableParticipants"],
      visibilityPolicy: DEFAULT_VISIBILITY_POLICY,
      tracePolicy: { requiresTurnId: true, requiresModelCallId: true, modelCallsAreFirstClass: true },
      storageBoundary: STORAGE_BOUNDARY,
    },
    {
      sceneType: "intake_event",
      sessionKeyPattern: "{employeeId}|intake_event|{intakeEventId}",
      routingEntry: "POST /api/companies/{companyId}/intake/events",
      promptPackage: {
        builder: "persistent-pi-employee-agent.buildUserPrompt",
        alwaysMountedBlocks: ALWAYS_MOUNTED_PROMPT_BLOCKS,
        mountedSceneBlocks: ["intake-event"],
        contextSeparated: true,
        knownBoundaryDebt: [],
      },
      toolPolicy: {
        source: "tinyoffice-runtime-dispatch.buildNaturalLanguageActiveToolNames",
        includesHandoff: false,
        expectedPrimaryActions: ["finish_intake_turn"],
        completionRuleSource: "scene_prompt_plus_code_validation",
      },
      contextInputs: ["intakeEvent", "routing.targetMemberId"],
      visibilityPolicy: DEFAULT_VISIBILITY_POLICY,
      tracePolicy: { requiresTurnId: true, requiresModelCallId: true, modelCallsAreFirstClass: true },
      storageBoundary: STORAGE_BOUNDARY,
    },
    {
      sceneType: "work_run_execution",
      sessionKeyPattern: "{employeeId}|work_run_execution|{workRunId}",
      routingEntry: "WorkDispatcher queued WorkRun",
      promptPackage: {
        builder: "persistent-pi-employee-agent.buildUserPrompt + work-execution-service.buildWorkRunExecutionContextBlock",
        alwaysMountedBlocks: ALWAYS_MOUNTED_PROMPT_BLOCKS,
        mountedSceneBlocks: ["workrun-scene"],
        contextSeparated: true,
        knownBoundaryDebt: [],
      },
      toolPolicy: {
        source: "work-execution-service + PI employee active tools",
        includesHandoff: false,
        expectedPrimaryActions: ["finish_work_turn"],
        completionRuleSource: "scene_prompt_plus_code_validation",
      },
      contextInputs: ["workPlan", "workRun", "recentWorkRunEvents", "acceptanceCriteria"],
      visibilityPolicy: DEFAULT_VISIBILITY_POLICY,
      tracePolicy: { requiresTurnId: true, requiresModelCallId: true, modelCallsAreFirstClass: true },
      storageBoundary: STORAGE_BOUNDARY,
    },
  ];
}

export function summarizeRuntimeBoundaryBaseline(): RuntimeBoundaryBaselineSummary {
  return {
    promptBlocks: {
      alwaysMounted: ALWAYS_MOUNTED_PROMPT_BLOCKS,
      sceneMounted: {
        dm_thread: ["dm-scene"],
        channel_thread: ["channel-scene"],
        intake_event: ["intake-event"],
        work_run_execution: ["workrun-scene"],
      },
      unmountedPromptFiles: [],
      cleanupRule: "Every prompt policy block must be mounted by a scene contract or deleted in the same refactor phase.",
    },
    compatibilityPolicy: {
      longTermCompatibilityLayersAllowed: false,
      temporaryBridgeScope: "single_pr_only",
      deletionRule: "Replacement code must delete old names, prompts, tests, and docs before the PR merges.",
    },
    storage: {
      activeRuntimeDatabase: "postgresql",
      activeRuntimeLegacyFallbackAllowed: false,
    },
    orchestration: {
      turnIdentityAllocator: "src/runtime/orchestration/runtime-turn-identity.ts",
      sceneTurnBuilder: "src/runtime/orchestration/runtime-scene-turn.ts",
      collaborationActionBoundary: "src/runtime/orchestration/collaboration-action-boundary.ts",
      runtimeNaturalLanguageRequestBuilder: "src/runtime/provider/natural-language-responder.ts",
      runtimeTurnDispatchBoundary: "src/collaboration/runtime-dispatch",
      runtimeRoomContextBoundary: "src/collaboration/chat",
      runtimeSeenEventBoundary: "src/runtime/realtime",
      runtimeProcessTraceBoundary: "src/runtime/realtime/process-trace-store.ts",
      runtimeSceneResponseBoundary: "src/runtime/provider/natural-language-responder.ts",
      collaborationPiToolGateway: "src/collaboration/pi/collaboration-pi-tool-gateway.ts",
      responderUsesAllocator: true,
      responderUsesSceneTurnBuilder: true,
    },
  };
}

export function getRuntimeTraceContract(): RuntimeTraceContract {
  return {
    requiredEventFields: [
      "sceneId",
      "turnId",
      "runId",
      "modelCallId",
      "source",
      "visibility",
      "semanticRole",
      "rawEventKind",
    ],
    visibilityValues: ["user_visible", "diagnostic", "prompt_context", "raw_evidence"],
    semanticRoles: [
      "user_message",
      "user_visible_message",
      "assistant_visible_message",
      "runtime_context",
      "channel_thread_context",
      "intake_event_context",
      "work_run_context",
      "system_prompt",
      "runtime_prompt_package",
      "tool_policy",
      "model_input",
      "model_output",
      "model_call_lifecycle",
      "model_delta",
      "tool_call",
      "tool_result",
      "collaboration_action",
      "runtime_error",
      "raw_event",
    ],
    modelCallEvents: [
      "model_call_started",
      "model_call_delta",
      "model_call_completed",
      "model_call_failed",
    ],
    flushIdempotency: {
      required: true,
      acceptedStrategies: ["flush_cursor", "event_fingerprint", "append_only_event_id_policy"],
    },
    userVisibleTimelineRule: "only_collaboration_surface_visible_events",
    rawEvidenceRule: "preserve_raw_events_without_promoting_them_to_semantic_timeline",
  };
}
