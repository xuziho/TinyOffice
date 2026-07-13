import { buildHarnessCompaction } from "./compact-summary.ts";
import { ContinuationManager } from "./continuation.ts";
import { transformModelContext } from "./context-transform.ts";
import { normalizePolicy } from "./policy.ts";
import { inspectProviderPayload, inspectProviderResponse } from "./provider-guard.ts";
import { TelemetryWriter } from "./telemetry.ts";
import { TokenBudgetManager } from "./token-budget.ts";
import { ToolResultStore } from "./tool-result-store.ts";
import type { AgentMessage } from "./types.ts";

type ContextEvent = {
	messages: AgentMessage[];
};

type ContextEventResult = {
	messages?: AgentMessage[];
};

type ExtensionContext = {
	cwd: string;
	modelRegistry?: unknown;
	model?: unknown;
	compact?: (options?: {
		customInstructions?: string;
		onComplete?: (result: unknown) => void;
		onError?: (error: Error) => void;
	}) => void;
};

type ExtensionAPI = {
	on(event: "context", handler: (event: ContextEvent, ctx: ExtensionContext) => Promise<ContextEventResult>): void;
	on(
		event: "before_agent_start",
		handler: (
			event: {
				prompt: string;
				images?: unknown[];
				systemPrompt: string;
				systemPromptOptions: unknown;
			},
			ctx: ExtensionContext,
		) => Promise<
			| {
					message?: {
						customType: string;
						content: string;
						display: boolean;
						details?: unknown;
					};
			  }
			| undefined
		>,
	): void;
	on(
		event: "before_provider_request",
		handler: (event: { payload: unknown }, ctx: ExtensionContext) => Promise<unknown | undefined>,
	): void;
	on(
		event: "after_provider_response",
		handler: (event: { status?: number; headers?: Record<string, string | string[] | undefined> }, ctx: ExtensionContext) => Promise<void>,
	): void;
	on(
		event: "session_before_compact",
		handler: (
			event: {
				preparation: {
					firstKeptEntryId: string;
					messagesToSummarize: AgentMessage[];
					turnPrefixMessages: AgentMessage[];
					isSplitTurn: boolean;
					tokensBefore: number;
					previousSummary?: string;
					fileOps?: {
						readFiles?: Set<string> | string[];
						modifiedFiles?: Set<string> | string[];
					};
				};
				signal?: AbortSignal;
			},
			ctx: ExtensionContext,
		) => Promise<{ compaction?: { summary: string; firstKeptEntryId: string; tokensBefore: number; details?: unknown } } | undefined>,
	): void;
	on(
		event: "session_compact",
		handler: (
			event: {
				compactionEntry: { id: string; summary: string; details?: unknown };
				fromExtension: boolean;
			},
			ctx: ExtensionContext,
		) => Promise<void>,
	): void;
	sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
};

type HarnessRuntime = {
	store: ToolResultStore;
	telemetry: TelemetryWriter;
	continuation: ContinuationManager;
	tokenBudget: TokenBudgetManager;
};

export default function piContextHarness(pi: ExtensionAPI) {
	let lastCwd: string | undefined;
	const runtimeByCwd = new Map<string, HarnessRuntime>();

	pi.on("context", async (event, ctx) => {
		lastCwd = ctx.cwd;
		const policy = normalizePolicy();
		const runtime = getRuntimeForCwd(runtimeByCwd, ctx.cwd, policy);
		const messages = await transformModelContext(event.messages, {
			policy,
			store: runtime.store,
			telemetry: runtime.telemetry,
		});
		await runtime.tokenBudget.observe(messages, policy, ctx);
		return { messages };
	});

	pi.on("before_provider_request", async (event, ctx) => {
		lastCwd = ctx.cwd;
		const policy = normalizePolicy();
		const runtime = getRuntimeForCwd(runtimeByCwd, ctx.cwd, policy);
		await inspectProviderPayload(event.payload, { policy, telemetry: runtime.telemetry });
		return undefined;
	});

	pi.on("after_provider_response", async (event, ctx) => {
		lastCwd = ctx.cwd;
		const policy = normalizePolicy();
		const runtime = getRuntimeForCwd(runtimeByCwd, ctx.cwd, policy);
		await inspectProviderResponse(event, { policy, telemetry: runtime.telemetry });
	});

	pi.on("session_before_compact", async (event, ctx) => {
		lastCwd = ctx.cwd;
		const policy = normalizePolicy();
		const runtime = getRuntimeForCwd(runtimeByCwd, ctx.cwd, policy);
		const compaction = await buildCompactionWithNativeFallback(event.preparation, {
			policy,
			telemetry: runtime.telemetry,
			modelRegistry: ctx.modelRegistry,
			model: ctx.model,
			signal: event.signal,
		});
		if (!compaction) return undefined;
		return { compaction };
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		lastCwd = ctx.cwd;
		const policy = normalizePolicy();
		if (!policy.continuationEnabled) return undefined;
		const runtime = getRuntimeForCwd(runtimeByCwd, ctx.cwd, policy);
		const message = await runtime.continuation.consumePendingMessage();
		return message ? { message } : undefined;
	});

	pi.on("session_compact", async (event) => {
		const policy = normalizePolicy();
		if (!lastCwd) return;
		const runtime = getRuntimeForCwd(runtimeByCwd, lastCwd, policy);
		if (!policy.continuationEnabled) {
			await runtime.telemetry.write({
				type: "continuation_skipped",
				timestamp: new Date().toISOString(),
				compactionEntryId: event.compactionEntry.id,
				reason: "continuation disabled by policy",
			});
			return;
		}
		await runtime.continuation.afterCompact(event, pi);
	});
}

function getRuntimeForCwd(
	runtimeByCwd: Map<string, HarnessRuntime>,
	cwd: string,
	policy: ReturnType<typeof normalizePolicy>,
): HarnessRuntime {
	const existing = runtimeByCwd.get(cwd);
	if (existing) return existing;
	const created = {
		store: new ToolResultStore(cwd, policy),
		telemetry: new TelemetryWriter(cwd),
		continuation: new ContinuationManager(new TelemetryWriter(cwd), cwd),
		tokenBudget: new TokenBudgetManager(new TelemetryWriter(cwd)),
	};
	runtimeByCwd.set(cwd, created);
	return created;
}

export async function buildCompactionWithNativeFallback(
	preparation: Parameters<typeof buildHarnessCompaction>[0],
	ctx: Parameters<typeof buildHarnessCompaction>[1],
) {
	try {
		return await buildHarnessCompaction(preparation, ctx);
	} catch (error) {
		await ctx.telemetry.write({
			type: "compaction_hook_failed",
			timestamp: new Date().toISOString(),
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}
