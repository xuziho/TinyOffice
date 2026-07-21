import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { RuntimeActivityItem } from "tinyoffice/frontend-api-contracts";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

export type RuntimeActivityDensity = "summary" | "compact" | "full";

export function RuntimeActivityList({
  items,
  maxHeight,
  emptyText = "No activity recorded.",
  density = "compact",
  followLatest = false,
  collapseToolActivity = false,
}: {
  items: RuntimeActivityItem[];
  maxHeight?: string;
  emptyText?: string;
  density?: RuntimeActivityDensity;
  followLatest?: boolean;
  collapseToolActivity?: boolean;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const activityVersion = useMemo(
    () => items.map((item) => `${item.id}:${item.status}:${(item.details ?? "").length}:${item.raw.eventIds.length}`).join("|"),
    [items],
  );
  const displayEntries = useMemo(
    () => collapseToolActivity ? collapseToolEntries(items) : items.map((item) => ({ type: "item" as const, item })),
    [collapseToolActivity, items],
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
          {displayEntries.map((entry) => entry.type === "tool-group" ? (
            <ToolActivitySummaryRow key={entry.id} entry={entry} />
          ) : (
            <RuntimeActivityRow key={entry.item.id} item={entry.item} density={density} />
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

interface ToolActivityGroupEntry {
  type: "tool-group";
  id: string;
  items: RuntimeActivityItem[];
  operationLabel: string;
  failedCount: number;
}

type ActivityDisplayEntry = { type: "item"; item: RuntimeActivityItem } | ToolActivityGroupEntry;

function collapseToolEntries(items: RuntimeActivityItem[]): ActivityDisplayEntry[] {
  const toolItems = items.filter(isToolItem);
  if (toolItems.length < 2) {
    return items.map((item) => ({ type: "item", item }));
  }

  const standaloneResults = toolItems.filter((item) => item.kind === "tool_result");
  const summaryItems = standaloneResults.length > 0 ? standaloneResults : toolItems;
  const operationLabel = standaloneResults.length > 0
    ? `${summaryItems.length} ${summaryItems.length === 1 ? "result" : "results"}`
    : `${summaryItems.length} ${summaryItems.length === 1 ? "operation" : "operations"}`;
  const group: ToolActivityGroupEntry = {
    type: "tool-group",
    id: `tool-activity:${toolItems.map((item) => item.id).join("|")}`,
    items: summaryItems,
    operationLabel,
    failedCount: summaryItems.filter((item) => item.status === "failed").length,
  };
  const output: ActivityDisplayEntry[] = [];
  let inserted = false;
  for (const item of items) {
    if (isToolItem(item)) {
      if (!inserted) {
        output.push(group);
        inserted = true;
      }
      continue;
    }
    output.push({ type: "item", item });
  }
  return output;
}

function isToolItem(item: RuntimeActivityItem): boolean {
  return item.kind === "tool_call" || item.kind === "tool_result";
}

function ToolActivitySummaryRow({ entry }: { entry: ToolActivityGroupEntry }): ReactElement {
  const [open, setOpen] = useState(false);
  const breakdown = toolBreakdown(entry.items);
  const status: RuntimeActivityItem["status"] = entry.failedCount > 0 ? "failed" : entry.items.some((item) => item.status === "running") ? "running" : "succeeded";
  return (
    <li className="grid min-w-0 grid-cols-[12px_minmax(0,1fr)] gap-1.5 border-b border-[var(--tiny-line-soft)] py-1.5 last:border-b-0">
      <div className="relative flex justify-center pt-1.5">
        <span className={`relative z-10 size-1.5 rounded-full ${statusDotClass(status)}`} />
      </div>
      <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
        <CollapsibleTrigger className="flex min-w-0 w-full cursor-pointer items-baseline gap-1.5 text-left">
          <ChevronRightIcon className={`size-3 shrink-0 self-center transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
          <span className="min-w-0 break-words text-xs font-semibold leading-4">Tool activity</span>
          <span className="min-w-0 break-words text-[11px] text-muted-foreground">
            {entry.operationLabel}{entry.failedCount > 0 ? ` · ${entry.failedCount} failed` : ""}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1 pl-[18px]">
          <ul className="grid gap-1 text-[11px] leading-4 text-muted-foreground">
            {breakdown.map((item) => (
              <li key={item.toolName} className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 break-words font-medium text-foreground [overflow-wrap:anywhere]">{item.toolName}</span>
                <span className="shrink-0">{item.count}{item.failedCount > 0 ? ` · ${item.failedCount} failed` : ""}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground/80">Full step evidence remains available in Sessions.</p>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function toolBreakdown(items: RuntimeActivityItem[]): Array<{ toolName: string; count: number; failedCount: number }> {
  const values = new Map<string, { toolName: string; count: number; failedCount: number }>();
  for (const item of items) {
    const toolName = sanitizeInlineText(item.primary?.toolName) || "tool";
    const current = values.get(toolName) || { toolName, count: 0, failedCount: 0 };
    current.count += 1;
    if (item.status === "failed") current.failedCount += 1;
    values.set(toolName, current);
  }
  return [...values.values()].sort((left, right) => right.count - left.count || left.toolName.localeCompare(right.toolName));
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
