import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon, MessageSquareTextIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import type { AccessRequestDecision, AccessRequestDto } from "tinyoffice/frontend-api-contracts";

export function AccessRequestCards({
  requests,
  busy,
  onResolveAccessRequest,
}: {
  requests: AccessRequestDto[];
  busy: boolean;
  onResolveAccessRequest(input: { request: AccessRequestDto; decision: AccessRequestDecision; note?: string }): Promise<void>;
}): ReactElement | null {
  const [notesByRequestId, setNotesByRequestId] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const requestIds = new Set(requests.map((request) => request.id));
    setNotesByRequestId((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([requestId]) => requestIds.has(requestId)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    if (requests.length === 0) {
      setError(undefined);
    }
  }, [requests]);

  if (requests.length === 0) {
    return null;
  }

  async function resolve(request: AccessRequestDto, decision: AccessRequestDecision, nextNote?: string): Promise<void> {
    setError(undefined);
    try {
      const trimmedNote = nextNote?.trim();
      await onResolveAccessRequest({ request, decision, ...(trimmedNote ? { note: trimmedNote } : {}) });
      setNotesByRequestId((current) => {
        const { [request.id]: _resolved, ...rest } = current;
        return rest;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to resolve access request.");
    }
  }

  return (
    <div className="grid gap-2">
      {requests.map((request) => {
        const note = notesByRequestId[request.id] ?? "";
        const resource = request.requestedResource?.trim();
        return (
          <section key={request.id} className="tiny-chat-access-card grid gap-2 rounded-md border px-3 py-2 text-sm shadow-sm">
            <div className="flex min-w-0 items-start gap-2">
              <div className="tiny-chat-access-icon mt-0.5 rounded-md border bg-[var(--tiny-surface)] p-1.5 text-[var(--tiny-danger-ink)]">
                <ShieldAlertIcon className="size-3.5" />
              </div>
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-foreground">Access approval required</span>
                  <Badge variant="outline" className="h-5 border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-1.5 text-[11px] text-[var(--tiny-text)]">{request.requestedAction}</Badge>
                  {resource ? (
                    <span className="min-w-0 truncate font-mono text-xs text-foreground" title={resource}>
                      {resource}
                    </span>
                  ) : null}
                </div>
                <div className="line-clamp-1 text-xs text-muted-foreground" title={request.reason}>
                  {memberName(request.requestedByMemberId)}: {request.reason}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-9">
              <label className="relative min-w-[220px] flex-1">
                <span className="pointer-events-none absolute left-2 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground">
                  <MessageSquareTextIcon className="size-3.5" />
                </span>
                <Input
                  value={note}
                  aria-label="Optional note"
                  placeholder="Optional note"
                  className="h-8 bg-[var(--tiny-surface)] pl-7 text-sm"
                  disabled={busy}
                  onChange={(event) => {
                    const nextNote = event.currentTarget.value;
                    setNotesByRequestId((current) => ({ ...current, [request.id]: nextNote }));
                  }}
                />
              </label>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {request.actions.includes("reject") ? (
                  <Button type="button" size="sm" variant="outline" className="h-8 border-destructive/30 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={() => void resolve(request, "reject", note)}>
                    <XIcon className="size-3.5" />
                    Reject
                  </Button>
                ) : null}
                {request.actions.includes("allow_in_context") ? (
                  <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={busy} onClick={() => void resolve(request, "allow_in_context", note)}>
                    <CheckIcon className="size-3.5" />
                    {request.contextKind === "work_run" ? "This WorkRun" : "This conversation"}
                  </Button>
                ) : null}
                {request.actions.includes("allow_once") ? (
                  <Button type="button" size="sm" className="h-8 px-2" disabled={busy} onClick={() => void resolve(request, "allow_once", note)}>
                    <CheckIcon className="size-3.5" />
                    Allow once
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function memberName(memberId: string): string {
  return memberId.trim() || "Employee";
}
