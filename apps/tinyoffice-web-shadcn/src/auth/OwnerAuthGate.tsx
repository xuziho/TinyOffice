import { Button } from "@/components/ui/button";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { authClient } from "./authClient";

type AuthStatus = {
  schema: "tinyoffice-auth-status";
  version: 2;
  accessMode: "local" | "remote";
  authenticated: boolean;
  bootstrapRequired: boolean;
  ownerConfigured: boolean;
  passkeyConfigured: boolean;
};

export function OwnerAuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AuthStatus>();
  const [bootstrapToken] = useState(() => new URLSearchParams(window.location.search).get("bootstrap") ?? "");
  const [localAccessTicket] = useState(() => new URLSearchParams(window.location.search).get("localAccess") ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const localExchangeStarted = useRef(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/tinyoffice/auth/status", { credentials: "include" });
    if (!response.ok) throw new Error("TinyOffice authentication status could not be loaded.");
    setStatus(await response.json() as AuthStatus);
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [refresh]);

  useEffect(() => {
    if (status?.accessMode !== "local" || status.authenticated || !localAccessTicket || localExchangeStarted.current) return;
    localExchangeStarted.current = true;
    setPending(true);
    setError("");
    void fetch("/api/auth/tinyoffice/local-owner-access", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: localAccessTicket }),
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => undefined) as { message?: string } | undefined;
        throw new Error(payload?.message || "Local Owner access could not be established.");
      }
      clearAccessQuery();
      await refresh();
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => setPending(false));
  }, [localAccessTicket, refresh, status]);

  async function signIn(): Promise<void> {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) throw new Error(result.error.message || "Passkey sign-in failed.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  async function createOwner(): Promise<void> {
    if (!bootstrapToken) {
      setError("Open the private one-time Owner setup link printed by TinyOffice.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const registration = await authClient.passkey.addPasskey({
        name: "Primary Owner passkey",
        context: bootstrapToken,
      });
      if (registration?.error) throw new Error(registration.error.message || "Passkey registration failed.");
      clearAccessQuery();
      await signIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  }

  if (status?.authenticated) return children;

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <section className="w-full max-w-md rounded-2xl border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] p-6 shadow-[3px_3px_0_var(--tiny-line-soft)]">
        <img src="/brand/tinyoffice-mark.svg" alt="TinyOffice" className="mb-5 size-14" />
        <div className="mb-5 flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--tiny-cyan)]"><ShieldCheck className="size-5" /></span>
          <div><h1 className="text-xl font-semibold">{t("auth.ownerAccess")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("auth.ownerAccessDescription")}</p></div>
        </div>
        {!status && !error ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t("auth.checking")}</div> : null}
        {status?.accessMode === "local" ? (
          <div className="grid gap-3">
            {pending ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t("auth.opening")}</div> : null}
            {!pending && !localAccessTicket ? <p className="text-sm text-muted-foreground">{t("auth.localLink")}</p> : null}
          </div>
        ) : status?.bootstrapRequired ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">{bootstrapToken ? t("auth.createFirstPasskey") : t("auth.openSetupLink")}</p>
            {bootstrapToken ? <Button onClick={() => void createOwner()} disabled={pending}><KeyRound />{pending ? t("auth.creatingOwner") : t("auth.createOwnerPasskey")}</Button> : null}
          </div>
        ) : status?.ownerConfigured ? (
          <Button className="w-full" onClick={() => void signIn()} disabled={pending}><KeyRound />{pending ? t("auth.unlocking") : t("auth.unlockPasskey")}</Button>
        ) : null}
        {error ? <p role="alert" className="mt-4 rounded-lg border border-[var(--tiny-danger)] bg-[var(--tiny-danger-soft)] p-3 text-sm text-[var(--tiny-danger-ink)]">{error}</p> : null}
      </section>
    </main>
  );
}

function clearAccessQuery(): void {
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
}
