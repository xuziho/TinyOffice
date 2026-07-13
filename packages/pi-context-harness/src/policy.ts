import type { HarnessPolicy } from "./types.ts";

export const defaultHarnessPolicy: HarnessPolicy = {
	rawBytesThreshold: Number(process.env.PI_CONTEXT_HARNESS_RAW_BYTES_THRESHOLD ?? 30_000),
	estimatedTokensThreshold: Number(process.env.PI_CONTEXT_HARNESS_TOKEN_THRESHOLD ?? 25_000),
	previewHeadChars: Number(process.env.PI_CONTEXT_HARNESS_PREVIEW_HEAD_CHARS ?? 2_000),
	previewTailChars: Number(process.env.PI_CONTEXT_HARNESS_PREVIEW_TAIL_CHARS ?? 1_000),
	maxDigestChars: Number(process.env.PI_CONTEXT_HARNESS_MAX_DIGEST_CHARS ?? 4_000),
	summaryMode: normalizeSummaryMode(process.env.PI_CONTEXT_HARNESS_SUMMARY_MODE),
	summaryMaxChars: Number(process.env.PI_CONTEXT_HARNESS_SUMMARY_MAX_CHARS ?? 24_000),
	continuationEnabled: process.env.PI_CONTEXT_HARNESS_CONTINUATION !== "0",
	autoCompactEnabled: process.env.PI_CONTEXT_HARNESS_AUTO_COMPACT === "1",
	autoCompactWindowTokens: Number(process.env.PI_CONTEXT_HARNESS_AUTO_COMPACT_WINDOW ?? 0),
	autoCompactPercent: Number(process.env.PI_CONTEXT_HARNESS_AUTO_COMPACT_PERCENT ?? 95),
	warningPercent: Number(process.env.PI_CONTEXT_HARNESS_WARNING_PERCENT ?? 80),
	emergencyPercent: Number(process.env.PI_CONTEXT_HARNESS_EMERGENCY_PERCENT ?? 98),
	autoCompactCooldownMs: Number(process.env.PI_CONTEXT_HARNESS_AUTO_COMPACT_COOLDOWN_MS ?? 60_000),
	maxConsecutiveCompactionFailures: Number(process.env.PI_CONTEXT_HARNESS_MAX_COMPACTION_FAILURES ?? 2),
	summaryRetryAttempts: Number(process.env.PI_CONTEXT_HARNESS_SUMMARY_RETRY_ATTEMPTS ?? 2),
	mediaDowngradeEnabled: process.env.PI_CONTEXT_HARNESS_MEDIA_DOWNGRADE !== "0",
	providerGuardMode: process.env.PI_CONTEXT_HARNESS_PROVIDER_GUARD === "off" ? "off" : "diagnostic",
};

export function normalizePolicy(policy: Partial<HarnessPolicy> = {}): HarnessPolicy {
	const merged = { ...defaultHarnessPolicy, ...policy };
	return {
		rawBytesThreshold: positiveInt(merged.rawBytesThreshold, defaultHarnessPolicy.rawBytesThreshold),
		estimatedTokensThreshold: positiveInt(
			merged.estimatedTokensThreshold,
			defaultHarnessPolicy.estimatedTokensThreshold,
		),
		previewHeadChars: positiveInt(merged.previewHeadChars, defaultHarnessPolicy.previewHeadChars),
		previewTailChars: positiveInt(merged.previewTailChars, defaultHarnessPolicy.previewTailChars),
		maxDigestChars: positiveInt(merged.maxDigestChars, defaultHarnessPolicy.maxDigestChars),
		summaryMode: normalizeSummaryMode(merged.summaryMode),
		summaryMaxChars: positiveInt(merged.summaryMaxChars, defaultHarnessPolicy.summaryMaxChars),
		continuationEnabled: Boolean(merged.continuationEnabled),
		autoCompactEnabled: Boolean(merged.autoCompactEnabled),
		autoCompactWindowTokens: nonNegativeInt(
			merged.autoCompactWindowTokens,
			defaultHarnessPolicy.autoCompactWindowTokens,
		),
		autoCompactPercent: percentOrDefault(merged.autoCompactPercent, defaultHarnessPolicy.autoCompactPercent),
		warningPercent: percentOrDefault(merged.warningPercent, defaultHarnessPolicy.warningPercent),
		emergencyPercent: percentOrDefault(merged.emergencyPercent, defaultHarnessPolicy.emergencyPercent),
		autoCompactCooldownMs: positiveInt(merged.autoCompactCooldownMs, defaultHarnessPolicy.autoCompactCooldownMs),
		maxConsecutiveCompactionFailures: positiveInt(
			merged.maxConsecutiveCompactionFailures,
			defaultHarnessPolicy.maxConsecutiveCompactionFailures,
		),
		summaryRetryAttempts: positiveInt(merged.summaryRetryAttempts, defaultHarnessPolicy.summaryRetryAttempts),
		mediaDowngradeEnabled: Boolean(merged.mediaDowngradeEnabled),
		providerGuardMode: merged.providerGuardMode === "off" ? "off" : "diagnostic",
	};
}

function positiveInt(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value <= 0) return fallback;
	return Math.floor(value);
}

function nonNegativeInt(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value < 0) return fallback;
	return Math.floor(value);
}

function percentOrDefault(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value <= 0 || value > 100) return fallback;
	return value;
}

function normalizeSummaryMode(value: unknown): "basic" | "llm" {
	return value === "llm" ? "llm" : "basic";
}
