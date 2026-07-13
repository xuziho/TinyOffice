export type TextContent = {
	type: "text";
	text: string;
};

export type ImageContent = {
	type: "image";
	[key: string]: unknown;
};

export type ContentBlock = TextContent | ImageContent | Record<string, unknown>;

export type ToolResultMessage = {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: ContentBlock[];
	details?: unknown;
	isError: boolean;
	timestamp: number;
	[key: string]: unknown;
};

export type AgentMessage = Record<string, unknown>;

export type HarnessPolicy = {
	rawBytesThreshold: number;
	estimatedTokensThreshold: number;
	previewHeadChars: number;
	previewTailChars: number;
	maxDigestChars: number;
	summaryMode: "basic" | "llm";
	summaryMaxChars: number;
	continuationEnabled: boolean;
	autoCompactEnabled: boolean;
	autoCompactWindowTokens: number;
	autoCompactPercent: number;
	warningPercent: number;
	emergencyPercent: number;
	autoCompactCooldownMs: number;
	maxConsecutiveCompactionFailures: number;
	summaryRetryAttempts: number;
	mediaDowngradeEnabled: boolean;
	providerGuardMode: "off" | "diagnostic";
};

export type StoredToolResultRef = {
	harnessVersion: 1;
	toolCallId: string;
	toolName: string;
	isError: boolean;
	rawOutputRef: string;
	sha256: string;
	bytes: number;
	estimatedTokens: number;
	createdAt: string;
};

export type ToolResultDigest = StoredToolResultRef & {
	preview: string;
};

export type TelemetryEvent =
	| {
			type: "large_tool_result_stored";
			timestamp: string;
			toolCallId: string;
			toolName: string;
			rawOutputRef: string;
			bytes: number;
			estimatedTokens: number;
	  }
	| {
			type: "context_transformed";
			timestamp: string;
			transformedToolResults: number;
			estimatedTokensSaved: number;
	  }
	| {
			type: "token_budget_observed";
			timestamp: string;
			estimatedTokens: number;
			level: "ok" | "warning" | "compact" | "emergency";
	  }
	| {
			type: "auto_compact_requested";
			timestamp: string;
			estimatedTokens: number;
			level: "compact" | "emergency";
	  }
	| {
			type: "auto_compact_skipped";
			timestamp: string;
			estimatedTokens: number;
			reason: string;
	  }
	| {
			type: "auto_compact_completed";
			timestamp: string;
			estimatedTokens: number;
	  }
	| {
			type: "auto_compact_failed";
			timestamp: string;
			estimatedTokens: number;
			error: string;
			consecutiveFailures: number;
	  }
	| {
			type: "tool_result_store_failed";
			timestamp: string;
			toolCallId: string;
			toolName: string;
			error: string;
	  }
	| {
			type: "compaction_summary_started";
			timestamp: string;
			mode: "basic" | "llm";
			messagesToSummarize: number;
			turnPrefixMessages: number;
			tokensBefore: number;
	  }
	| {
			type: "compaction_summary_completed";
			timestamp: string;
			mode: "basic" | "llm";
			summaryChars: number;
			firstKeptEntryId: string;
	  }
	| {
			type: "compaction_summary_fallback";
			timestamp: string;
			reason: string;
	  }
	| {
			type: "compaction_summary_retry";
			timestamp: string;
			attempt: number;
			omittedMessages: number;
			reason: string;
	  }
	| {
			type: "media_downgraded";
			timestamp: string;
			messageCount: number;
			blockCount: number;
	  }
	| {
			type: "provider_payload_diagnostic";
			timestamp: string;
			estimatedTokens: number;
			issues: string[];
	  }
	| {
			type: "provider_cache_observed";
			timestamp: string;
			status?: number;
			cacheHeaders: Record<string, string>;
	  }
	| {
			type: "compaction_hook_failed";
			timestamp: string;
			error: string;
	  }
	| {
			type: "continuation_dispatched";
			timestamp: string;
			compactionEntryId: string;
	  }
	| {
			type: "continuation_skipped";
			timestamp: string;
			compactionEntryId?: string;
			reason: string;
	  }
	| {
			type: "continuation_failed";
			timestamp: string;
			compactionEntryId: string;
			error: string;
	  }
	| {
			type: "continuation_pending_saved";
			timestamp: string;
			compactionEntryId: string;
			reason: string;
	  }
	| {
			type: "continuation_pending_injected";
			timestamp: string;
			compactionEntryId: string;
	  };

export type HarnessCompactionDetails = {
	piContextHarness: {
		harnessVersion: 1;
		summaryMode: "basic" | "llm";
		messagesToSummarize: number;
		turnPrefixMessages: number;
		isSplitTurn: boolean;
		previousSummaryIncluded: boolean;
		createdAt: string;
		continuationPrompt: string;
	};
};
