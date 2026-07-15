import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TinyOfficeCurrentSession, UiLocalePreference } from "tinyoffice/frontend-api-contracts";
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { getMyProfile, saveMyProfile } from "@/api/profileClient";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { ManagementPageHeader } from "@/components/product/ManagementPageHeader";
import { SelectionList, SelectionRow } from "@/components/product/SelectionList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarSeedEditor } from "@/components/product/AvatarSeedEditor";
import { authClient } from "@/auth/authClient";
import { applyUiLocalePreference, currentUiLocale } from "@/i18n";
import { useTranslation } from "react-i18next";

type SettingsSection = "profile" | "security";

export function SettingsPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SettingsSection>("profile");
  const query = useQuery({ queryKey: chatQueryKeys.myProfile(), queryFn: getMyProfile });
  const [displayName, setDisplayName] = useState("");
  const [avatarSeed, setAvatarSeed] = useState("");
  const [uiLocale, setUiLocale] = useState<UiLocalePreference>("system");
  useEffect(() => {
    if (query.data) {
      setDisplayName(query.data.displayName);
      setAvatarSeed(query.data.avatarSeed);
      setUiLocale(query.data.uiLocale);
    }
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => saveMyProfile({ displayName, avatarSeed, uiLocale }),
    onSuccess: async (profile) => {
      queryClient.setQueryData(["my-profile"], profile);
      setDisplayName(profile.displayName);
      setAvatarSeed(profile.avatarSeed);
      setUiLocale(profile.uiLocale);
      await applyUiLocalePreference(profile.uiLocale);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.currentSession() });
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.all() });
    },
  });

  return <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
    <ManagementPageHeader title={t("settings.title")} />
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1">
      <aside className="border-b bg-[var(--tiny-sidebar)] p-3 md:border-b-0 md:border-r"><SelectionList className="grid-cols-2 md:grid-cols-1"><SelectionRow selected={section === "profile"} title={t("settings.profile")} onClick={() => setSection("profile")} /><SelectionRow selected={section === "security"} title={t("settings.security")} onClick={() => setSection("security")} /></SelectionList></aside>
      <div className="overflow-auto p-4 sm:p-6">{section === "profile" ? <ProfilePanel currentSession={currentSession} displayName={displayName} setDisplayName={setDisplayName} avatarSeed={avatarSeed} setAvatarSeed={setAvatarSeed} uiLocale={uiLocale} setUiLocale={setUiLocale} savePending={save.isPending} saveError={save.error} canSave={Boolean(query.data) && (displayName.trim() !== query.data?.displayName || avatarSeed !== query.data?.avatarSeed || uiLocale !== query.data?.uiLocale)} onSave={() => save.mutate()} /> : <SecurityPanel />}</div>
    </section>
  </main>;
}

