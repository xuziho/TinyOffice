import path from "node:path";
import { createTinyOfficeBackup, inspectTinyOfficeBackup, restoreTinyOfficeBackup, verifyTinyOfficeBackup } from "../runtime/backup/tinyoffice-backup.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runBackupCli(args: string[], input: { repoRoot: string }): Promise<string> {
  const action = args[0];
  if (action === "create") {
    const result = await createTinyOfficeBackup({ repoRoot: input.repoRoot, outputDirectory: option(args, "--output") });
    const { manifest: _manifest, ...receipt } = result;
    return JSON.stringify(receipt, null, 2);
  }
  const archivePath = option(args, "--from") || args[1];
  if (!archivePath) throw new Error(`backup ${action || "(missing)"} requires a backup path.`);
  if (action === "inspect") return JSON.stringify(await inspectTinyOfficeBackup(path.resolve(archivePath)), null, 2);
  if (action === "verify") return JSON.stringify({ ok: true, manifest: await verifyTinyOfficeBackup(path.resolve(archivePath)) }, null, 2);
  if (action === "restore") {
    return JSON.stringify(await restoreTinyOfficeBackup({
      repoRoot: input.repoRoot,
      archivePath: path.resolve(archivePath),
      confirmation: option(args, "--confirm") || "",
      maintenanceAcknowledged: args.includes("--maintenance"),
    }), null, 2);
  }
  throw new Error("Unknown backup command. Supported: create, inspect, verify, restore.");
}
