import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TokenBudgetManager, budgetLevel, budgetThresholds } from "../src/token-budget.ts";
import { normalizePolicy } from "../src/policy.ts";
import { TelemetryWriter } from "../src/telemetry.ts";

test("classifies token budget levels", () => {
	const policy = normalizePolicy({
		autoCompactWindowTokens: 100,
		warningPercent: 10,
		autoCompactPercent: 20,
		emergencyPercent: 30,
	});

	assert.equal(budgetLevel(5, policy), "ok");
	assert.equal(budgetLevel(10, policy), "warning");
	assert.equal(budgetLevel(20, policy), "compact");
	assert.equal(budgetLevel(30, policy), "emergency");
});

test("derives Claude Code-style default auto compact threshold from context window", () => {
	const thresholds = budgetThresholds(normalizePolicy(), { contextWindow: 200_000 });

	assert.equal(thresholds.contextWindow, 200_000);
	assert.equal(thresholds.autoCompactTokenThreshold, 190_000);
});

test("does not request auto compact by default", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const manager = new TokenBudgetManager(new TelemetryWriter(cwd));
		const policy = normalizePolicy({
			autoCompactWindowTokens: 100,
			warningPercent: 10,
			autoCompactPercent: 20,
			emergencyPercent: 30,
		});
		let compactCalls = 0;

		await manager.observe(
			[{ role: "user", content: [{ type: "text", text: "x ".repeat(120) }], timestamp: Date.now() }],
			policy,
			{
				compact() {
					compactCalls += 1;
				},
			},
		);

		assert.equal(compactCalls, 0);
		const telemetry = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetry, /token_budget_observed/);
		assert.doesNotMatch(telemetry, /auto_compact_requested/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("requests auto compact once above threshold", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const manager = new TokenBudgetManager(new TelemetryWriter(cwd));
		const policy = normalizePolicy({
			autoCompactEnabled: true,
			autoCompactWindowTokens: 100,
			warningPercent: 10,
			autoCompactPercent: 20,
			emergencyPercent: 30,
			autoCompactCooldownMs: 60_000,
		});
		let compactCalls = 0;

		await manager.observe(
			[{ role: "user", content: [{ type: "text", text: "x ".repeat(120) }], timestamp: Date.now() }],
			policy,
			{
				compact(options) {
					compactCalls += 1;
					options?.onComplete?.({});
				},
			},
		);
		await manager.observe(
			[{ role: "user", content: [{ type: "text", text: "x ".repeat(120) }], timestamp: Date.now() }],
			policy,
			{
				compact(options) {
					compactCalls += 1;
					options?.onComplete?.({});
				},
			},
		);

		assert.equal(compactCalls, 1);
		const telemetry = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetry, /auto_compact_requested/);
		assert.match(telemetry, /auto_compact_skipped/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("opens failure breaker after repeated auto compact failures", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const manager = new TokenBudgetManager(new TelemetryWriter(cwd));
		const policy = normalizePolicy({
			autoCompactEnabled: true,
			autoCompactWindowTokens: 100,
			warningPercent: 10,
			autoCompactPercent: 20,
			emergencyPercent: 30,
			autoCompactCooldownMs: 1,
			maxConsecutiveCompactionFailures: 1,
		});
		let compactCalls = 0;

		await manager.observe(
			[{ role: "user", content: [{ type: "text", text: "x ".repeat(120) }], timestamp: Date.now() }],
			policy,
			{
				compact(options) {
					compactCalls += 1;
					options?.onError?.(new Error("too long"));
				},
			},
		);
		await manager.observe(
			[{ role: "user", content: [{ type: "text", text: "x ".repeat(120) }], timestamp: Date.now() }],
			policy,
			{
				compact(options) {
					compactCalls += 1;
					options?.onError?.(new Error("too long"));
				},
			},
		);

		assert.equal(compactCalls, 1);
		const telemetry = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetry, /auto_compact_failed/);
		assert.match(telemetry, /consecutive compaction failure breaker is open/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
