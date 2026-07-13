import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { transformModelContext } from "../src/context-transform.ts";
import { normalizePolicy } from "../src/policy.ts";
import { TelemetryWriter } from "../src/telemetry.ts";
import { ToolResultStore } from "../src/tool-result-store.ts";
import type { AgentMessage, ToolResultMessage } from "../src/types.ts";

test("keeps small tool results inline", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const policy = normalizePolicy({ rawBytesThreshold: 100, estimatedTokensThreshold: 100 });
		const message = toolResult("call-small", "bash", "short output");
		const result = await transformModelContext([message], {
			policy,
			store: new ToolResultStore(cwd, policy),
			telemetry: new TelemetryWriter(cwd),
		});

		assert.equal((result[0] as ToolResultMessage).content[0]?.type, "text");
		assert.equal(((result[0] as ToolResultMessage).content[0] as { text: string }).text, "short output");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("replaces large tool results with a digest and stores raw output", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const policy = normalizePolicy({
			rawBytesThreshold: 16,
			estimatedTokensThreshold: 999_999,
			previewHeadChars: 8,
			previewTailChars: 8,
		});
		const message = toolResult("call-large", "bash", `alpha\n${"x".repeat(80)}\nomega`);
		const result = await transformModelContext([message], {
			policy,
			store: new ToolResultStore(cwd, policy),
			telemetry: new TelemetryWriter(cwd),
		});

		const transformed = result[0] as ToolResultMessage;
		const text = (transformed.content[0] as { text: string }).text;
		assert.match(text, /<tool_result_digest>/);
		assert.match(text, /tool: bash/);
		assert.match(text, /raw_output_ref:/);
		assert.equal(transformed.toolCallId, "call-large");
		assert.equal(transformed.toolName, "bash");

		const rawOutputRef = text.match(/raw_output_ref: (.+)/)?.[1];
		assert.ok(rawOutputRef);
		const raw = JSON.parse(await readFile(rawOutputRef, "utf8")) as { rawText: string };
		assert.match(raw.rawText, /alpha/);
		assert.match(raw.rawText, /omega/);

		const telemetry = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetry, /large_tool_result_stored/);
		assert.match(telemetry, /context_transformed/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("preserves non-tool-result messages", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const policy = normalizePolicy();
		const message: AgentMessage = { role: "user", content: "hello", timestamp: Date.now() };
		const result = await transformModelContext([message], {
			policy,
			store: new ToolResultStore(cwd, policy),
			telemetry: new TelemetryWriter(cwd),
		});

		assert.deepEqual(result, [message]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

function toolResult(toolCallId: string, toolName: string, text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	};
}
