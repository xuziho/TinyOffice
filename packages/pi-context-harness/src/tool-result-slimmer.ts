import { createHash } from "node:crypto";
import type { ContentBlock, HarnessPolicy, ToolResultDigest, ToolResultMessage } from "./types.ts";
import { estimateTokens, extractModelText, previewText, utf8Bytes } from "./text.ts";

export type SlimmingCandidate = {
	message: ToolResultMessage;
	text: string;
	bytes: number;
	estimatedTokens: number;
	sha256: string;
};

export function isToolResultMessage(message: unknown): message is ToolResultMessage {
	if (!message || typeof message !== "object") return false;
	const value = message as Partial<ToolResultMessage>;
	return (
		value.role === "toolResult" &&
		typeof value.toolCallId === "string" &&
		typeof value.toolName === "string" &&
		Array.isArray(value.content)
	);
}

export function buildSlimmingCandidate(message: ToolResultMessage): SlimmingCandidate {
	const text = extractModelText(message.content);
	return {
		message,
		text,
		bytes: utf8Bytes(text),
		estimatedTokens: estimateTokens(text),
		sha256: createHash("sha256").update(text).digest("hex"),
	};
}

export function shouldSlimToolResult(candidate: SlimmingCandidate, policy: HarnessPolicy): boolean {
	return candidate.bytes >= policy.rawBytesThreshold || candidate.estimatedTokens >= policy.estimatedTokensThreshold;
}

export function buildDigestContent(digest: ToolResultDigest, policy: HarnessPolicy): ContentBlock[] {
	const text = [
		"<tool_result_digest>",
		`tool: ${digest.toolName}`,
		`tool_call_id: ${digest.toolCallId}`,
		`status: ${digest.isError ? "error" : "success"}`,
		`raw_output_ref: ${digest.rawOutputRef}`,
		`sha256: ${digest.sha256}`,
		`raw_bytes: ${digest.bytes}`,
		`estimated_tokens: ${digest.estimatedTokens}`,
		`approx_tokens_saved: ${Math.max(0, digest.estimatedTokens - estimateTokens(digest.preview))}`,
		"preview:",
		digest.preview,
		"</tool_result_digest>",
	].join("\n");

	return [{ type: "text", text: text.slice(0, policy.maxDigestChars) }];
}

export function buildDigestMessage(
	message: ToolResultMessage,
	digest: ToolResultDigest,
	policy: HarnessPolicy,
): ToolResultMessage {
	return {
		...message,
		content: buildDigestContent(digest, policy),
		details: {
			...(isPlainObject(message.details) ? message.details : {}),
			piContextHarness: {
				harnessVersion: digest.harnessVersion,
				rawOutputRef: digest.rawOutputRef,
				sha256: digest.sha256,
				bytes: digest.bytes,
				estimatedTokens: digest.estimatedTokens,
			},
		},
	};
}

export function createDigest(candidate: SlimmingCandidate, rawOutputRef: string, policy: HarnessPolicy): ToolResultDigest {
	return {
		harnessVersion: 1,
		toolCallId: candidate.message.toolCallId,
		toolName: candidate.message.toolName,
		isError: candidate.message.isError,
		rawOutputRef,
		sha256: candidate.sha256,
		bytes: candidate.bytes,
		estimatedTokens: candidate.estimatedTokens,
		createdAt: new Date().toISOString(),
		preview: previewText(candidate.text, policy.previewHeadChars, policy.previewTailChars),
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
