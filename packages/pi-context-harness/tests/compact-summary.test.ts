import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildBasicSummary, buildContinuationPrompt, buildHarnessCompaction, buildSummaryAttempts } from "../src/compact-summary.ts";
import { buildCompactionWithNativeFallback } from "../src/index.ts";
import { normalizePolicy } from "../src/policy.ts";
import { TelemetryWriter } from "../src/telemetry.ts";
import type { AgentMessage } from "../src/types.ts";

test("builds the harness compact summary schema", () => {
	const summary = buildBasicSummary(
		{
			firstKeptEntryId: "keep-1",
			messagesToSummarize: [
				user("Please implement custom compact summary"),
				assistantText("I created src/compact-summary.ts"),
				toolResult("call-1", "bash", "tests passed"),
			],
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 1234,
			fileOps: { readFiles: new Set(["src/index.ts"]), modifiedFiles: new Set(["src/compact-summary.ts"]) },
		},
		16_000,
	);

	for (const heading of [
		"Current Goal",
		"User Constraints And Preferences",
		"Completed Work",
		"Key Decisions",
		"Files Read",
		"Files Modified",
		"Tool Results And External Evidence",
		"Open Questions Or Blockers",
		"Immediate Next Steps",
		"Continuation Instruction",
	]) {
		assert.match(summary, new RegExp(`## ${heading}`));
	}
	assert.match(summary, /src\/index\.ts/);
	assert.match(summary, /src\/compact-summary\.ts/);
	assert.match(summary, /bash call-1/);
});

test("includes previous summary and split turn prefix", () => {
	const summary = buildBasicSummary(
		{
			firstKeptEntryId: "keep-2",
			messagesToSummarize: [user("older request")],
			turnPrefixMessages: [assistantText("early split-turn work")],
			isSplitTurn: true,
			tokensBefore: 2000,
			previousSummary: "Previous compacted facts",
		},
		16_000,
	);

	assert.match(summary, /## Previous Summary/);
	assert.match(summary, /Previous compacted facts/);
	assert.match(summary, /## Split Turn Prefix/);
	assert.match(summary, /early split-turn work/);
});

test("returns compaction details and telemetry", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const telemetry = new TelemetryWriter(cwd);
		const compaction = await buildHarnessCompaction(
			{
				firstKeptEntryId: "keep-3",
				messagesToSummarize: [user("compact me")],
				turnPrefixMessages: [],
				isSplitTurn: false,
				tokensBefore: 1000,
			},
			{ policy: normalizePolicy(), telemetry },
		);

		assert.ok(compaction);
		assert.equal(compaction.firstKeptEntryId, "keep-3");
		assert.equal(compaction.tokensBefore, 1000);
		assert.match(compaction.summary, /# Context Harness Summary/);
		assert.equal(compaction.details.piContextHarness.harnessVersion, 1);
		assert.match(compaction.details.piContextHarness.continuationPrompt, /Continue the same work/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("builds continuation prompt from immediate next steps", () => {
	const prompt = buildContinuationPrompt(
		[
			"# Context Harness Summary",
			"",
			"## Immediate Next Steps",
			"- Run the compact validation.",
			"",
			"## Continuation Instruction",
			"Continue.",
		].join("\n"),
	);

	assert.match(prompt, /Run the compact validation/);
	assert.match(prompt, /Authority boundary/);
});

test("builds retry attempts by omitting older messages first", () => {
	const attempts = buildSummaryAttempts(
		{
			firstKeptEntryId: "keep-retry",
			messagesToSummarize: [user("one"), user("two"), user("three"), user("four")],
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 3000,
		},
		2,
	);

	assert.equal(attempts.length, 3);
	assert.equal(attempts[0].omittedMessages, 0);
	assert.equal(attempts[1].omittedMessages, 2);
	assert.equal(attempts[2].preparation.messagesToSummarize.length, 1);
});

test("downgrades media blocks before building compaction summaries", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const telemetry = new TelemetryWriter(cwd);
		const compaction = await buildHarnessCompaction(
			{
				firstKeptEntryId: "keep-media",
				messagesToSummarize: [
					{
						role: "user",
						content: [
							{ type: "text", text: "summarize image evidence" },
							{ type: "image", mimeType: "image/png", data: "a".repeat(1000), size: 1000 },
						],
						timestamp: Date.now(),
					},
				],
				turnPrefixMessages: [],
				isSplitTurn: false,
				tokensBefore: 1000,
			},
			{ policy: normalizePolicy(), telemetry },
		);

		assert.match(compaction?.summary ?? "", /non-text attachment downgraded/);
		assert.doesNotMatch(compaction?.summary ?? "", /aaaaaaaaaaaaaaaaaaaa/);
		const telemetryJsonl = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetryJsonl, /media_downgraded/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("returns undefined for native PI fallback when custom compaction hook fails", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const telemetry = new TelemetryWriter(cwd);
		const compaction = await buildCompactionWithNativeFallback(
			{ firstKeptEntryId: "keep-bad" } as Parameters<typeof buildCompactionWithNativeFallback>[0],
			{ policy: normalizePolicy(), telemetry },
		);

		assert.equal(compaction, undefined);
		const telemetryJsonl = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetryJsonl, /compaction_hook_failed/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

function user(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function assistantText(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "test",
		provider: "test",
		model: "test",
		usage: {},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function toolResult(toolCallId: string, toolName: string, text: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	};
}
