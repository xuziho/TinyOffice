import { getSessionExplorerViewModel } from "@/api/sessionsClient";
import { RuntimeActivityList } from "@/activity/RuntimeActivityList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { navigationHref, sessionsHref, shouldUseClientNavigation, type NavigationReturnContext, type NavigationTarget } from "@/app/navigationRoutes";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, CheckCircle2, ChevronDown, MessageSquare, Sparkles, Wrench } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import type {
  SessionExplorerPromptInputPackage,
  SessionExplorerRuntimeTurn,
  SessionExplorerSessionDetail,
  SessionExplorerSessionSummary,
  SessionExplorerUsageTotals,
  SessionExplorerViewModel,
  TinyOfficeCurrentSession,
} from "tinyoffice/frontend-api-contracts";
import {
  SESSION_SCENE_FILTERS,
  SESSION_TIME_FILTERS,
  selectedSessionFor,
  inputPackageReadableFacts,
  type SessionExplorerInputPackageFact,
  type SessionSceneFilter,
  type SessionTimeFilter,
  sessionPreview,
  sessionSceneLabel,
  sessionListPresentation,
  sessionTokenLabel,
  visibleSessionsFor,
  chatReturnTargetForSession,
  type SessionListPresentation,
} from "./sessionExplorerModel";

export interface SessionFocus {
  employeeId?: string;
  sessionId?: string;
  query?: string;
}

export interface SessionChatReturnTarget {
  surface: "direct" | "channel";
  conversationId: string;
}

function navigationTargetMatchesChatReturnTarget(
  target: NavigationTarget | undefined,
  chatTarget: SessionChatReturnTarget | undefined,
): boolean {
  return Boolean(
    target &&
      chatTarget &&
      target.kind === "chat-room" &&
      target.roomId === chatTarget.conversationId &&
      target.surface === chatTarget.surface,
  );
}

export function sessionQueryPlaceholderData(
  previousData: SessionExplorerViewModel | undefined,
): SessionExplorerViewModel | undefined {
  return previousData;
}

