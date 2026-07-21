import {
  ApprovalRepository,
} from "../governance/repositories/approval-repository.js";
import {
  PostgresCompanyGovernanceStore,
} from "../governance/storage/postgres-company-governance-store.js";
import { DbIntakeEventStore } from "../intake/db-intake-event-store.js";
import { OperatingLogRepository } from "../operating-log/operating-log-repository.js";
import { CompanyDirectoryRepository } from "../runtime/company-config/company-directory-repository.js";
import { normalizeCompanyId } from "../runtime/company-config/company-paths.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "../runtime/company-config/postgres-runtime-connection.js";
import {
  runEvidenceQuery,
  type EvidenceQuery,
  type EvidenceQueryCommand,
  type EvidenceQueryRepositories,
  type EvidenceQueryResult,
} from "../runtime/evidence-query/evidence-query-service.js";
import { RuntimeSessionRepository } from "../runtime/storage/runtime-session-repository.js";
import { WorkRepository } from "../work/work-repository.js";

export interface EvidenceQueryCliOptions {
  repoRoot?: string;
  repositories?: EvidenceQueryRepositories;
  generatedAt?: string;
}

export type EvidenceQueryCliOutput = "json" | "summary";

export type EvidenceQueryCliParseResult = EvidenceQuery & {
  output: EvidenceQueryCliOutput;
};

const COMMANDS = new Set<EvidenceQueryCommand>([
  "members",
  "member",
  "member-state",
  "work",
  "work-run",
  "work-run-events",
  "work-queue",
  "sessions",
  "session",
  "session-events",
  "session-input",
  "trace",
  "actions",
  "intake",
  "approvals",
  "grants",
  "ops",
  "memory",
]);

export async function runEvidenceQueryCli(
  args: string[],
  options: EvidenceQueryCliOptions = {},
): Promise<string> {
  const parsed = parseEvidenceQueryCliArgs(args);
  const repositories = options.repositories || await openEvidenceQueryRepositories(options.repoRoot || process.cwd());
  try {
    const { output, ...query } = parsed;
    const result = await runEvidenceQuery({
      query,
      repositories,
      generatedAt: options.generatedAt,
    });
    return output === "summary" ? result.summary : JSON.stringify(result, null, 2);
  } finally {
    if (!options.repositories) {
      closeEvidenceQueryRepositories(repositories);
    }
  }
}

export function parseEvidenceQueryCliArgs(args: string[]): EvidenceQueryCliParseResult {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    throw new Error(getEvidenceQueryHelp());
  }
  if (command === "sql") {
    throw new Error("Raw SQL evidence queries are not supported. Use repository-backed query commands.");
  }
  if (!COMMANDS.has(command as EvidenceQueryCommand)) {
    throw new Error(`Unknown query command: ${command}`);
  }

  const options = parseOptions(rest);
  if (options.employee !== undefined) {
    throw new Error("--employee is retired; use --member.");
  }
  const positional = Array.isArray(options._) ? options._ : [];
  const firstPositional = positional[0];
  const output: EvidenceQueryCliOutput = Boolean(options.summary) ? "summary" : "json";
  const query: EvidenceQueryCliParseResult = {
    command: command as EvidenceQueryCommand,
    output,
    memberId: stringOption(options, "member") || memberIdFromPositional(command, firstPositional),
    status: stringOption(options, "status"),
    id: stringOption(options, "id") || idFromPositional(command, firstPositional),
    workRunId: stringOption(options, "work-run"),
    sessionRecordId: stringOption(options, "session"),
    kind: stringOption(options, "kind"),
    severity: stringOption(options, "severity"),
    since: stringOption(options, "since"),
    limit: numberOption(options, "limit"),
  };
  return compactQuery(query);
}

export function getEvidenceQueryHelp(): string {
  return [
    "query commands:",
    "  members",
    "  member <memberId>",
    "  member-state <memberId>",
    "  work --member <memberId> --status <status>",
    "  work-run --id <workRunId>",
    "  work-run-events --id <workRunId>",
    "  work-queue --member <memberId>",
    "  sessions --member <memberId> --since <duration>",
    "  session --id <sessionRecordId>",
    "  session-events --id <sessionRecordId> --kind <kind>",
    "  session-input --id <sessionRecordId>",
    "  trace --work-run <workRunId> | --session <sessionRecordId> | --member <memberId>",
    "  actions --member <memberId> | --work-run <workRunId>",
    "  intake --status <status> | --member <memberId> | --id <intakeEventId>",
    "  approvals --status <status> | --member <memberId>",
    "  grants --member <memberId>",
    "  ops --severity <severity> | --member <memberId>",
    "  memory --member <memberId>",
    "",
    "JSON is the default output. Add --summary for a one-line human-readable summary.",
  ].join("\n");
}

export async function openEvidenceQueryRepositories(repoRoot: string): Promise<EvidenceQueryRepositories> {
  const companyId = normalizeCompanyId(process.env.TINYOFFICE_COMPANY_ID);
  const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId });
  const work = await WorkRepository.open(repoRoot, { companyId });
  const runtime = await RuntimeSessionRepository.open(repoRoot, {
    companyId,
    domains: ["sessions", "processTrace", "collaborationActions", "memory"],
  });
  const governanceConnection = await openConfiguredPostgresConnection(repoRoot);
  if (!governanceConnection) {
    throw new Error("Evidence query governance storage requires PostgreSQL runtime configuration.");
  }
  let governanceStore: PostgresCompanyGovernanceStore;
  try {
    governanceStore = await PostgresCompanyGovernanceStore.open({ ...governanceConnection, companyId });
  } catch (error) {
    governanceConnection.client.release();
    await endCompanyPostgresPool(governanceConnection.pool);
    throw error;
  }
  const governance = new ApprovalRepository(governanceStore);
  const intake = await DbIntakeEventStore.open({ repoRoot, companyId });
  const ops = await OperatingLogRepository.open(repoRoot, { companyId });
  return {
    directory,
    work,
    runtime,
    governance,
    intake,
    ops,
  };
}

export function closeEvidenceQueryRepositories(repositories: EvidenceQueryRepositories): void {
  repositories.directory.close?.();
  repositories.work.close?.();
  repositories.runtime.close?.();
  repositories.intake.close?.();
  repositories.ops.close?.();
  const governanceStore = repositories.governance as { store?: { close?(): void }; close?(): void };
  governanceStore.close?.();
  governanceStore.store?.close?.();
}

function memberIdFromPositional(command: string, value: string | undefined): string | undefined {
  return command === "member" || command === "member-state" ? value : undefined;
}

function idFromPositional(command: string, value: string | undefined): string | undefined {
  return ["work-run", "work-run-events", "session", "session-events", "session-input", "intake"].includes(command)
    ? value
    : undefined;
}

function parseOptions(args: string[]): Record<string, string | number | boolean | string[]> {
  const options: Record<string, string | boolean | string[]> = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      (options._ as string[]).push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "summary") {
      options[key] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value.`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function stringOption(
  options: Record<string, string | number | boolean | string[]>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function numberOption(
  options: Record<string, string | number | boolean | string[]>,
  name: string,
): number | undefined {
  const value = stringOption(options, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return parsed;
}

function compactQuery(input: EvidenceQueryCliParseResult): EvidenceQueryCliParseResult {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ""),
  ) as EvidenceQueryCliParseResult;
}
