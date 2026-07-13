export type TinyOfficeDoctorStatus = "ok" | "warn" | "fail" | "info";

export type TinyOfficeDoctorAction = {
  label: string;
  href?: string;
};

export type TinyOfficeDoctorCheck = {
  id: string;
  label: string;
  status: TinyOfficeDoctorStatus;
  summary: string;
  details?: string[];
  action?: TinyOfficeDoctorAction;
};

export type TinyOfficeDoctorSectionInput = {
  id: string;
  label: string;
  checks: TinyOfficeDoctorCheck[];
};

export type TinyOfficeDoctorSection = TinyOfficeDoctorSectionInput & {
  status: TinyOfficeDoctorStatus;
};

export type TinyOfficeDoctorNextStep = TinyOfficeDoctorAction & {
  checkId: string;
};

export type TinyOfficeDoctorReport = {
  schema: "tinyoffice-doctor-report";
  version: 1;
  companyId: string;
  generatedAt: string;
  overallStatus: TinyOfficeDoctorStatus;
  counts: Record<TinyOfficeDoctorStatus, number>;
  sections: TinyOfficeDoctorSection[];
  nextSteps: TinyOfficeDoctorNextStep[];
};

export type BuildTinyOfficeDoctorReportInput = {
  companyId: string;
  generatedAt?: string;
  sections: TinyOfficeDoctorSectionInput[];
};

const statusRank: Record<TinyOfficeDoctorStatus, number> = {
  fail: 4,
  warn: 3,
  ok: 2,
  info: 1,
};

function worstStatus(statuses: TinyOfficeDoctorStatus[]): TinyOfficeDoctorStatus {
  if (statuses.length === 0) {
    return "info";
  }
  return statuses.reduce((current, candidate) =>
    statusRank[candidate] > statusRank[current] ? candidate : current
  );
}

export function buildTinyOfficeDoctorReport(input: BuildTinyOfficeDoctorReportInput): TinyOfficeDoctorReport {
  const sections = input.sections.map((section) => ({
    ...section,
    status: worstStatus(section.checks.map((check) => check.status)),
  }));
  const checks = sections.flatMap((section) => section.checks);
  const counts: Record<TinyOfficeDoctorStatus, number> = {
    fail: 0,
    warn: 0,
    ok: 0,
    info: 0,
  };
  for (const check of checks) {
    counts[check.status] += 1;
  }

  return {
    schema: "tinyoffice-doctor-report",
    version: 1,
    companyId: input.companyId,
    generatedAt: input.generatedAt || new Date().toISOString(),
    overallStatus: worstStatus(sections.map((section) => section.status)),
    counts,
    sections,
    nextSteps: checks.flatMap((check) =>
      check.action ? [{ checkId: check.id, ...check.action }] : []
    ),
  };
}

export function renderTinyOfficeDoctorReport(report: TinyOfficeDoctorReport): string {
  const lines = [
    `TinyOffice doctor: fail=${report.counts.fail} warn=${report.counts.warn} ok=${report.counts.ok} info=${report.counts.info}`,
    `Company: ${report.companyId}`,
    "",
  ];
  for (const section of report.sections) {
    lines.push(`${section.label} [${section.status}]`);
    for (const check of section.checks) {
      lines.push(`  [${check.status}] ${check.label} - ${check.summary}`);
      for (const detail of check.details || []) {
        lines.push(`    ${detail}`);
      }
    }
  }
  return lines.join("\n");
}
