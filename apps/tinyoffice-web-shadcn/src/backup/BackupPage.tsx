import { backupDownloadHref, createBackup, listBackups } from "@/api/backupClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, LoaderCircle, ShieldCheck } from "lucide-react";
import type { ReactElement } from "react";
import { SectionContentHeader } from "@/app/SectionContentHeader";

export function BackupPage(): ReactElement {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["tinyoffice", "backups"], queryFn: listBackups, refetchInterval: (state) => state.state.data?.jobs.some((job) => job.status === "creating") ? 1500 : false });
  const mutation = useMutation({ mutationFn: createBackup, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tinyoffice", "backups"] }) });
  const creating = mutation.isPending || query.data?.jobs.some((job) => job.status === "creating");
  return <main className="grid h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
    <SectionContentHeader description="Create verified full-instance backups. Scheduled automation uses the TinyOffice CLI." actions={<Button disabled={creating} onClick={() => mutation.mutate()}>{creating ? <LoaderCircle className="animate-spin" /> : <Archive />}Create backup</Button>} />
    <ScrollArea className="min-h-0"><div className="grid gap-5 p-5">
      <section className="rounded-md border bg-[var(--tiny-quiet)] p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 text-[var(--tiny-success-ink)]"/><div><h2 className="font-semibold">What this backup contains</h2><p className="mt-1 text-sm text-muted-foreground">PostgreSQL company and runtime data, Company and Employee Skills, employee workspaces, branding, and locally stored Chat attachments. System secrets such as provider API keys and .env are not exported.</p><p className="mt-2 text-sm text-muted-foreground">Backups still contain private company content. Keep them in a trusted or encrypted destination. Restore is CLI-only and requires maintenance mode, explicit confirmation, verification, and an automatic pre-restore safety backup.</p></div></div></section>
      {mutation.isError ? <div className="tiny-settings-danger-surface rounded-md p-3 text-sm">{mutation.error instanceof Error ? mutation.error.message : "Backup could not start."}</div> : null}
      {query.data?.jobs.filter((job) => job.status === "failed").slice(0, 1).map((job) => <div key={job.jobId} className="tiny-settings-danger-surface rounded-md p-3 text-sm">Latest backup failed: {job.error}</div>)}
      <section className="rounded-md border bg-[var(--tiny-surface)] shadow-[2px_2px_0_rgba(36,35,31,.18)]"><div className="border-b bg-[var(--tiny-quiet)] px-4 py-3"><h2 className="font-semibold">Local backups</h2><p className="text-sm text-muted-foreground">Download a copy for external storage. Files remain under .data/backups until your retention automation removes them.</p></div>
        {!query.data?.backups.length ? <div className="p-8 text-center text-sm text-muted-foreground">No verified backups yet.</div> : <div className="divide-y">{query.data.backups.map((backup) => <div key={backup.backupId} className="flex items-center justify-between gap-4 px-4 py-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{backup.fileName}</div><div className="text-xs text-muted-foreground">{new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.byteLength)}</div></div><div className="flex items-center gap-2"><Badge variant="outline">Verified</Badge><Button asChild size="sm" variant="outline"><a href={backupDownloadHref(backup.backupId)}><Download />Download</a></Button></div></div>)}</div>}
      </section>
    </div></ScrollArea>
  </main>;
}

function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(1)} GB`; }
