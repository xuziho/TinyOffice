import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HarnessCompactionDetails } from "./types.ts";
import type { TelemetryWriter } from "./telemetry.ts";

type CompactionEntry = {
	id: string;
	summary: string;
	details?: unknown;
};

type ContinuationApi = {
	sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
};

type PendingContinuation = {
	compactionEntryId: string;
	prompt: string;
	createdAt: string;
	reason: string;
};

export class ContinuationManager {
	private readonly dispatchedCompactionIds = new Set<string>();
	private readonly pendingCompactionIds = new Set<string>();

	constructor(
		private readonly telemetry: TelemetryWriter,
		private readonly cwd: string,
	) {}

	async afterCompact(event: { compactionEntry: CompactionEntry; fromExtension: boolean }, api: ContinuationApi): Promise<void> {
		const details = event.compactionEntry.details as HarnessCompactionDetails | undefined;
		const harness = details?.piContextHarness;
		if (!event.fromExtension || !harness) {
			await this.telemetry.write({
				type: "continuation_skipped",
				timestamp: new Date().toISOString(),
				compactionEntryId: event.compactionEntry.id,
				reason: "compaction was not produced by pi-context-harness",
			});
			return;
		}
		if (this.dispatchedCompactionIds.has(event.compactionEntry.id) || this.pendingCompactionIds.has(event.compactionEntry.id)) {
			await this.telemetry.write({
				type: "continuation_skipped",
				timestamp: new Date().toISOString(),
				compactionEntryId: event.compactionEntry.id,
				reason: "continuation already dispatched or pending for compaction entry",
			});
			return;
		}
		if (!harness.continuationPrompt.trim()) {
			await this.telemetry.write({
				type: "continuation_skipped",
				timestamp: new Date().toISOString(),
				compactionEntryId: event.compactionEntry.id,
				reason: "empty continuation prompt",
			});
			return;
		}

		this.pendingCompactionIds.add(event.compactionEntry.id);
		setTimeout(() => {
			this.dispatch(event.compactionEntry.id, harness.continuationPrompt, api).catch(() => undefined);
		}, 0);
	}

	private async dispatch(compactionEntryId: string, prompt: string, api: ContinuationApi): Promise<void> {
		try {
			api.sendUserMessage(prompt, { deliverAs: "followUp" });
			this.pendingCompactionIds.delete(compactionEntryId);
			this.dispatchedCompactionIds.add(compactionEntryId);
			await this.telemetry.write({
				type: "continuation_dispatched",
				timestamp: new Date().toISOString(),
				compactionEntryId,
			});
		} catch (error) {
			this.pendingCompactionIds.delete(compactionEntryId);
			await this.telemetry.write({
				type: "continuation_failed",
				timestamp: new Date().toISOString(),
				compactionEntryId,
				error: error instanceof Error ? error.message : String(error),
			});
			await this.savePending(compactionEntryId, prompt, error instanceof Error ? error.message : String(error));
		}
	}

	async consumePendingMessage(): Promise<
		| {
				customType: string;
				content: string;
				display: boolean;
				details: { piContextHarness: { compactionEntryId: string; pendingContinuation: true; createdAt: string } };
		  }
		| undefined
	> {
		const pending = await this.readPending();
		if (pending.length === 0) return undefined;
		const [next, ...rest] = pending;
		await this.writePending(rest);
		this.dispatchedCompactionIds.add(next.compactionEntryId);
		await this.telemetry.write({
			type: "continuation_pending_injected",
			timestamp: new Date().toISOString(),
			compactionEntryId: next.compactionEntryId,
		});
		return {
			customType: "pi-context-harness.continuation",
			content: [
				"Context Harness continuation recovered after compaction.",
				"This is a same-task continuation instruction injected by the local extension because immediate follow-up dispatch was unavailable.",
				next.prompt,
			].join("\n\n"),
			display: false,
			details: {
				piContextHarness: {
					compactionEntryId: next.compactionEntryId,
					pendingContinuation: true,
					createdAt: next.createdAt,
				},
			},
		};
	}

	private async savePending(compactionEntryId: string, prompt: string, reason: string): Promise<void> {
		const existing = await this.readPending();
		if (existing.some((item) => item.compactionEntryId === compactionEntryId)) return;
		const pending: PendingContinuation = {
			compactionEntryId,
			prompt,
			createdAt: new Date().toISOString(),
			reason,
		};
		await this.writePending([...existing, pending]);
		await this.telemetry.write({
			type: "continuation_pending_saved",
			timestamp: new Date().toISOString(),
			compactionEntryId,
			reason,
		});
	}

	private async readPending(): Promise<PendingContinuation[]> {
		try {
			const raw = await readFile(this.pendingPath, "utf8");
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(isPendingContinuation);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
			return [];
		}
	}

	private async writePending(pending: PendingContinuation[]): Promise<void> {
		await mkdir(path.dirname(this.pendingPath), { recursive: true });
		const tmpPath = `${this.pendingPath}.${process.pid}.tmp`;
		await writeFile(tmpPath, `${JSON.stringify(pending, null, 2)}\n`, "utf8");
		await rename(tmpPath, this.pendingPath);
	}

	private get pendingPath(): string {
		return path.join(this.cwd, ".pi", "pi-context-harness", "pending-continuations.json");
	}
}

function isPendingContinuation(value: unknown): value is PendingContinuation {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.compactionEntryId === "string" &&
		typeof candidate.prompt === "string" &&
		typeof candidate.createdAt === "string" &&
		typeof candidate.reason === "string"
	);
}