export function SessionsPage({
  currentSession,
  focus,
  returnContext,
  onOpenNavigationTarget,
  onClearReturnContext,
  onOpenChatTarget,
}: {
  currentSession?: TinyOfficeCurrentSession;
  focus?: SessionFocus;
  returnContext?: NavigationReturnContext;
  onOpenNavigationTarget?: (target: NavigationTarget) => void;
  onClearReturnContext?: () => void;
  onOpenChatTarget?: (target: SessionChatReturnTarget) => void;
}): ReactElement {
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const [query, setQuery] = useState(focus?.query ?? "");
  const [employeeIdFilter, setEmployeeIdFilter] = useState(focus?.employeeId ?? "");
  const [sceneFilter, setSceneFilter] = useState<SessionSceneFilter>("");
  const [timeFilter, setTimeFilter] = useState<SessionTimeFilter>("");
  const [selected, setSelected] = useState<{ employeeId?: string; sessionId?: string }>({
    employeeId: focus?.employeeId,
    sessionId: focus?.sessionId,
  });

  useEffect(() => {
    setQuery(focus?.query ?? "");
    setEmployeeIdFilter(focus?.employeeId ?? "");
    setSelected({
      employeeId: focus?.employeeId,
      sessionId: focus?.sessionId,
    });
  }, [focus?.employeeId, focus?.query, focus?.sessionId]);
  const queryInput = {
    employeeId: selected.employeeId,
    sessionId: selected.sessionId,
    query,
    employeeIdFilter,
  };
  const sessionsQuery = useQuery({
    queryKey: chatQueryKeys.sessions(companyId, queryInput),
    enabled: Boolean(companyId),
    queryFn: () => getSessionExplorerViewModel({ companyId, ...queryInput }),
    placeholderData: sessionQueryPlaceholderData,
  });
  const model = sessionsQuery.data;
  const sessions = useMemo(() => model ? visibleSessionsFor(model, { sceneFilter, timeFilter }) : [], [model, sceneFilter, timeFilter]);
  const detailSession = model?.detail ? selectedSessionFor(model) : undefined;
  const listPresentation = model ? sessionListPresentation(model, sessions) : undefined;
  const activeChatReturnTarget = detailSession && model?.detail ? chatReturnTargetForSession(model.detail.summary) : undefined;
  const hasSourceReturn = Boolean(returnContext && onOpenNavigationTarget);
  const shouldShowRelatedChat = Boolean(
    activeChatReturnTarget &&
      onOpenChatTarget &&
      !navigationTargetMatchesChatReturnTarget(returnContext?.target, activeChatReturnTarget),
  );

  function selectSession(session: SessionExplorerSessionSummary): void {
    onClearReturnContext?.();
    setSelected({ employeeId: session.employeeId, sessionId: session.sessionId });
    window.history.pushState({}, "", sessionsHref({ employeeId: session.employeeId, sessionId: session.sessionId, query }));
  }

  function backToSessionList(): void {
    onClearReturnContext?.();
    const nextSelected = {
      ...(detailSession?.employeeId ? { employeeId: detailSession.employeeId } : {}),
    };
    setSelected(nextSelected);
    window.history.pushState({}, "", sessionsHref({ employeeId: nextSelected.employeeId, query }));
  }

  return (
    <div className="tiny-soft-retro-sessions grid h-full w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <header className="tiny-product-header flex items-center justify-between gap-3 border-b">
        <div className="min-w-0">
          <div className="tiny-room-title truncate">{detailSession?.displayName ?? listPresentation?.title ?? "Sessions"}</div>
          <div className="tiny-room-subtitle truncate">
            {detailSession
              ? `${sessionSceneLabel(detailSession.sceneType)} - ${detailSession.role || detailSession.employeeId}`
              : `Evidence console - ${companyId || "No company selected"}`}
          </div>
        </div>
        {detailSession && model?.detail ? (
          <div className="flex shrink-0 items-center gap-2">
            {returnContext && onOpenNavigationTarget ? (
              <Button asChild variant="outline" size="sm" className="tiny-session-back-action h-9 px-3">
                <a
                  href={navigationHref(returnContext.target)}
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    if (!shouldUseClientNavigation(event)) {
                      return;
                    }
                    event.preventDefault();
                    onOpenNavigationTarget(returnContext.target);
                  }}
                >
                  <ArrowLeft className="mr-2 size-4" />
                  {returnContext.label}
                </a>
              </Button>
            ) : null}
            {!hasSourceReturn ? (
              <Button asChild variant="ghost" size="sm" className="h-8 px-2">
                <a
                  href={sessionsHref({ employeeId: detailSession.employeeId, query })}
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    if (!shouldUseClientNavigation(event)) {
                      return;
                    }
                    event.preventDefault();
                    backToSessionList();
                  }}
                >
                  <ArrowLeft className="mr-2 size-4" />
                  Back to session list
                </a>
              </Button>
            ) : null}
            {shouldShowRelatedChat && activeChatReturnTarget && onOpenChatTarget ? (
              <Button type="button" variant="secondary" size="sm" className="h-8 px-3" onClick={() => onOpenChatTarget(activeChatReturnTarget)}>
                <MessageSquare className="mr-2 size-4" />
                Open related chat
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      <section className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--tiny-canvas)]">
        <ScrollArea className="min-h-0">
          <div className="grid w-full gap-4 px-6 py-5">
            {sessionsQuery.isLoading ? (
              <StateBlock>Loading sessions...</StateBlock>
            ) : sessionsQuery.error ? (
              <StateBlock>{sessionsQuery.error instanceof Error ? sessionsQuery.error.message : "Failed to load sessions."}</StateBlock>
            ) : !model ? (
              <StateBlock>No company session is available.</StateBlock>
            ) : detailSession && model.detail ? (
              <SessionDetailPanel detail={model.detail} />
            ) : (
              <SessionListPanel
                model={model}
                sessions={sessions}
                presentation={listPresentation}
                selectedSessionId={detailSession?.sessionId}
                query={query}
                employeeIdFilter={employeeIdFilter}
                sceneFilter={sceneFilter}
                timeFilter={timeFilter}
                disabled={!companyId || !model}
                updating={sessionsQuery.isFetching && !sessionsQuery.isLoading}
                onQueryChange={(value) => {
                  onClearReturnContext?.();
                  setQuery(value);
                  setSelected({});
                  window.history.pushState({}, "", sessionsHref({ employeeId: employeeIdFilter || undefined, query: value }));
                }}
                onEmployeeFilterChange={(value) => {
                  onClearReturnContext?.();
                  setEmployeeIdFilter(value);
                  setSelected(value ? { employeeId: value } : {});
                  window.history.pushState({}, "", sessionsHref({ employeeId: value || undefined, query }));
                }}
                onSceneFilterChange={(value) => {
                  setSceneFilter(value);
                  setSelected({});
                }}
                onTimeFilterChange={(value) => {
                  setTimeFilter(value);
                  setSelected({});
                }}
                onSelectSession={selectSession}
              />
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}

function SessionListPanel({
  model,
  sessions,
  presentation,
  selectedSessionId,
  query,
  employeeIdFilter,
  sceneFilter,
  timeFilter,
  disabled,
  updating,
  onQueryChange,
  onEmployeeFilterChange,
  onSceneFilterChange,
  onTimeFilterChange,
  onSelectSession,
}: {
  model: SessionExplorerViewModel;
  sessions: SessionExplorerSessionSummary[];
  presentation?: SessionListPresentation;
  selectedSessionId?: string;
  query: string;
  employeeIdFilter: string;
  sceneFilter: SessionSceneFilter;
  timeFilter: SessionTimeFilter;
  disabled: boolean;
  updating: boolean;
  onQueryChange(value: string): void;
  onEmployeeFilterChange(value: string): void;
  onSceneFilterChange(value: SessionSceneFilter): void;
  onTimeFilterChange(value: SessionTimeFilter): void;
  onSelectSession(session: SessionExplorerSessionSummary): void;
}): ReactElement {
  const list = presentation ?? sessionListPresentation(model, sessions);
  return (
    <div className="grid gap-3">
      <SessionFilterBar
        model={model}
        query={query}
        employeeIdFilter={employeeIdFilter}
        sceneFilter={sceneFilter}
        timeFilter={timeFilter}
        disabled={disabled}
        updating={updating}
        onQueryChange={onQueryChange}
        onEmployeeFilterChange={onEmployeeFilterChange}
        onSceneFilterChange={onSceneFilterChange}
        onTimeFilterChange={onTimeFilterChange}
      />
      <div className="tiny-session-table overflow-hidden rounded-lg border border-[var(--tiny-line)] bg-[var(--tiny-surface)]">
        {sessions.length ? (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {list.showEmployeeColumn ? <TableHead className="h-8 w-[180px] px-3 text-[11px] uppercase text-muted-foreground">Employee</TableHead> : null}
                {list.showSceneColumn ? <TableHead className="h-8 w-[132px] px-3 text-[11px] uppercase text-muted-foreground">Scene</TableHead> : null}
                <TableHead className="h-8 w-[112px] px-3 text-right text-[11px] uppercase text-muted-foreground">Usage</TableHead>
                <TableHead className="h-8 w-[178px] px-3 text-right text-[11px] uppercase text-muted-foreground">Last active</TableHead>
                <TableHead className="h-8 px-3 text-[11px] uppercase text-muted-foreground">Preview</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow
                  key={`${session.employeeId}:${session.sessionId}`}
                  data-state={selectedSessionId === session.sessionId ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => onSelectSession(session)}
                >
                  {list.showEmployeeColumn ? (
                    <TableCell className="px-3 py-2">
                      <div className="min-w-0">
                        <a
                          href={sessionsHref({ employeeId: session.employeeId, sessionId: session.sessionId, query })}
                          className="block truncate text-sm font-semibold text-foreground hover:underline"
                          onClick={(event) => {
                            if (!shouldUseClientNavigation(event)) {
                              return;
                            }
                            event.preventDefault();
                            event.stopPropagation();
                            onSelectSession(session);
                          }}
                        >
                          {session.displayName}
                        </a>
                        <div className="truncate text-xs text-muted-foreground">{session.role || session.employeeId}</div>
                      </div>
                    </TableCell>
                  ) : null}
                  {list.showSceneColumn ? <TableCell className="px-3 py-2 text-xs text-muted-foreground">{sessionSceneLabel(session.sceneType)}</TableCell> : null}
                  <TableCell className="px-3 py-2 text-right text-xs text-muted-foreground">{sessionTokenLabel(session)}</TableCell>
                  <TableCell className="px-3 py-2 text-right text-xs text-muted-foreground">{formatDateTime(session.lastActivityAt ?? session.startedAt)}</TableCell>
                  <TableCell className="max-w-0 px-3 py-2">
                    <a
                      href={sessionsHref({ employeeId: session.employeeId, sessionId: session.sessionId, query })}
                      className="block truncate text-sm text-foreground hover:underline"
                      onClick={(event) => {
                        if (!shouldUseClientNavigation(event)) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectSession(session);
                      }}
                    >
                      {sessionPreview(session)}
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <StateBlock>No sessions match this filter.</StateBlock>
        )}
      </div>
    </div>
  );
}

function SessionFilterBar({
  model,
  query,
  employeeIdFilter,
  sceneFilter,
  timeFilter,
  disabled,
  updating,
  onQueryChange,
  onEmployeeFilterChange,
  onSceneFilterChange,
  onTimeFilterChange,
}: {
  model: SessionExplorerViewModel;
  query: string;
  employeeIdFilter: string;
  sceneFilter: SessionSceneFilter;
  timeFilter: SessionTimeFilter;
  disabled: boolean;
  updating: boolean;
  onQueryChange(value: string): void;
  onEmployeeFilterChange(value: string): void;
  onSceneFilterChange(value: SessionSceneFilter): void;
  onTimeFilterChange(value: SessionTimeFilter): void;
}): ReactElement {
  return (
    <div className="tiny-session-filters grid gap-2 rounded-lg border px-4 py-3">
      <Input
        value={query}
        placeholder="Search sessions..."
        disabled={disabled}
        className="h-8 max-w-xl bg-[var(--tiny-surface)]"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <FilterGroup label="People">
        <FilterChip active={!employeeIdFilter} disabled={disabled} onClick={() => onEmployeeFilterChange("")}>
          All people
        </FilterChip>
        {model.list.employeeFilters.map((filter) => (
          <FilterChip
            key={filter.employeeId}
            active={employeeIdFilter === filter.employeeId}
            disabled={disabled}
            onClick={() => onEmployeeFilterChange(filter.employeeId)}
          >
            {filter.displayName}
            <span className="text-muted-foreground">{filter.count}</span>
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup label="Scene">
        {SESSION_SCENE_FILTERS.map((filter) => (
          <FilterChip
            key={filter.value || "all-scenes"}
            active={sceneFilter === filter.value}
            disabled={disabled}
            onClick={() => onSceneFilterChange(filter.value)}
          >
            {filter.label}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup label="Time">
        {SESSION_TIME_FILTERS.map((filter) => (
          <FilterChip
            key={filter.value || "any-time"}
            active={timeFilter === filter.value}
            disabled={disabled}
            onClick={() => onTimeFilterChange(filter.value)}
          >
            {filter.label}
          </FilterChip>
        ))}
      </FilterGroup>
      {updating ? (
        <div className="text-[11px] text-muted-foreground">Updating sessions...</div>
      ) : null}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-12 text-[11px] font-semibold uppercase text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FilterChip({
  active,
  disabled,
  children,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  children: ReactNode;
  onClick(): void;
}): ReactElement {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="tiny-filter-chip h-7 gap-1 px-2 text-xs"
      data-active={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function SessionDetailPanel({
  detail,
}: {
  detail: SessionExplorerSessionDetail;
}): ReactElement {
  const modelLabel = detail.overview.model ?? modelDisplay(detail.summary);
  return (
    <div className="grid gap-4">
      <section className="grid gap-2 rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-fill)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold leading-tight">Session summary</h2>
          <SessionStatusBadge status={detail.overview.status} />
          {modelLabel === "No model recorded" ? null : (
            <Badge variant="secondary">{modelLabel}</Badge>
          )}
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Metric label="Turns" value={String(detail.overview.turns)} />
          <Metric label="Tokens" value={formatUsage(detail.usage.total)} />
          <Metric label="Last active" value={formatDateTime(detail.summary.lastActivityAt ?? detail.summary.startedAt)} />
        </div>
      </section>
      <Section title="Runtime turns">
        {detail.runtimeTurns.length ? (
          <div className="grid gap-4">
            {detail.runtimeTurns.map((turn) => <RuntimeTurnCard key={turn.turnId} turn={turn} />)}
          </div>
        ) : (
          <EmptyLine>No runtime turns recorded.</EmptyLine>
        )}
      </Section>
    </div>
  );
}

function RuntimeTurnCard({ turn }: { turn: SessionExplorerRuntimeTurn }): ReactElement {
  return (
    <details open className="tiny-session-turn group grid gap-3 rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <DetailsChevron />
          <span className="font-semibold">Turn {turn.index}</span>
        </span>
        <span className="text-xs text-muted-foreground">{formatUsage(turn.usage)}</span>
      </summary>
      <div className="grid gap-3">
        {turn.triggerMessage ? <MessageExcerpt label={turn.triggerMessage.label} text={turn.triggerMessage.text} timestamp={turn.triggerMessage.timestamp} /> : null}
        {turn.inputPackage ? <InputPackageDetails prompt={turn.inputPackage} /> : null}
        <RuntimeActivity turn={turn} />
        {turn.outputMessage ? <MessageExcerpt label={turn.outputMessage.label} text={turn.outputMessage.text} timestamp={turn.outputMessage.timestamp} /> : null}
      </div>
    </details>
  );
}

function MessageExcerpt({ label, text, timestamp }: { label: string; text: string; timestamp?: string }): ReactElement {
  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label} {timestamp ? `- ${formatDateTime(timestamp)}` : ""}</div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{text}</p>
    </div>
  );
}

function InputPackageDetails({ prompt }: { prompt: SessionExplorerPromptInputPackage }): ReactElement {
  const facts = inputPackageReadableFacts(prompt);
  const groups = groupInputPackageFacts(facts);
  return (
    <details className="tiny-session-disclosure group rounded-md bg-[var(--tiny-fill)] px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
        <DetailsChevron />
        <span>Prompt input</span>
        <SessionCount icon={<Wrench />} count={prompt.tools.length} label="tools" tone="cyan" />
        <SessionCount icon={<Sparkles />} count={prompt.skills.length} label="loaded skills" tone="yellow" />
      </summary>
      <div className="mt-3 grid gap-2 text-xs">
        {groups.visible.map((group) => (
          <PromptFactGroup key={group.label} label={group.label} facts={group.facts} />
        ))}
        <ToolsAndSkillsDetails tools={prompt.tools} skills={prompt.skills} />
        {groups.diagnostics.length ? (
          <details className="tiny-session-disclosure group rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-2 py-1.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
              <DetailsChevron />
              Diagnostics
            </summary>
            <div className="mt-2 grid gap-2">
              {groups.diagnostics.map((fact) => (
                <PromptFact key={fact.label} label={fact.label} value={fact.value} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}

function RuntimeActivity({ turn }: { turn: SessionExplorerRuntimeTurn }): ReactElement {
  if (turn.activity.items.length === 0) {
    return <EmptyLine>No activity recorded.</EmptyLine>;
  }
  return (
    <details className="tiny-session-disclosure group rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-fill)] px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
        <DetailsChevron />
        <span>Activity</span>
        <SessionCount icon={<Activity />} count={turn.activity.items.length} label={turn.activity.items.length === 1 ? "activity" : "activities"} tone="mint" />
      </summary>
      <div className="mt-3">
        <RuntimeActivityList items={turn.activity.items} density="full" />
      </div>
    </details>
  );
}

function groupInputPackageFacts(facts: SessionExplorerInputPackageFact[]): {
  visible: Array<{ label: SessionExplorerInputPackageFact["group"]; facts: SessionExplorerInputPackageFact[] }>;
  diagnostics: SessionExplorerInputPackageFact[];
} {
  const groupOrder: SessionExplorerInputPackageFact["group"][] = [
    "Prompt input",
    "Context input",
  ];
  return {
    visible: groupOrder
      .map((label) => ({
        label,
        facts: facts.filter((fact) => fact.group === label),
      }))
      .filter((group) => group.facts.length > 0),
    diagnostics: facts.filter((fact) => fact.group === "Diagnostics"),
  };
}

function PromptFactGroup({
  label,
  facts,
}: {
  label: SessionExplorerInputPackageFact["group"];
  facts: SessionExplorerInputPackageFact[];
}): ReactElement {
  return (
    <div className="grid gap-2">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      {facts.map((fact) => (
        <PromptFact key={fact.label} label={fact.label} value={fact.value} />
      ))}
    </div>
  );
}

function ToolsAndSkillsDetails({ tools, skills }: { tools: string[]; skills: string[] }): ReactElement | null {
  if (tools.length === 0 && skills.length === 0) {
    return null;
  }
  return (
    <details className="tiny-session-disclosure group rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-2 py-1.5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
        <DetailsChevron />
        <span>Tools and skills</span>
        <SessionCount icon={<Wrench />} count={tools.length} label="tools" tone="cyan" />
        <SessionCount icon={<Sparkles />} count={skills.length} label="loaded skills" tone="yellow" />
      </summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <ToolSkillList label="Tools" items={tools} />
        <ToolSkillList label="Skills" items={skills} />
      </div>
    </details>
  );
}

function ToolSkillList({ label, items }: { label: string; items: string[] }): ReactElement {
  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <code key={item} className="rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-fill)] px-1.5 py-1 font-mono text-[11px] leading-none text-foreground">
              {item}
            </code>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No {label.toLowerCase()} recorded.</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="rounded-md bg-[var(--tiny-surface)] px-2 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function SessionStatusBadge({ status }: { status: string }): ReactElement {
  const normalized = status.trim().toLowerCase();
  return (
    <Badge className={`tiny-session-status ${normalized}`} variant="outline">
      {normalized === "completed" ? <CheckCircle2 /> : null}
      {statusLabel(normalized)}
    </Badge>
  );
}

function SessionCount({
  icon,
  count,
  label,
  tone,
}: {
  icon: ReactNode;
  count: number;
  label: string;
  tone: "cyan" | "yellow" | "mint";
}): ReactElement {
  return <span className={`tiny-session-count ${tone}`}>{icon}<strong>{count}</strong><span>{label}</span></span>;
}

function statusLabel(status: string): string {
  return status ? `${status.charAt(0).toUpperCase()}${status.slice(1).replaceAll("_", " ")}` : "Unknown";
}

function Section({ title, children }: { title: string; children: ReactElement }): ReactElement {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-[0.02em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function PromptFact({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="grid gap-1 rounded-md bg-[var(--tiny-fill)] px-2 py-1.5">
      <span className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</span>
      <span className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 [overflow-wrap:anywhere]">{value || "Not recorded."}</span>
    </div>
  );
}

function DetailsChevron(): ReactElement {
  return <ChevronDown aria-hidden="true" className="size-3 shrink-0 transition-transform group-open:rotate-180" />;
}

function StateBlock({ children }: { children: string }): ReactElement {
  return (
    <div className="rounded-lg border border-[var(--tiny-line-soft)] px-4 py-3 text-muted-foreground">
      {children}
    </div>
  );
}

function EmptyLine({ children }: { children: string }): ReactElement {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function formatUsage(usage: SessionExplorerUsageTotals): string {
  const total = usage.inputTokens + usage.outputTokens + usage.cacheTokens;
  return total > 0 ? `${total.toLocaleString()} tokens` : "No usage";
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "No timestamp";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function modelDisplay(session: SessionExplorerSessionSummary): string {
  return [session.modelProvider, session.modelId].filter(Boolean).join(" / ") || "No model recorded";
}
