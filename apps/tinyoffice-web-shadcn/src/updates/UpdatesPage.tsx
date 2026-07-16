import { getUpdateStatus, installApprovedUpdate } from "@/api/updateClient";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { ProductState } from "@/components/product/ProductState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { TinyOfficeUpdateJob, TinyOfficeUpdateStatus } from "tinyoffice/frontend-api-contracts";

const runningJobStates = new Set<TinyOfficeUpdateJob["status"]>(["accepted", "downloading", "verifying", "installing"]);

export function UpdatesPage(): ReactElement {
  const queryClient = useQueryClient();
  const updates = useQuery({
    queryKey: chatQueryKeys.updates(),
    queryFn: getUpdateStatus,
    staleTime: 60_000,
    retry: 3,
    refetchInterval: (query) => {
      const job = query.state.data?.job;
      return job && runningJobStates.has(job.status) ? 2_000 : false;
    },
  });
  const install = useMutation({
    mutationFn: installApprovedUpdate,
    onSuccess: async (job) => {
      queryClient.setQueryData<TinyOfficeUpdateStatus>(chatQueryKeys.updates(), (current) => current ? { ...current, job } : current);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.updates() });
    },
  });

  return <main className="h-full overflow-hidden bg-background"><div className="h-full overflow-auto p-4 sm:p-6"><UpdatesPanel query={updates} installing={install.isPending} installError={install.error} onCheck={() => void updates.refetch()} onInstall={() => install.mutate()} /></div></main>;
}

