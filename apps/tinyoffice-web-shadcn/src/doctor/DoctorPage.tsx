import { getDoctorReport } from "@/api/doctorClient";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Stethoscope, XCircle } from "lucide-react";
import type { ReactElement } from "react";
import type {
  TinyOfficeCurrentSession,
  TinyOfficeDoctorCheck,
  TinyOfficeDoctorReport,
  TinyOfficeDoctorSection,
  TinyOfficeDoctorStatus,
} from "tinyoffice/frontend-api-contracts";

export function DoctorPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId;
  const doctorQuery = useQuery({
    queryKey: chatQueryKeys.doctorReport(companyId),
    queryFn: () => getDoctorReport({ companyId }),
    enabled: Boolean(companyId),
  });

  return (
    <main className="grid h-svh w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <header className="tiny-room-header flex items-center justify-between gap-3 border-b">
        <div className="min-w-0">
          <div className="tiny-room-title truncate">Doctor</div>
          <div className="tiny-room-subtitle truncate">
            {companyId ? "Read-only diagnostics for the current company" : "Read-only diagnostics"}
          </div>
        </div>
      </header>

      {!companyId ? (
        <StateBlock>Select a company before running diagnostics.</StateBlock>
      ) : doctorQuery.isLoading ? (
        <StateBlock>Loading diagnostics...</StateBlock>
      ) : doctorQuery.isError ? (
        <StateBlock>{doctorQuery.error instanceof Error ? doctorQuery.error.message : "Diagnostics could not load."}</StateBlock>
      ) : doctorQuery.data ? (
        <DoctorReport report={doctorQuery.data} />
      ) : (
        <StateBlock>No diagnostics are available.</StateBlock>
      )}
    </main>
  );
}

function DoctorReport({ report }: { report: TinyOfficeDoctorReport }): ReactElement {
  return (
    <section className="grid min-h-0 grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
      <aside className="border-r bg-muted/20 p-4">
        <div className="flex items-center gap-2">
          <StatusIcon status={report.overallStatus} />
          <div className="min-w-0">
            <div className="text-sm font-semibold">Overall status</div>
            <div className="text-sm text-muted-foreground">{statusLabel(report.overallStatus)}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <CountPill label="Fail" value={report.counts.fail} status="fail" />
          <CountPill label="Warn" value={report.counts.warn} status="warn" />
          <CountPill label="Ok" value={report.counts.ok} status="ok" />
          <CountPill label="Info" value={report.counts.info} status="info" />
        </div>

        {report.nextSteps.length ? (
          <>
            <Separator className="my-4" />
            <div className="grid gap-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Next steps</div>
              {report.nextSteps.map((step) => (
                <Button key={`${step.checkId}-${step.label}`} asChild size="sm" variant="outline" className="justify-start">
                  <a href={step.href || "#"}>{step.label}</a>
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </aside>

      <ScrollArea className="min-h-0">
        <div className="grid gap-4 p-5">
          {report.sections.map((section) => (
            <DoctorSectionView key={section.id} section={section} />
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}

function DoctorSectionView({ section }: { section: TinyOfficeDoctorSection }): ReactElement {
  return (
    <section className="rounded-md border bg-background">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon status={section.status} />
          <h2 className="truncate text-base font-semibold leading-tight">{section.label}</h2>
        </div>
        <StatusBadge status={section.status} />
      </div>
      <Separator />
      <div className="grid gap-0">
        {section.checks.map((check, index) => (
          <CheckRow key={check.id} check={check} first={index === 0} />
        ))}
      </div>
    </section>
  );
}

function CheckRow({ check, first }: { check: TinyOfficeDoctorCheck; first: boolean }): ReactElement {
  return (
    <div className={`grid gap-2 px-4 py-3 ${first ? "" : "border-t"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon status={check.status} />
            <div className="truncate text-sm font-medium">{check.label}</div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{check.summary}</p>
        </div>
        {check.action?.href ? (
          <Button asChild size="sm" variant="outline">
            <a href={check.action.href}>{check.action.label}</a>
          </Button>
        ) : null}
      </div>
      {check.details?.length ? (
        <ul className="grid gap-1 pl-6 text-sm text-muted-foreground">
          {check.details.map((detail) => (
            <li key={detail} className="list-disc">{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CountPill({ label, value, status }: { label: string; value: number; status: TinyOfficeDoctorStatus }): ReactElement {
  return (
    <div className={`rounded-md border bg-background px-3 py-2 ${statusBorderClass(status)}`}>
      <div className="flex items-center gap-1.5">
        <span className={`size-1.5 rounded-full ${statusDotClass(status)}`} aria-hidden="true" />
        <span className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold leading-none">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: TinyOfficeDoctorStatus }): ReactElement {
  return (
    <Badge className={statusBadgeClass(status)} variant="outline">
      {statusLabel(status)}
    </Badge>
  );
}

function StatusIcon({ status }: { status: TinyOfficeDoctorStatus }): ReactElement {
  const className = `size-4 ${statusColorClass(status)}`;
  if (status === "fail") {
    return <XCircle className={className} aria-hidden="true" />;
  }
  if (status === "warn") {
    return <AlertTriangle className={className} aria-hidden="true" />;
  }
  if (status === "ok") {
    return <CheckCircle2 className={className} aria-hidden="true" />;
  }
  return <Info className={className} aria-hidden="true" />;
}

function StateBlock({ children }: { children: string }): ReactElement {
  return (
    <div className="m-5 rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      <Stethoscope className="mx-auto mb-2 size-5" aria-hidden="true" />
      {children}
    </div>
  );
}

function statusLabel(status: TinyOfficeDoctorStatus): string {
  switch (status) {
    case "fail":
      return "Failed";
    case "warn":
      return "Needs attention";
    case "ok":
      return "OK";
    case "info":
      return "Info";
  }
}

function statusColorClass(status: TinyOfficeDoctorStatus): string {
  switch (status) {
    case "fail":
      return "text-[var(--tiny-danger-ink)]";
    case "warn":
      return "text-[var(--tiny-warning-ink)]";
    case "ok":
      return "text-[var(--tiny-success-ink)]";
    case "info":
      return "text-muted-foreground";
  }
}

function statusBadgeClass(status: TinyOfficeDoctorStatus): string {
  switch (status) {
    case "fail":
      return "tiny-semantic-danger";
    case "warn":
      return "tiny-semantic-warning";
    case "ok":
      return "tiny-semantic-success";
    case "info":
      return "border-muted bg-muted/40 text-muted-foreground";
  }
}

function statusBorderClass(status: TinyOfficeDoctorStatus): string {
  switch (status) {
    case "fail":
      return "border-[var(--tiny-danger-strong)]";
    case "warn":
      return "border-[var(--tiny-warning-strong)]";
    case "ok":
      return "border-[var(--tiny-success-strong)]";
    case "info":
      return "";
  }
}

function statusDotClass(status: TinyOfficeDoctorStatus): string {
  switch (status) {
    case "fail":
      return "bg-[var(--tiny-danger-strong)]";
    case "warn":
      return "bg-[var(--tiny-warning-strong)]";
    case "ok":
      return "bg-[var(--tiny-success-strong)]";
    case "info":
      return "bg-muted-foreground";
  }
}
