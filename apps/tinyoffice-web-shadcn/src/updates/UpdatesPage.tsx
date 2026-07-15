import { getUpdateStatus, installApprovedUpdate } from "@/api/updateClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import type { TinyOfficeUpdateStatus } from "tinyoffice/frontend-api-contracts";
import { SectionContentHeader } from "@/app/SectionContentHeader";

export function UpdatesPage(): ReactElement {
  const queryClient = useQueryClient();
  const updates = useQuery({ queryKey: ["tinyoffice", "updates"], queryFn: getUpdateStatus, staleTime: 60_000 });
  const install = useMutation({
    mutationFn: installApprovedUpdate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tinyoffice", "updates"] });
    },
  });

  return (
    <main className="grid h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <SectionContentHeader description="Approved product maintenance and runtime compatibility" />
      <div className="overflow-auto p-4 sm:p-6">
        <UpdatesPanel
          query={updates}
          installing={install.isPending}
          installError={install.error}
          onCheck={() => void updates.refetch()}
          onInstall={() => install.mutate()}
        />
      </div>
    </main>
  );
}

function UpdatesPanel({ query, installing, installError, onCheck, onInstall }: {
  query: UseQueryResult<TinyOfficeUpdateStatus, Error>;
  installing: boolean;
  installError: Error | null;
  onCheck(): void;
  onInstall(): void;
}): ReactElement {
  const status = query.data;
  return <section className="tiny-settings-updates grid max-w-4xl gap-5">
    <div className="tiny-settings-status-band flex flex-wrap items-start justify-between gap-4 rounded-md border p-5"><div><div className="flex items-center gap-2"><h2 className="font-semibold">Product updates</h2>{status ? <UpdateStateBadge state={status.pi.state} /> : null}</div><p className="mt-1 max-w-2xl text-sm text-muted-foreground">TinyOffice checks the PI registry for upstream releases and installs only versions approved by the TinyOffice stable manifest.</p></div><Button variant="outline" disabled={query.isFetching} onClick={onCheck}><RefreshCw className={query.isFetching ? "animate-spin" : ""} />Check for updates</Button></div>
    {query.isLoading ? <div className="tiny-settings-quiet-state rounded-md p-8 text-center text-sm text-muted-foreground">Checking update sources...</div> : query.error ? <div className="tiny-settings-danger-surface rounded-md p-4 text-sm">{query.error.message}</div> : status ? <>
      <div className="tiny-settings-comparison grid sm:grid-cols-2 lg:grid-cols-4"><UpdateValue label="TinyOffice" value={status.tinyOfficeVersion} /><UpdateValue label="Installed PI" value={status.pi.installedVersion} /><UpdateValue label="Latest upstream" value={status.pi.npmLatestVersion ?? "Unavailable"} /><UpdateValue label="Approved PI" value={status.pi.approvedVersion} /></div>
      <div className="tiny-settings-readiness grid overflow-hidden rounded-md border">
        <div className={`flex items-start gap-3 p-5 ${status.runtime.compatible ? "is-success" : "is-warning"}`}>{status.runtime.compatible ? <Check className="mt-0.5 size-5" /> : <AlertTriangle className="mt-0.5 size-5" />}<div><h3 className="font-medium">Runtime compatibility</h3><p className="mt-1 text-sm text-muted-foreground">Node {status.runtime.nodeVersion} installed · Node {status.runtime.minimumNodeVersion} or newer required</p></div></div>
        <div className="tiny-settings-policy border-t p-5"><h3 className="font-medium">Installation policy</h3><p className="mt-1 text-sm text-muted-foreground">{status.installation.reason}</p><p className="mt-2 text-xs text-muted-foreground">Installation always requires a verified backup, runtime verification, and restart.</p><div className="mt-4 flex items-center gap-3"><Button disabled={!status.installation.enabled || installing} onClick={onInstall}><Download />{installing ? "Starting update..." : "Back up and install"}</Button>{installError ? <span className="text-sm text-[var(--tiny-danger-ink)]">{installError.message}</span> : null}</div></div>
      </div>
      <ModelChanges title="Approved model catalog changes" added={status.pi.addedModels} removed={status.pi.removedModels} />
      {status.sources.warnings.length ? <div className="tiny-settings-warning-surface rounded-md border p-4 text-sm"><div className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />Some update sources could not be refreshed</div><ul className="mt-2 list-disc space-y-1 pl-5">{status.sources.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
      <div className="text-xs text-muted-foreground">Approval source: {status.sources.approvalManifestSource === "remote" ? "TinyOffice stable channel" : "bundled fallback manifest"}</div>
    </> : null}
  </section>;
}

function UpdateValue({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="tiny-settings-fact p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium">{value}</div></div>;
}

function UpdateStateBadge({ state }: { state: TinyOfficeUpdateStatus["pi"]["state"] }): ReactElement {
  const labels = { up_to_date: "Up to date", upstream_available: "Awaiting approval", ready_to_install: "Ready to install", blocked: "Blocked", check_failed: "Check failed" } as const;
  const tone = state === "up_to_date" ? "is-success" : state === "blocked" || state === "check_failed" ? "is-danger" : "is-warning";
  return <Badge className={`tiny-settings-state ${tone}`} variant="outline">{labels[state]}</Badge>;
}

function ModelChanges({ title, added, removed }: { title: string; added: string[]; removed: string[] }): ReactElement {
  return <div className="tiny-settings-model-changes rounded-md p-5"><h3 className="font-medium">{title}</h3>{!added.length && !removed.length ? <p className="mt-2 text-sm text-muted-foreground">No model changes in the approved catalog.</p> : <div className="mt-3 grid gap-4 sm:grid-cols-2"><div><div className="text-xs font-medium uppercase text-muted-foreground">Added</div><div className="mt-2 flex flex-wrap gap-2">{added.length ? added.map((model) => <Badge key={model} variant="secondary">{model}</Badge>) : <span className="text-sm text-muted-foreground">None</span>}</div></div><div><div className="text-xs font-medium uppercase text-muted-foreground">Removed</div><div className="mt-2 flex flex-wrap gap-2">{removed.length ? removed.map((model) => <Badge key={model} variant="outline">{model}</Badge>) : <span className="text-sm text-muted-foreground">None</span>}</div></div></div>}</div>;
}
