import {
  renderTinyOfficeDoctorReport,
  type TinyOfficeDoctorReport,
} from "../runtime/doctor/tinyoffice-doctor.js";

export type DoctorCliOutput = "json" | "summary";

export type DoctorCliArgs = {
  companyId: string;
  runtimeUrl: string;
  output: DoctorCliOutput;
};

export type RunDoctorCliOptions = {
  fetchReport?: (url: URL) => Promise<TinyOfficeDoctorReport>;
};

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseDoctorCliArgs(args: string[]): DoctorCliArgs {
  let companyId = "";
  let runtimeUrl = "http://127.0.0.1:8095";
  let output: DoctorCliOutput = "json";
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--company") {
      companyId = readOptionValue(args, index, "--company");
      index += 1;
      continue;
    }
    if (arg === "--url") {
      runtimeUrl = readOptionValue(args, index, "--url");
      index += 1;
      continue;
    }
    if (arg === "--json") {
      output = "json";
      continue;
    }
    if (arg === "--summary") {
      output = "summary";
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown doctor option: ${arg}`);
    }
    positional.push(arg);
  }

  companyId ||= positional[0] || "";
  runtimeUrl = positional[1] || runtimeUrl;
  if (positional[2] === "summary" || positional[2] === "json") {
    output = positional[2];
  } else if (positional[2]) {
    throw new Error(`Unknown doctor output mode: ${positional[2]}`);
  }

  if (!companyId) {
    throw new Error("--company is required");
  }

  return { companyId, runtimeUrl, output };
}

async function fetchDoctorReport(url: URL): Promise<TinyOfficeDoctorReport> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Doctor API request failed: ${response.status} ${response.statusText}`);
  }
  return await response.json() as TinyOfficeDoctorReport;
}

export async function runDoctorCli(args: string[], options: RunDoctorCliOptions = {}): Promise<string> {
  const parsed = parseDoctorCliArgs(args);
  const url = new URL(`/api/companies/${encodeURIComponent(parsed.companyId)}/doctor`, parsed.runtimeUrl);
  const report = await (options.fetchReport || fetchDoctorReport)(url);
  if (parsed.output === "summary") {
    return renderTinyOfficeDoctorReport(report);
  }
  return JSON.stringify(report, null, 2);
}
