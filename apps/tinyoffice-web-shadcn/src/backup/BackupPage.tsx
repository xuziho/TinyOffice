import { backupDownloadHref, createBackup, listBackups } from "@/api/backupClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductState } from "@/components/product/ProductState";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, LoaderCircle, ShieldCheck } from "lucide-react";
import type { ReactElement } from "react";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { useTranslation } from "react-i18next";
import { currentUiLocale } from "@/i18n";

export function BackupPage(): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: chatQueryKeys.backups(), queryFn: listBackups, refetchInterval: (state) => state.state.data?.jobs.some((job) => job.status === "creating") ? 1500 : false });
  const mutation = useMutation({ mutationFn: createBackup, onSuccess: () => queryClient.invalidateQueries({ queryKey: chatQueryKeys.backups() }) });
  const creating = mutation.isPending || query.data?.jobs.some((job) => job.status === "creating");
  return <main className="h-full overflow-hidden bg-background">
    <ScrollArea className="h-full"><div className="grid gap-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{t("admin.backups")}</h2><Button disabled={creating} onClick={() => mutation.mutate()}>{creating ? <LoaderCircle className="animate-spin" /> : <Archive />}{t("admin.createBackup")}</Button></div>
      <section className="border-y bg-[var(--tiny-quiet)] py-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 text-[var(--tiny-success-ink)]"/><div><h2 className="font-semibold">{t("admin.backupContains")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("admin.backupContainsDescription")}</p><p className="mt-2 text-sm text-muted-foreground">{t("admin.backupSecurity")}</p></div></div></section>
      {mutation.isError ? <div className="tiny-settings-danger-surface rounded-md p-3 text-sm">{mutation.error instanceof Error ? mutation.error.message : t("admin.backupStartFailed")}</div> : null}
      {query.data?.jobs.filter((job) => job.status === "failed").slice(0, 1).map((job) => <div key={job.jobId} className="tiny-settings-danger-surface rounded-md p-3 text-sm">{t("admin.latestBackupFailed", { error: job.error })}</div>)}
      <section className="tiny-raised-data-surface rounded-md border bg-[var(--tiny-surface)]"><div className="border-b bg-[var(--tiny-quiet)] px-4 py-3"><h2 className="font-semibold">{t("admin.localBackups")}</h2><p className="text-sm text-muted-foreground">{t("admin.localBackupsDescription")}</p></div>
        {query.isLoading ? <ProductState compact description={t("admin.loadingBackups")} /> : query.isError ? <ProductState compact tone="error" description={query.error instanceof Error ? query.error.message : t("admin.backupLoadFailed")} /> : !query.data?.backups.length ? <ProductState compact description={t("admin.noBackups")} /> : <div className="divide-y">{query.data.backups.map((backup) => <div key={backup.backupId} className="flex items-center justify-between gap-4 px-4 py-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{backup.fileName}</div><div className="text-xs text-muted-foreground">{new Date(backup.createdAt).toLocaleString(currentUiLocale())} · {formatBytes(backup.byteLength)}</div></div><div className="flex items-center gap-2"><Badge variant="outline">{t("admin.verified")}</Badge><Button asChild size="sm" variant="outline"><a href={backupDownloadHref(backup.backupId)}><Download />{t("admin.download")}</a></Button></div></div>)}</div>}
      </section>
    </div></ScrollArea>
  </main>;
}

function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(1)} GB`; }
