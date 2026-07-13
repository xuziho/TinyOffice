import type { HarnessPolicy } from "./types.ts";
import type { TelemetryWriter } from "./telemetry.ts";
import { estimateTokens } from "./text.ts";
import { budgetThresholds } from "./token-budget.ts";

export async function inspectProviderPayload(
	payload: unknown,
	options: { policy: HarnessPolicy; telemetry: TelemetryWriter },
): Promise<void> {
	if (options.policy.providerGuardMode === "off") return;
	const json = safeJson(payload);
	const estimatedTokens = estimateTokens(json);
	const issues = providerPayloadIssues(payload, estimatedTokens, options.policy);
	const thresholds = budgetThresholds(options.policy);
	if (issues.length === 0 && estimatedTokens < thresholds.warningTokenThreshold) return;
	await options.telemetry.write({
		type: "provider_payload_diagnostic",
		timestamp: new Date().toISOString(),
		estimatedTokens,
		issues,
	});
}

export async function inspectProviderResponse(
	event: { status?: number; headers?: Record<string, string | string[] | undefined> },
	options: { policy: HarnessPolicy; telemetry: TelemetryWriter },
): Promise<void> {
	if (options.policy.providerGuardMode === "off") return;
	const cacheHeaders = extractCacheHeaders(event.headers ?? {});
	if (Object.keys(cacheHeaders).length === 0) return;
	await options.telemetry.write({
		type: "provider_cache_observed",
		timestamp: new Date().toISOString(),
		status: event.status,
		cacheHeaders,
	});
}

export function providerPayloadIssues(payload: unknown, estimatedTokens: number, policy: HarnessPolicy): string[] {
	const issues: string[] = [];
	const thresholds = budgetThresholds(policy);
	if (estimatedTokens >= thresholds.emergencyTokenThreshold) {
		issues.push("provider payload is above emergency token threshold");
	} else if (policy.autoCompactEnabled && estimatedTokens >= thresholds.autoCompactTokenThreshold) {
		issues.push("provider payload is above auto-compact token threshold");
	}

	const text = safeJson(payload);
	if (text.includes("<tool_result_digest>") && !text.includes("raw_output_ref:")) {
		issues.push("tool result digest is missing raw_output_ref");
	}

	const toolCallIds = collectStringFields(payload, new Set(["toolCallId", "tool_call_id", "id"]));
	const toolResultIds = collectStringFields(payload, new Set(["toolCallId", "tool_call_id"]));
	if (toolResultIds.length > toolCallIds.length + 20) {
		issues.push("payload has suspiciously more tool result ids than tool call ids");
	}

	return [...new Set(issues)];
}

function collectStringFields(value: unknown, names: Set<string>, result: string[] = []): string[] {
	if (!value || typeof value !== "object") return result;
	if (Array.isArray(value)) {
		for (const item of value) collectStringFields(item, names, result);
		return result;
	}
	for (const [key, item] of Object.entries(value)) {
		if (names.has(key) && typeof item === "string") result.push(item);
		collectStringFields(item, names, result);
	}
	return result;
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return String(value);
	}
}

function extractCacheHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, rawValue] of Object.entries(headers)) {
		const normalizedKey = key.toLowerCase();
		if (!isCacheHeader(normalizedKey)) continue;
		const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
		if (typeof value === "string" && value.trim()) result[normalizedKey] = value.trim();
	}
	return result;
}

function isCacheHeader(key: string): boolean {
	return (
		key.includes("cache") ||
		key === "anthropic-ratelimit-input-tokens-reset" ||
		key === "openai-processing-ms"
	);
}