function SecurityPanel(): ReactElement {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [passkeys, setPasskeys] = useState<OwnerPasskey[]>([]);
  const [loadingSecurity, setLoadingSecurity] = useState(true);
  const [revoking, setRevoking] = useState(false);

  const loadSecurityState = useCallback(async (): Promise<void> => {
    setLoadingSecurity(true);
    const [sessionResponse, passkeyResponse] = await Promise.all([
      fetch("/api/auth/list-sessions", { credentials: "include" }),
      fetch("/api/auth/passkey/list-user-passkeys", { credentials: "include" }),
    ]);
    if (!sessionResponse.ok || !passkeyResponse.ok) throw new Error(t("settings.securityLoadFailed"));
    setSessions(await sessionResponse.json() as AuthSession[]);
    setPasskeys(await passkeyResponse.json() as OwnerPasskey[]);
    setLoadingSecurity(false);
  }, [t]);

  useEffect(() => {
    void loadSecurityState().catch((cause) => {
      setLoadingSecurity(false);
      setMessage(cause instanceof Error ? cause.message : String(cause));
    });
  }, [loadSecurityState]);

  async function addPasskey(): Promise<void> {
    setAdding(true);
    setMessage("");
    const result = await authClient.passkey.addPasskey({ name: "Backup Owner passkey" });
    setAdding(false);
    if (result?.error) {
      setMessage(result.error.message || t("settings.passkeyAddFailed"));
      return;
    }
    setMessage(t("settings.backupPasskeyAdded"));
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
      setMessage(payload?.message || t("settings.signOutOthersFailed"));
      return;
    }
    setMessage(t("settings.othersSignedOut"));
    await loadSecurityState();
  }

  async function signOut(): Promise<void> {
    await authClient.signOut();
    window.location.assign("/");
  }

  return <section className="grid max-w-3xl gap-5">
    <div><h2 className="font-semibold">{t("settings.ownerSecurity")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("settings.ownerSecurityDescription")}</p></div>
    <div className="grid gap-4 border-y py-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5" /><div><div className="font-medium">{t("settings.passkeys")}</div><div className="mt-1 text-sm text-muted-foreground">{t("settings.passkeysDescription")}</div></div></div><Button variant="outline" disabled={adding} onClick={() => void addPasskey()}><KeyRound />{adding ? t("settings.adding") : t("settings.addPasskey")}</Button></div>
      <div className="grid gap-2 border-t pt-3 text-sm">{loadingSecurity ? <span className="text-muted-foreground">{t("settings.loadingCredentials")}</span> : passkeys.length ? passkeys.map((passkey) => <div key={passkey.id} className="flex items-center justify-between gap-3"><span className="font-medium">{passkey.name || t("settings.ownerPasskey")}</span><span className="text-xs text-muted-foreground">{t("settings.added", { date: formatSecurityDate(passkey.createdAt) })}</span></div>) : <span className="text-muted-foreground">{t("settings.noPasskey")}</span>}</div>
    </div>
    <div className="grid gap-4 border-b pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><MonitorSmartphone className="mt-0.5 size-5" /><div><div className="font-medium">{t("settings.ownerSessions")}</div><div className="mt-1 text-sm text-muted-foreground">{t("settings.ownerSessionsDescription")}</div></div></div><Button variant="outline" disabled={revoking || sessions.length < 2} onClick={() => void revokeOtherSessions()}>{revoking ? t("settings.signingOut") : t("settings.signOutOthers")}</Button></div>
      <div className="grid gap-2 border-t pt-3 text-sm">{loadingSecurity ? <span className="text-muted-foreground">{t("settings.loadingSessions")}</span> : sessions.map((session, index) => <div key={session.id} className="flex items-start justify-between gap-3"><div><div className="font-medium">{index === 0 ? t("settings.currentSession") : t("settings.otherSession")}</div><div className="mt-0.5 max-w-lg truncate text-xs text-muted-foreground">{session.userAgent || t("settings.unknownDevice")}</div></div><span className="shrink-0 text-xs text-muted-foreground">{t("settings.expires", { date: formatSecurityDate(session.expiresAt) })}</span></div>)}</div>
    </div>
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => void signOut()}><LogOut />{t("settings.signOutBrowser")}</Button>{message ? <span role="status" className="text-sm text-muted-foreground">{message}</span> : null}</div>
  </section>;
}

type AuthSession = { id: string; userAgent?: string | null; expiresAt: string | Date };
type OwnerPasskey = { id: string; name?: string | null; createdAt: string | Date };

function formatSecurityDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(currentUiLocale());
}

function ProfilePanel({ currentSession, displayName, setDisplayName, avatarSeed, setAvatarSeed, uiLocale, setUiLocale, savePending, saveError, canSave, onSave }: {
  currentSession?: TinyOfficeCurrentSession;
  displayName: string;
  setDisplayName(value: string): void;
  avatarSeed: string;
  setAvatarSeed(value: string): void;
  uiLocale: UiLocalePreference;
  setUiLocale(value: UiLocalePreference): void;
  savePending: boolean;
  saveError: Error | null;
  canSave: boolean;
  onSave(): void;
}): ReactElement {
  const { t } = useTranslation();
  return <section className="grid max-w-3xl gap-5">
    <div className="flex items-start justify-between"><div><h2 className="font-semibold">{t("settings.profile")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("settings.profileDescription")}</p></div><Badge variant="secondary">{t("common.owner")}</Badge></div>
    {avatarSeed ? <AvatarSeedEditor memberId={currentSession?.user.id ?? "current-user"} displayName={displayName || t("onboarding.you")} avatarSeed={avatarSeed} disabled={savePending} onChange={setAvatarSeed} /> : null}
    <label className="grid gap-2 text-sm"><span className="font-medium">{t("settings.displayName")}</span><Input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.currentTarget.value)} /></label>
    <label className="grid gap-2 text-sm"><span className="font-medium">{t("settings.language")}</span><Select value={uiLocale} onValueChange={(value) => setUiLocale(value as UiLocalePreference)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">{t("settings.followSystem")}</SelectItem><SelectItem value="zh-CN">{t("settings.simplifiedChinese")}</SelectItem><SelectItem value="en">{t("settings.english")}</SelectItem></SelectContent></Select><span className="text-xs text-muted-foreground">{t("settings.languageDescription")}</span></label>
    <div className="tiny-settings-comparison grid sm:grid-cols-2"><ProfileValue label={t("settings.accountType")} value={t("common.owner")} /><ProfileValue label={t("settings.companyRole")} value={currentSession?.member?.role ?? t("settings.notAssigned")} /></div>
    <div className="flex items-center gap-3"><Button disabled={!canSave || savePending} onClick={onSave}>{t("settings.saveProfile")}</Button>{saveError ? <span className="text-sm text-[var(--tiny-danger-ink)]">{saveError.message}</span> : null}</div>
  </section>;
}

function ProfileValue({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="tiny-settings-fact p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium">{value}</div></div>;
}
