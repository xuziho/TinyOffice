import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { authClient } from "./authClient";

type AuthStatus = {
  schema: "tinyoffice-auth-status";
  version: 1;
  authenticated: boolean;
  bootstrapRequired: boolean;
  ownerConfigured: boolean;
};

export function OwnerAuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>();
  const [bootstrapToken, setBootstrapToken] = useState(() => new URLSearchParams(window.location.search).get("bootstrap") ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/tinyoffice/auth/status", { credentials: "include" });
    if (!response.ok) throw new Error("TinyOffice authentication status could not be loaded.");
    setStatus(await response.json() as AuthStatus);
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [refresh]);

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
    if (!bootstrapToken.trim()) {
      setError("Paste the one-time Owner setup token printed by TinyOffice.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const registration = await authClient.passkey.addPasskey({
        name: "Primary Owner passkey",
        context: bootstrapToken.trim(),
      });
      if (registration?.error) throw new Error(registration.error.message || "Passkey registration failed.");
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
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
          <div><h1 className="text-xl font-semibold">Owner access</h1><p className="mt-1 text-sm text-muted-foreground">This office has one human Owner. Your device passkey unlocks it.</p></div>
        </div>
        {!status && !error ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Checking your office…</div> : null}
        {status?.bootstrapRequired ? (
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">One-time setup token<Input value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} autoComplete="off" /></label>
            <Button onClick={() => void createOwner()} disabled={pending}><KeyRound />{pending ? "Creating Owner…" : "Create Owner passkey"}</Button>
          </div>
        ) : status?.ownerConfigured ? (
          <Button className="w-full" onClick={() => void signIn()} disabled={pending}><KeyRound />{pending ? "Unlocking…" : "Unlock with passkey"}</Button>
        ) : null}
        {error ? <p role="alert" className="mt-4 rounded-lg border border-[var(--tiny-danger)] bg-[var(--tiny-danger-soft)] p-3 text-sm text-[var(--tiny-danger-ink)]">{error}</p> : null}
      </section>
    </main>
  );
}
