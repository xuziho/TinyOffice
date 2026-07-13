import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import type { RuntimeActivityItem } from "tinyoffice/frontend-api-contracts";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

export type RuntimeActivityDensity = "summary" | "compact" | "full";

export function RuntimeActivityList({
  items,
  maxHeight,
  emptyText = "No activity recorded.",
  density = "compact",
  followLatest = false,
}: {
  items: RuntimeActivityItem[];
  maxHeight?: string;
  emptyText?: string;
  density?: RuntimeActivityDensity;
  followLatest?: boolean;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const activityVersion = useMemo(
    () => items.map((item) => `${item.id}:${item.status}:${(item.details ?? "").length}:${item.raw.eventIds.length}`).join("|"),
    [items],
  );

  useEffect(() => {
    if (!followLatest) {
      return undefined;
    }
    const viewport = activityViewport(rootRef.current);
    if (!viewport) {
      return undefined;
    }
    function handleScroll(): void {
      const currentViewport = activityViewport(rootRef.current);
      if (!currentViewport) {
        return;
      }
      const distanceFromBottom = currentViewport.scrollHeight - currentViewport.scrollTop - currentViewport.clientHeight;
      const isAtBottom = distanceFromBottom < 24;
      setIsFollowingLatest(isAtBottom);
      if (isAtBottom) {
        setHasNewActivity(false);
      }
    }
    viewport.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [followLatest]);

  useEffect(() => {
    if (!followLatest || items.length === 0) {
      return;
    }
    if (!isFollowingLatest) {
      setHasNewActivity(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => scrollActivityToBottom(rootRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [activityVersion, followLatest, isFollowingLatest, items.length]);

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="relative min-w-0" ref={rootRef}>
      <ScrollArea className={`rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] ${maxHeightClass(maxHeight)}`} style={maxHeight ? { maxHeight } : undefined}>
        <ol className={listClassName(density)}>
          {items.map((item) => (
            <RuntimeActivityRow key={item.id} item={item} density={density} />
          ))}
        </ol>
      </ScrollArea>
      {followLatest && hasNewActivity ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="absolute bottom-2 right-3"
          onClick={() => {
            scrollActivityToBottom(rootRef.current);
            setIsFollowingLatest(true);
            setHasNewActivity(false);
          }}
        >
          Jump to latest
        </Button>
      ) : null}
    </div>
  );
}

function activityViewport(root: HTMLDivElement | null): HTMLElement | undefined {
  return root?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']") ?? undefined;
}

function scrollActivityToBottom(root: HTMLDivElement | null): void {
  const viewport = activityViewport(root);
  if (!viewport) {
    return;
  }
  viewport.scrollTop = viewport.scrollHeight;
}

function listClassName(density: RuntimeActivityDensity): string {
  if (density === "full") {
    return "grid min-w-0 gap-0 px-3 py-2";
  }
  if (density === "summary") {
    return "grid min-w-0 gap-0 px-2 py-1";
  }
  return "grid min-w-0 gap-0 px-2 py-1.5";
}

function maxHeightClass(maxHeight: string | undefined): string {
  switch (maxHeight) {
    case "220px":
      return "max-h-[220px]";
    case "274px":
      return "max-h-[274px]";
    case "360px":
      return "max-h-[360px]";
    default:
      return "";
  }
}

function RuntimeActivityRow({
  item,
  density,
}: {
  item: RuntimeActivityItem;
  density: RuntimeActivityDensity;
}): ReactElement {
  const meta = primaryMeta(item);
  const details = activityDetails(item);
  const summaryMeta = summaryInlineMeta(item);
  const titleClassName = density === "summary"
    ? "min-w-0 break-words text-xs font-semibold leading-4 [overflow-wrap:anywhere]"
    : "min-w-0 break-words text-sm font-semibold leading-5 [overflow-wrap:anywhere]";
  const detailsClassName = density === "summary"
    ? "min-w-0 whitespace-pre-wrap break-words text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]"
    : `${density === "compact" ? "line-clamp-3" : ""} min-w-0 whitespace-pre-wrap break-words text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]`;
  if (density === "summary") {
    return (
      <li className="grid min-w-0 grid-cols-[12px_minmax(0,1fr)] gap-1.5 border-b border-[var(--tiny-line-soft)] py-1.5 last:border-b-0">
        <div className="relative flex justify-center pt-1.5">
          <span className={`relative z-10 size-1.5 rounded-full ${statusDotClass(item.status)}`} />
        </div>
        <details className="group min-w-0">
          <summary className="flex min-w-0 cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={titleClassName}>{item.title}</span>
            {summaryMeta ? <span className="min-w-0 break-words text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{summaryMeta}</span> : null}
          </summary>
          <div className="mt-1 grid min-w-0 gap-1 pl-0.5">
            {details ? (
              <p className={detailsClassName}>
                {details}
              </p>
            ) : null}
            {meta.length ? <RuntimeActivityMeta values={meta} /> : null}
          </div>
        </details>
      </li>
    );
  }

  return (
    <li className="grid min-w-0 grid-cols-[14px_minmax(0,1fr)] gap-2 border-b border-[var(--tiny-line-soft)] py-2 last:border-b-0">
      <div className="relative flex justify-center pt-1.5">
        <span className={`relative z-10 size-2 rounded-full ${statusDotClass(item.status)}`} />
      </div>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={titleClassName}>{item.title}</span>
          {summaryMeta ? <span className="min-w-0 break-words text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{summaryMeta}</span> : null}
        </div>
        {details ? (
          <p className={detailsClassName}>
            {details}
          </p>
        ) : null}
        {meta.length ? <RuntimeActivityMeta values={meta} /> : null}
        {density === "full" ? <RuntimeActivityRawEvidence item={item} /> : null}
      </div>
    </li>
  );
}

function RuntimeActivityMeta({ values }: { values: string[] }): ReactElement {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      {values.map((value) => (
        <span key={value} className="min-w-0 break-words [overflow-wrap:anywhere]">{value}</span>
      ))}
    </div>
  );
}

function RuntimeActivityRawEvidence({ item }: { item: RuntimeActivityItem }): ReactElement {
  return (
    <details className="group mt-1 text-xs">
      <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">
        Evidence
        <span className="ml-2 text-muted-foreground/80">
          {item.raw.events.length} {item.raw.events.length === 1 ? "event" : "events"}
        </span>
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--tiny-fill)] p-2 font-mono text-[11px] leading-5 [overflow-wrap:anywhere]">
        {JSON.stringify(item.raw.events, null, 2)}
      </pre>
    </details>
  );
}

function summaryInlineMeta(item: RuntimeActivityItem): string | undefined {
  if (item.kind === "handoff" && item.primary?.targetMemberId) {
    return `to ${sanitizeInlineText(item.primary.targetMemberId)}`;
  }
  return undefined;
}

function primaryMeta(item: RuntimeActivityItem): string[] {
  const primary = item.primary;
  if (!primary) {
    return [];
  }
  if (item.kind === "handoff") {
    return [
      primary.targetMemberId ? `To ${sanitizeInlineText(primary.targetMemberId)}` : undefined,
    ].filter((value): value is string => Boolean(value));
  }
  return [
    primary.toolName ? `Tool ${sanitizeInlineText(primary.toolName)}` : undefined,
    primary.arguments !== undefined ? `Args ${formatPrimaryValue(primary.arguments)}` : undefined,
    primary.targetMemberId ? `Target ${sanitizeInlineText(primary.targetMemberId)}` : undefined,
    primary.replyMessageId ? `Reply ${sanitizeInlineText(primary.replyMessageId)}` : undefined,
  ].filter((value): value is string => Boolean(value));
}

function activityDetails(item: RuntimeActivityItem): string | undefined {
  const sanitized = sanitizeInlineText(item.details);
  if (!sanitized) {
    return undefined;
  }
  return sanitized;
}

function statusDotClass(status: RuntimeActivityItem["status"]): string {
  switch (status) {
    case "failed":
      return "bg-destructive";
    case "succeeded":
      return "bg-[var(--tiny-mint-strong)]";
    case "running":
      return "bg-foreground";
    default:
      return "bg-muted-foreground/50";
  }
}

function formatPrimaryValue(value: unknown): string {
  if (typeof value === "string") {
    return sanitizeInlineText(value);
  }
  return sanitizeInlineText(JSON.stringify(value, null, 2));
}

function sanitizeInlineText(value: string | undefined): string {
  return (value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/[~#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
