import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";

export function nowIso() {
  return new Date().toISOString();
}

export async function appendRuntimeResponderTrace(entry: Record<string, unknown>): Promise<void> {
  const logDir = path.resolve(process.cwd(), ".scratch");
  const logPath = path.join(logDir, "runtime-provider-responder.jsonl");
  await mkdir(logDir, { recursive: true });
  await appendFile(
    logPath,
    `${JSON.stringify({
      timestamp: nowIso(),
      ...entry,
    })}\n`,
    "utf8",
  );
}
