import type { AgentMessage, HarnessPolicy } from "./types.ts";
import { TelemetryWriter } from "./telemetry.ts";
import { ToolResultStore } from "./tool-result-store.ts";
import {
	buildDigestMessage,
	buildSlimmingCandidate,
	isToolResultMessage,
	shouldSlimToolResult,
} from "./tool-result-slimmer.ts";

export async function transformModelContext(
	messages: AgentMessage[],
	options: {
		policy: HarnessPolicy;
		store: ToolResultStore;
		telemetry: TelemetryWriter;
	},
): Promise<AgentMessage[]> {
	let transformedToolResults = 0;
	let estimatedTokensSaved = 0;

	const transformed: AgentMessage[] = [];
	for (const message of messages) {
		if (!isToolResultMessage(message)) {
			transformed.push(message);
			continue;
		}

		const candidate = buildSlimmingCandidate(message);
		if (!shouldSlimToolResult(candidate, options.policy)) {
			transformed.push(message);
			continue;
		}

		try {
			const digest = await options.store.store(candidate);
			transformed.push(buildDigestMessage(message, digest, options.policy));
			transformedToolResults += 1;
			estimatedTokensSaved += Math.max(0, candidate.estimatedTokens - digest.preview.length / 4);
			await options.telemetry.write({
				type: "large_tool_result_stored",
				timestamp: new Date().toISOString(),
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				rawOutputRef: digest.rawOutputRef,
				bytes: digest.bytes,
				estimatedTokens: digest.estimatedTokens,
			});
		} catch (error) {
			transformed.push(message);
			await options.telemetry.write({
				type: "tool_result_store_failed",
				timestamp: new Date().toISOString(),
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (transformedToolResults > 0) {
		await options.telemetry.write({
			type: "context_transformed",
			timestamp: new Date().toISOString(),
			transformedToolResults,
			estimatedTokensSaved: Math.floor(estimatedTokensSaved),
		});
	}

	return transformed;
}
