import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { TelemetryEvent } from "./types.ts";

export class TelemetryWriter {
	constructor(private readonly cwd: string) {}

	async write(event: TelemetryEvent): Promise<void> {
		const stateDir = path.join(this.cwd, ".pi", "pi-context-harness");
		await mkdir(stateDir, { recursive: true });
		await appendFile(path.join(stateDir, "telemetry.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
	}
}
