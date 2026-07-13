import { runEvidenceQueryCli } from "./evidence-query-cli.js";
import { runDoctorCli } from "./doctor-cli.js";
import { runBackupCli } from "./backup-cli.js";

async function main() {
  const repoRoot = process.cwd();
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "query") {
    const result = await runEvidenceQueryCli(rawArgs.slice(1), { repoRoot });
    process.stdout.write(`${result}\n`);
    return;
  }
  if (rawArgs[0] === "doctor") {
    const result = await runDoctorCli(rawArgs.slice(1));
    process.stdout.write(`${result}\n`);
    return;
  }
  if (rawArgs[0] === "backup") {
    const result = await runBackupCli(rawArgs.slice(1), { repoRoot });
    process.stdout.write(`${result}\n`);
    return;
  }

  throw new Error(`Unknown agentco command: ${rawArgs[0] || "(empty)"}. Supported commands: query, doctor, backup.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
  process.exitCode = 1;
});