function UpdatesPanel({ query, installing, installError, onCheck, onInstall }: { query: UseQueryResult<TinyOfficeUpdateStatus, Error>; installing: boolean; installError: Error | null; onCheck(): void; onInstall(): void }): ReactElement {
  const { t } = useTranslation();
  const status = query.data;
  return <section className="tiny-settings-updates grid max-w-4xl gap-5">
    <div className="tiny-settings-status-band flex flex-wrap items-start justify-between gap-4 rounded-md border p-5"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{t("updatesPage.title")}</h2>{status ? <ReleaseStateBadge state={status.release.state} /> : null}</div><p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("updatesPage.description")}</p></div><Button variant="outline" disabled={query.isFetching} onClick={onCheck}><RefreshCw className={query.isFetching ? "animate-spin" : ""} />{t("updatesPage.check")}</Button></div>
    {query.isLoading ? <ProductState description={t("updatesPage.checking")} /> : query.error && !status ? <ProductState tone="error" description={query.error.message} /> : status ? <>
      <div className="tiny-settings-comparison grid sm:grid-cols-2 lg:grid-cols-4"><UpdateValue label={t("updatesPage.installedTinyOffice")} value={status.release.installed.tinyOfficeVersion} detail={status.release.installed.releaseId} /><UpdateValue label={t("updatesPage.approvedTinyOffice")} value={status.release.approved?.tinyOfficeVersion ?? t("updatesPage.unavailable")} detail={status.release.approved?.releaseId} /><UpdateValue label={t("updatesPage.installedPi")} value={status.pi.installedVersion} /><UpdateValue label={t("updatesPage.approvedPi")} value={status.pi.approvedVersion} /></div>
      {status.release.approved?.notes.length ? <div className="rounded-md border p-4"><h3 className="font-medium">{t("updatesPage.releaseNotes")}</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{status.release.approved.notes.map((note) => <li key={note}>{note}</li>)}</ul></div> : null}
      {status.job ? <UpdateJob job={status.job} /> : null}
      <div className="tiny-settings-readiness grid overflow-hidden rounded-md border">
        <div className={`flex items-start gap-3 p-5 ${status.runtime.compatible ? "is-success" : "is-warning"}`}>{status.runtime.compatible ? <Check className="mt-0.5 size-5" /> : <AlertTriangle className="mt-0.5 size-5" />}<div><h3 className="font-medium">{t("updatesPage.runtimeCompatibility")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("updatesPage.nodeRequirement", { installed: status.runtime.nodeVersion, minimum: status.runtime.minimumNodeVersion })}</p></div></div>
        <div className="tiny-settings-policy border-t p-5"><h3 className="font-medium">{t("updatesPage.installationPolicy")}</h3><p className="mt-1 text-sm text-muted-foreground">{status.installation.reason}</p><p className="mt-2 text-xs text-muted-foreground">{t("updatesPage.installationRequirement")}</p><div className="mt-4 flex items-center gap-3"><Button disabled={!status.installation.enabled || installing || Boolean(status.job && runningJobStates.has(status.job.status))} onClick={onInstall}><Download />{installing ? t("updatesPage.starting") : t("updatesPage.backupInstall")}</Button>{installError ? <span className="text-sm text-[var(--tiny-danger-ink)]">{installError.message}</span> : null}</div></div>
      </div>
      <ModelChanges added={status.pi.addedModels} removed={status.pi.removedModels} />
      {status.sources.warnings.length ? <div className="tiny-settings-warning-surface rounded-md border p-4 text-sm"><div className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />{t("updatesPage.sourceWarnings")}</div><ul className="mt-2 list-disc space-y-1 pl-5">{status.sources.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
    </> : null}
  </section>;
}

function UpdateValue({ label, value, detail }: { label: string; value: string; detail?: string }): ReactElement {
  return <div className="tiny-settings-fact p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium">{value}</div>{detail ? <div className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</div> : null}</div>;
}

function ReleaseStateBadge({ state }: { state: TinyOfficeUpdateStatus["release"]["state"] }): ReactElement {
  const { t } = useTranslation();
  const labels = { development: t("updatesPage.development"), up_to_date: t("updatesPage.upToDate"), ready_to_install: t("updatesPage.readyToInstall"), blocked: t("updatesPage.blocked"), check_failed: t("updatesPage.checkFailed") } as const;
  const tone = state === "up_to_date" ? "is-success" : state === "blocked" || state === "check_failed" ? "is-danger" : "is-warning";
  return <Badge className={`tiny-settings-state ${tone}`} variant="outline">{labels[state]}</Badge>;
}

function UpdateJob({ job }: { job: TinyOfficeUpdateJob }): ReactElement {
  const { t } = useTranslation();
  return <div className="rounded-md border p-4"><div className="flex items-center justify-between gap-3"><div><div className="font-medium">{t("updatesPage.updateProgress")}</div><div className="mt-1 text-sm text-muted-foreground">{job.targetReleaseId}</div></div><Badge variant={job.status === "failed" ? "destructive" : "secondary"}>{t(`updatesPage.job.${job.status}`)}</Badge></div>{job.error ? <p className="mt-3 text-sm text-destructive">{job.error}</p> : null}{job.evidence?.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{job.evidence.slice(-4).map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : null}</div>;
}

function ModelChanges({ added, removed }: { added: string[]; removed: string[] }): ReactElement {
  const { t } = useTranslation();
  return <div className="tiny-settings-model-changes rounded-md p-5"><h3 className="font-medium">{t("updatesPage.modelChanges")}</h3>{!added.length && !removed.length ? <p className="mt-2 text-sm text-muted-foreground">{t("updatesPage.noModelChanges")}</p> : <div className="mt-3 grid gap-4 sm:grid-cols-2"><div><div className="text-xs font-medium uppercase text-muted-foreground">{t("updatesPage.added")}</div><div className="mt-2 flex flex-wrap gap-2">{added.length ? added.map((model) => <Badge key={model} variant="secondary">{model}</Badge>) : <span className="text-sm text-muted-foreground">{t("common.none")}</span>}</div></div><div><div className="text-xs font-medium uppercase text-muted-foreground">{t("updatesPage.removed")}</div><div className="mt-2 flex flex-wrap gap-2">{removed.length ? removed.map((model) => <Badge key={model} variant="outline">{model}</Badge>) : <span className="text-sm text-muted-foreground">{t("common.none")}</span>}</div></div></div>}</div>;
}
