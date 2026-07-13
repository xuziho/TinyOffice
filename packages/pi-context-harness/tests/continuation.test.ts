import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContinuationManager } from "../src/continuation.ts";
import { TelemetryWriter } from "../src/telemetry.ts";
import type { HarnessCompactionDetails } from "../src/types.ts";

test("dispatches continuation once for harness compaction", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const manager = new ContinuationManager(new TelemetryWriter(cwd), cwd);
		const sent: string[] = [];
		const event = {
			fromExtension: true,
			compactionEntry: {
				id: "cmp-1",
				summary: "summary",
				details: details("continue now"),
			},
		};

		await manager.afterCompact(event, {
			sendUserMessage(content) {
				sent.push(content);
			},
		});
		await manager.afterCompact(event, {
			sendUserMessage(content) {
				sent.push(content);
			},
		});
		await waitForDispatch();

		assert.deepEqual(sent, ["continue now"]);
		const telemetry = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetry, /continuation_dispatched/);
		assert.match(telemetry, /continuation_skipped/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("skips non-harness compaction", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const manager = new ContinuationManager(new TelemetryWriter(cwd), cwd);
		let calls = 0;
		await manager.afterCompact(
			{ fromExtension: false, compactionEntry: { id: "cmp-2", summary: "native" } },
			{
				sendUserMessage() {
					calls += 1;
				},
			},
		);
		assert.equal(calls, 0);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("saves and injects pending continuation when immediate dispatch fails", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi-context-harness-"));
	try {
		const manager = new ContinuationManager(new TelemetryWriter(cwd), cwd);
		const event = {
			fromExtension: true,
			compactionEntry: {
				id: "cmp-3",
				summary: "summary",
				details: details("resume carefully"),
			},
		};

		await manager.afterCompact(event, {
			sendUserMessage() {
				throw new Error("stale extension ctx");
			},
		});
		await waitForDispatch();

		const injected = await manager.consumePendingMessage();
		assert.equal(injected?.customType, "pi-context-harness.continuation");
		assert.equal(injected?.display, false);
		assert.match(injected?.content ?? "", /resume carefully/);
		assert.equal(await manager.consumePendingMessage(), undefined);

		const telemetry = await readFile(path.join(cwd, ".pi", "pi-context-harness", "telemetry.jsonl"), "utf8");
		assert.match(telemetry, /continuation_failed/);
		assert.match(telemetry, /continuation_pending_saved/);
		assert.match(telemetry, /continuation_pending_injected/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

function details(prompt: string): HarnessCompactionDetails {
	return {
		piContextHarness: {
			harnessVersion: 1,
			summaryMode: "basic",
			messagesToSummarize: 1,
			turnPrefixMessages: 0,
			isSplitTurn: false,
			previousSummaryIncluded: false,
			createdAt: new Date().toISOString(),
			continuationPrompt: prompt,
		},
	};
}

function waitForDispatch(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 20));
}
