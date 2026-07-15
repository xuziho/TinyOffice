import { useEffect, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { getMyProfile, saveMyProfile } from "@/api/profileClient";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { SelectionList, SelectionRow } from "@/components/product/SelectionList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AvatarSeedEditor } from "@/components/product/AvatarSeedEditor";
import { authClient } from "@/auth/authClient";

type SettingsSection = "profile" | "security";

export function SettingsPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SettingsSection>("profile");
  const query = useQuery({ queryKey: ["my-profile"], queryFn: getMyProfile });
  const [displayName, setDisplayName] = useState("");
  const [avatarSeed, setAvatarSeed] = useState("");
  useEffect(() => {
    if (query.data) {
      setDisplayName(query.data.displayName);
      setAvatarSeed(query.data.avatarSeed);
    }
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => saveMyProfile({ displayName, avatarSeed }),
    onSuccess: async (profile) => {
      queryClient.setQueryData(["my-profile"], profile);
      setDisplayName(profile.displayName);
      setAvatarSeed(profile.avatarSeed);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.currentSession() });
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.all() });
    },
  });

  return <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
    <header className="tiny-room-header border-b"><div className="tiny-room-title">Settings</div><div className="tiny-room-subtitle">Your identity and account security</div></header>
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1">
      <aside className="border-b bg-[var(--tiny-sidebar)] p-3 md:border-b-0 md:border-r"><SelectionList className="grid-cols-2 md:grid-cols-1"><SelectionRow selected={section === "profile"} onClick={() => setSection("profile")}>My Profile</SelectionRow><SelectionRow selected={section === "security"} onClick={() => setSection("security")}>Security</SelectionRow></SelectionList></aside>
      <div className="overflow-auto p-4 sm:p-6">{section === "profile" ? <ProfilePanel currentSession={currentSession} displayName={displayName} setDisplayName={setDisplayName} avatarSeed={avatarSeed} setAvatarSeed={setAvatarSeed} savePending={save.isPending} saveError={save.error} canSave={Boolean(query.data) && (displayName.trim() !== query.data?.displayName || avatarSeed !== query.data?.avatarSeed)} onSave={() => save.mutate()} /> : <SecurityPanel />}</div>
    </section>
  </main>;
}

function SecurityPanel(): ReactElement {
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [passkeys, setPasskeys] = useState<OwnerPasskey[]>([]);
  const [loadingSecurity, setLoadingSecurity] = useState(true);
  const [revoking, setRevoking] = useState(false);

  async function loadSecurityState(): Promise<void> {
    setLoadingSecurity(true);
    const [sessionResponse, passkeyResponse] = await Promise.all([
      fetch("/api/auth/list-sessions", { credentials: "include" }),
      fetch("/api/auth/passkey/list-user-passkeys", { credentials: "include" }),
    ]);
    if (!sessionResponse.ok || !passkeyResponse.ok) throw new Error("Owner security state could not be loaded.");
    setSessions(await sessionResponse.json() as AuthSession[]);
    setPasskeys(await passkeyResponse.json() as OwnerPasskey[]);
    setLoadingSecurity(false);
  }

  useEffect(() => {
    void loadSecurityState().catch((cause) => {
      setLoadingSecurity(false);
      setMessage(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  async function addPasskey(): Promise<void> {
    setAdding(true);
    setMessage("");
    const result = await authClient.passkey.addPasskey({ name: "Backup Owner passkey" });
    setAdding(false);
    if (result?.error) {
      setMessage(result.error.message || "Passkey could not be added.");
      return;
    }
    setMessage("Backup passkey added.");
    await loadSecurityState();
  }

  async function revokeOtherSessions(): Promise<void> {
    setRevoking(true);
    setMessage("");
    const response = await fetch("/api/auth/revoke-other-sessions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    setRevoking(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined) as { message?: string } | undefined;
      setMessage(payload?.message || "Other sessions could not be signed out.");
      return;
    }
    setMessage("Other Owner sessions signed out.");
    await loadSecurityState();
  }

  async function signOut(): Promise<void> {
    await authClient.signOut();
    window.location.assign("/");
  }

  return <section className="tiny-settings-primary-surface grid max-w-3xl gap-5 rounded-md border p-5">
    <div><h2 className="font-semibold">Owner security</h2><p className="mt-1 text-sm text-muted-foreground">TinyOffice keeps one Owner identity. Local launcher access and remote Passkeys both create the same protected server session.</p></div>
    <div className="tiny-settings-fact grid gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5" /><div><div className="font-medium">Passkeys</div><div className="mt-1 text-sm text-muted-foreground">Required for remote access. Keep a backup credential on another device or hardware key.</div></div></div><Button variant="outline" disabled={adding} onClick={() => void addPasskey()}><KeyRound />{adding ? "Adding…" : "Add passkey"}</Button></div>
      <div className="grid gap-2 border-t pt-3 text-sm">{loadingSecurity ? <span className="text-muted-foreground">Loading credentials…</span> : passkeys.length ? passkeys.map((passkey) => <div key={passkey.id} className="flex items-center justify-between gap-3"><span className="font-medium">{passkey.name || "Owner passkey"}</span><span className="text-xs text-muted-foreground">Added {formatSecurityDate(passkey.createdAt)}</span></div>) : <span className="text-muted-foreground">No Passkey registered. Local access remains available; configure one before remote deployment.</span>}</div>
    </div>
    <div className="tiny-settings-fact grid gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><MonitorSmartphone className="mt-0.5 size-5" /><div><div className="font-medium">Owner sessions</div><div className="mt-1 text-sm text-muted-foreground">Sessions expire after 30 days of inactivity and refresh while TinyOffice is in use.</div></div></div><Button variant="outline" disabled={revoking || sessions.length < 2} onClick={() => void revokeOtherSessions()}>{revoking ? "Signing out…" : "Sign out other sessions"}</Button></div>
      <div className="grid gap-2 border-t pt-3 text-sm">{loadingSecurity ? <span className="text-muted-foreground">Loading sessions…</span> : sessions.map((session, index) => <div key={session.id} className="flex items-start justify-between gap-3"><div><div className="font-medium">{index === 0 ? "Current or recent session" : "Other session"}</div><div className="mt-0.5 max-w-lg truncate text-xs text-muted-foreground">{session.userAgent || "Unknown device"}</div></div><span className="shrink-0 text-xs text-muted-foreground">Expires {formatSecurityDate(session.expiresAt)}</span></div>)}</div>
    </div>
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => void signOut()}><LogOut />Sign out this browser</Button>{message ? <span role="status" className="text-sm text-muted-foreground">{message}</span> : null}</div>
  </section>;
}

type AuthSession = { id: string; userAgent?: string | null; expiresAt: string | Date };
type OwnerPasskey = { id: string; name?: string | null; createdAt: string | Date };

function formatSecurityDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleDateString();
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
    <div className="tiny-settings-comparison grid sm:grid-cols-2"><ProfileValue label="Account type" value="Owner" /><ProfileValue label="Company role" value={currentSession?.member?.role ?? "Not assigned"} /></div>
    <div className="flex items-center gap-3"><Button disabled={!canSave || savePending} onClick={onSave}>Save profile</Button>{saveError ? <span className="text-sm text-[var(--tiny-danger-ink)]">{saveError.message}</span> : null}</div>
  </section>;
}

function ProfileValue({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="tiny-settings-fact p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium">{value}</div></div>;
}
