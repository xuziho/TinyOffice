import { useEffect, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { TinyOfficeCurrentSession, TinyOfficeUpdateStatus } from "tinyoffice/frontend-api-contracts";
import { AlertTriangle, Check, Download, KeyRound, LogOut, RefreshCw } from "lucide-react";
import { getMyProfile, saveMyProfile } from "@/api/profileClient";
import { getUpdateStatus, installApprovedUpdate } from "@/api/updateClient";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { SelectionList, SelectionRow } from "@/components/product/SelectionList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvatarSeedEditor } from "@/components/product/AvatarSeedEditor";
import { authClient } from "@/auth/authClient";

type SettingsSection = "profile" | "security" | "updates";

export function SettingsPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SettingsSection>("profile");
  const query = useQuery({ queryKey: ["my-profile"], queryFn: getMyProfile });
  const updates = useQuery({ queryKey: ["tinyoffice", "updates"], queryFn: getUpdateStatus, enabled: section === "updates", staleTime: 60_000 });
  const [displayName, setDisplayName] = useState("");
  const [avatarSeed, setAvatarSeed] = useState("");
  useEffect(() => { if (query.data) { setDisplayName(query.data.displayName); setAvatarSeed(query.data.avatarSeed); } }, [query.data]);
  const save = useMutation({ mutationFn: () => saveMyProfile({ displayName, avatarSeed }), onSuccess: async (profile) => { queryClient.setQueryData(["my-profile"], profile); setDisplayName(profile.displayName); setAvatarSeed(profile.avatarSeed); await queryClient.invalidateQueries({ queryKey: chatQueryKeys.currentSession() }); await queryClient.invalidateQueries({ queryKey: chatQueryKeys.all() }); } });
  const install = useMutation({ mutationFn: installApprovedUpdate, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["tinyoffice", "updates"] }); } });

  return <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
    <header className="tiny-room-header border-b"><div className="tiny-room-title">Settings</div><div className="tiny-room-subtitle">Your profile, runtime, and product updates</div></header>
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1">
      <aside className="border-b bg-[var(--tiny-sidebar)] p-3 md:border-b-0 md:border-r"><SelectionList className="grid-cols-3 md:grid-cols-1"><SelectionRow selected={section === "profile"} onClick={() => setSection("profile")}>My Profile</SelectionRow><SelectionRow selected={section === "security"} onClick={() => setSection("security")}>Security</SelectionRow><SelectionRow selected={section === "updates"} onClick={() => setSection("updates")}>Updates</SelectionRow></SelectionList></aside>
      <div className="overflow-auto p-4 sm:p-6">{section === "profile" ? <ProfilePanel currentSession={currentSession} displayName={displayName} setDisplayName={setDisplayName} avatarSeed={avatarSeed} setAvatarSeed={setAvatarSeed} savePending={save.isPending} saveError={save.error} canSave={Boolean(query.data) && (displayName.trim() !== query.data?.displayName || avatarSeed !== query.data?.avatarSeed)} onSave={() => save.mutate()} /> : section === "security" ? <SecurityPanel /> : <UpdatesPanel query={updates} installing={install.isPending} installError={install.error} onCheck={() => void updates.refetch()} onInstall={() => install.mutate()} />}</div>
    </section>
  </main>;
}

function SecurityPanel(): ReactElement {
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  async function addPasskey(): Promise<void> {
    setAdding(true); setMessage("");
    const result = await authClient.passkey.addPasskey({ name: "Backup Owner passkey" });
    setAdding(false);
    setMessage(result?.error ? result.error.message || "Passkey could not be added." : "Backup passkey added.");
  }
  async function signOut(): Promise<void> {
    await authClient.signOut();
    window.location.assign("/");
  }
  return <section className="tiny-settings-primary-surface grid max-w-3xl gap-5 rounded-md border p-5">
    <div><h2 className="font-semibold">Owner security</h2><p className="mt-1 text-sm text-muted-foreground">Passkeys unlock this one-person office. Add a second passkey on another device or hardware key before you need it.</p></div>
    <div className="tiny-settings-fact flex flex-wrap items-center justify-between gap-4 p-4"><div><div className="font-medium">Backup passkey</div><div className="mt-1 text-sm text-muted-foreground">The operating system will ask where to save the new credential.</div></div><Button variant="outline" disabled={adding} onClick={() => void addPasskey()}><KeyRound />{adding ? "Adding…" : "Add passkey"}</Button></div>
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => void signOut()}><LogOut />Sign out</Button>{message ? <span role="status" className="text-sm text-muted-foreground">{message}</span> : null}</div>
  </section>;
}

