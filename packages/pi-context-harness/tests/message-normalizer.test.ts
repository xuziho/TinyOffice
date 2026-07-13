import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMessagesForSummary } from "../src/message-normalizer.ts";
import { normalizePolicy } from "../src/policy.ts";

test("downgrades media blocks for compaction summaries", () => {
	const result = normalizeMessagesForSummary(
		[
			{
				role: "user",
				content: [
					{ type: "text", text: "inspect this" },
					{ type: "image", mimeType: "image/png", data: "a".repeat(1000), size: 1000 },
				],
				timestamp: Date.now(),
			},
		],
		normalizePolicy(),
	);

	assert.equal(result.downgradedBlocks, 1);
	assert.deepEqual((result.messages[0].content as unknown[])[0], { type: "text", text: "inspect this" });
	assert.match(JSON.stringify(result.messages), /non-text attachment downgraded/);
	assert.doesNotMatch(JSON.stringify(result.messages), /aaaaaaaaaaaaaaaaaaaa/);
});
