import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SlimmingCandidate } from "./tool-result-slimmer.ts";
import { createDigest } from "./tool-result-slimmer.ts";
import type { HarnessPolicy, ToolResultDigest } from "./types.ts";

export class ToolResultStore {
	private readonly cache = new Map<string, ToolResultDigest>();

	constructor(
		private readonly cwd: string,
		private readonly policy: HarnessPolicy,
	) {}

	async store(candidate: SlimmingCandidate): Promise<ToolResultDigest> {
		const cacheKey = `${candidate.message.toolCallId}:${candidate.sha256}`;
		const cached = this.cache.get(cacheKey);
		if (cached) return cached;

		const stateDir = path.join(this.cwd, ".pi", "pi-context-harness");
		const outputDir = path.join(stateDir, "tool-results");
		await mkdir(outputDir, { recursive: true });

		const safeToolCallId = sanitizePathPart(candidate.message.toolCallId);
		const safeToolName = sanitizePathPart(candidate.message.toolName);
		const fileName = `${safeToolName}-${safeToolCallId}-${candidate.sha256.slice(0, 12)}.json`;
		const rawOutputRef = path.join(outputDir, fileName);
		const digest = createDigest(candidate, rawOutputRef, this.policy);

		await writeFile(
			rawOutputRef,
			JSON.stringify(
				{
					...digest,
					content: candidate.message.content,
					details: candidate.message.details,
					rawText: candidate.text,
				},
				null,
				2,
			),
			{ encoding: "utf8", flag: "w" },
		);

		this.cache.set(cacheKey, digest);
		return digest;
	}
}

function sanitizePathPart(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "unknown";
}