function ProfilePanel({ currentSession, displayName, setDisplayName, avatarSeed, setAvatarSeed, savePending, saveError, canSave, onSave }: {
  currentSession?: TinyOfficeCurrentSession;
  displayName: string;
  setDisplayName(value: string): void;
  avatarSeed: string;
  setAvatarSeed(value: string): void;
  savePending: boolean;
  saveError: Error | null;
  canSave: boolean;
  onSave(): void;
}): ReactElement {
  return <section className="tiny-settings-primary-surface grid max-w-3xl gap-5 rounded-md border p-5">
    <div className="flex items-start justify-between"><div><h2 className="font-semibold">My Profile</h2><p className="mt-1 text-sm text-muted-foreground">Your Owner identity is shared across Companies. Company roles remain governed separately.</p></div><Badge variant="secondary">Owner</Badge></div>
    {avatarSeed ? <AvatarSeedEditor memberId={currentSession?.user.id ?? "current-user"} displayName={displayName || "You"} avatarSeed={avatarSeed} disabled={savePending} onChange={setAvatarSeed} /> : null}
    <label className="grid gap-2 text-sm"><span className="font-medium">Display name</span><Input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.currentTarget.value)} /></label>
    <div className="tiny-settings-comparison grid sm:grid-cols-3"><ProfileValue label="Account id" value={currentSession?.user.id ?? "Unavailable"} /><ProfileValue label="Current Company" value={currentSession?.companyId ?? currentSession?.currentCompanyId ?? "None"} /><ProfileValue label="Company role" value={currentSession?.member?.role ?? "Not assigned"} /></div>
    <div className="flex items-center gap-3"><Button disabled={!canSave || savePending} onClick={onSave}>Save profile</Button>{saveError ? <span className="text-sm text-[var(--tiny-danger-ink)]">{saveError.message}</span> : null}</div>
  </section>;
}

function ProfileValue({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="tiny-settings-fact p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium">{value}</div></div>;
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
      <div className="tiny-settings-comparison grid sm:grid-cols-2 lg:grid-cols-4"><ProfileValue label="TinyOffice" value={status.tinyOfficeVersion} /><ProfileValue label="Installed PI" value={status.pi.installedVersion} /><ProfileValue label="Latest upstream" value={status.pi.npmLatestVersion ?? "Unavailable"} /><ProfileValue label="Approved PI" value={status.pi.approvedVersion} /></div>
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

function UpdateStateBadge({ state }: { state: TinyOfficeUpdateStatus["pi"]["state"] }): ReactElement {
  const labels = { up_to_date: "Up to date", upstream_available: "Awaiting approval", ready_to_install: "Ready to install", blocked: "Blocked", check_failed: "Check failed" } as const;
  const tone = state === "up_to_date" ? "is-success" : state === "blocked" || state === "check_failed" ? "is-danger" : "is-warning";
  return <Badge className={`tiny-settings-state ${tone}`} variant="outline">{labels[state]}</Badge>;
}

function ModelChanges({ title, added, removed }: { title: string; added: string[]; removed: string[] }): ReactElement {
  return <div className="tiny-settings-model-changes rounded-md p-5"><h3 className="font-medium">{title}</h3>{!added.length && !removed.length ? <p className="mt-2 text-sm text-muted-foreground">No model changes in the approved catalog.</p> : <div className="mt-3 grid gap-4 sm:grid-cols-2"><div><div className="text-xs font-medium uppercase text-muted-foreground">Added</div><div className="mt-2 flex flex-wrap gap-2">{added.length ? added.map((model) => <Badge key={model} variant="secondary">{model}</Badge>) : <span className="text-sm text-muted-foreground">None</span>}</div></div><div><div className="text-xs font-medium uppercase text-muted-foreground">Removed</div><div className="mt-2 flex flex-wrap gap-2">{removed.length ? removed.map((model) => <Badge key={model} variant="outline">{model}</Badge>) : <span className="text-sm text-muted-foreground">None</span>}</div></div></div>}</div>;
}
