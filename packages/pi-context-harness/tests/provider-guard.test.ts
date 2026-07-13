import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectProviderPayload, inspectProviderResponse, providerPayloadIssues } from "../src/provider-guard.ts";
import { normalizePolicy } from "../src/policy.ts";
import { TelemetryWriter } from "../src/telemetry.ts";

test("detects oversized provider payloads and malformed digests", () => {
	const policy = normalizePolicy({
		autoCompactWindowTokens: 100,
		autoCompactPercent: 20,
		emergencyPercent: 40,
	});

	const issues = providerPayloadIssues(
		{ messages: [{ content: "<tool_result_digest>\npreview only\n</tool_result_digest>" }, { content: "x ".repeat(240) }] },
		100,
		policy,
	);

	assert.ok(issues.includes("provider payload is above emergency token threshold"));
	assert.ok(issues.includes("tool result digest is missing raw_output_ref"));
});

test("writes diagnostic telemetry without replacing provider payload", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const policy = normalizePolicy({
			autoCompactWindowTokens: 100,
			autoCompactPercent: 20,
			emergencyPercent: 40,
		});
		await inspectProviderPayload(
			{ messages: [{ content: "<tool_result_digest>\npreview only\n</tool_result_digest>" }, { content: "x ".repeat(240) }] },
			{ policy, telemetry: new TelemetryWriter(cwd) },
		);

		const telemetry = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetry, /provider_payload_diagnostic/);
		assert.match(telemetry, /tool result digest is missing raw_output_ref/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("records provider cache headers when available", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		await inspectProviderResponse(
			{
				status: 200,
				headers: {
					"anthropic-cache-hit": "true",
					"content-type": "application/json",
				},
			},
			{ policy: normalizePolicy(), telemetry: new TelemetryWriter(cwd) },
		);

		const telemetry = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetry, /provider_cache_observed/);
		assert.match(telemetry, /anthropic-cache-hit/);
		assert.doesNotMatch(telemetry, /content-type/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
