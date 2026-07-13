import { summarizeMessages } from "./message-serialization.ts";
import type { AgentMessage, HarnessPolicy } from "./types.ts";
import { estimateTokens } from "./text.ts";
import type { TelemetryWriter } from "./telemetry.ts";

type CompactContext = {
	model?: unknown;
	compact?: (options?: {
		customInstructions?: string;
		onComplete?: (result: unknown) => void;
		onError?: (error: Error) => void;
	}) => void;
};

export type BudgetLevel = "ok" | "warning" | "compact" | "emergency";

export class TokenBudgetManager {
	private compactInFlight = false;
	private lastCompactRequestAt = 0;
	private consecutiveFailures = 0;

	constructor(private readonly telemetry: TelemetryWriter) {}

	async observe(messages: AgentMessage[], policy: HarnessPolicy, ctx: CompactContext): Promise<void> {
		const estimatedTokens = estimateContextTokens(messages);
		const thresholds = budgetThresholds(policy, ctx.model);
		const level = budgetLevelForThresholds(estimatedTokens, thresholds);
		await this.telemetry.write({
			type: "token_budget_observed",
			timestamp: new Date().toISOString(),
			estimatedTokens,
			level,
		});

		if (!policy.autoCompactEnabled || (level !== "compact" && level !== "emergency")) return;

		const skipReason = this.skipReason(policy, ctx);
		if (skipReason) {
			await this.telemetry.write({
				type: "auto_compact_skipped",
				timestamp: new Date().toISOString(),
				estimatedTokens,
				reason: skipReason,
			});
			return;
		}

		this.compactInFlight = true;
		this.lastCompactRequestAt = Date.now();
		await this.telemetry.write({
			type: "auto_compact_requested",
			timestamp: new Date().toISOString(),
			estimatedTokens,
			level,
		});

		ctx.compact?.({
			customInstructions:
				level === "emergency"
					? "Emergency context compaction requested by pi-context-harness. Preserve the active goal, latest user constraints, file changes, tool-output refs, and immediate next steps."
					: "Context budget compaction requested by pi-context-harness. Preserve the active goal, latest user constraints, file changes, tool-output refs, and immediate next steps.",
			onComplete: () => {
				this.compactInFlight = false;
				this.consecutiveFailures = 0;
				this.telemetry.write({
					type: "auto_compact_completed",
					timestamp: new Date().toISOString(),
					estimatedTokens,
				}).catch(() => undefined);
			},
			onError: (error) => {
				this.compactInFlight = false;
				this.consecutiveFailures += 1;
				this.telemetry.write({
					type: "auto_compact_failed",
					timestamp: new Date().toISOString(),
					estimatedTokens,
					error: error instanceof Error ? error.message : String(error),
					consecutiveFailures: this.consecutiveFailures,
				}).catch(() => undefined);
			},
		});
	}

	private skipReason(policy: HarnessPolicy, ctx: CompactContext): string | undefined {
		if (typeof ctx.compact !== "function") return "ctx.compact unavailable";
		if (this.compactInFlight) return "compaction already in flight";
		if (this.consecutiveFailures >= policy.maxConsecutiveCompactionFailures) {
			return "consecutive compaction failure breaker is open";
		}
		if (Date.now() - this.lastCompactRequestAt < policy.autoCompactCooldownMs) {
			return "auto compact cooldown active";
		}
		return undefined;
	}
}

export function estimateContextTokens(messages: AgentMessage[]): number {
	return estimateTokens(summarizeMessages(messages, 2_000_000));
}

export function budgetLevel(estimatedTokens: number, policy: HarnessPolicy): BudgetLevel {
	return budgetLevelForThresholds(estimatedTokens, budgetThresholds(policy));
}

export type BudgetThresholds = {
	contextWindow: number;
	warningTokenThreshold: number;
	autoCompactTokenThreshold: number;
	emergencyTokenThreshold: number;
};

export function budgetThresholds(policy: HarnessPolicy, model?: unknown): BudgetThresholds {
	const modelContextWindow = extractContextWindow(model);
	const contextWindow = policy.autoCompactWindowTokens > 0
		? Math.min(policy.autoCompactWindowTokens, modelContextWindow || policy.autoCompactWindowTokens)
		: modelContextWindow || 200_000;
	return {
		contextWindow,
		warningTokenThreshold: Math.floor(contextWindow * (policy.warningPercent / 100)),
		autoCompactTokenThreshold: Math.floor(contextWindow * (policy.autoCompactPercent / 100)),
		emergencyTokenThreshold: Math.floor(contextWindow * (policy.emergencyPercent / 100)),
	};
}

export function budgetLevelForThresholds(estimatedTokens: number, thresholds: BudgetThresholds): BudgetLevel {
	if (estimatedTokens >= thresholds.emergencyTokenThreshold) return "emergency";
	if (estimatedTokens >= thresholds.autoCompactTokenThreshold) return "compact";
	if (estimatedTokens >= thresholds.warningTokenThreshold) return "warning";
	return "ok";
}

function extractContextWindow(model: unknown): number | undefined {
	if (!model || typeof model !== "object") return undefined;
	const value = (model as Record<string, unknown>).contextWindow;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
