import { getSessionExplorerViewModel } from "@/api/sessionsClient";
import { RuntimeActivityList } from "@/activity/RuntimeActivityList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductState } from "@/components/product/ProductState";
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
import { SectionContentHeader } from "@/app/SectionContentHeader";
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
  visibleSessionsFor,
  chatReturnTargetForSession,
  type SessionListPresentation,
} from "./sessionExplorerModel";
import { sessionQueryPlaceholderData } from "./sessionQueryModel";
import { useTranslation } from "react-i18next";
import { currentUiLocale, i18n } from "@/i18n";

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
  const { t } = useTranslation();
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
    <div className={`tiny-soft-retro-sessions grid h-full w-full overflow-hidden ${detailSession ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]"}`}>
      {detailSession ? <SectionContentHeader
        title={detailSession.displayName}
        description={`${localizedSessionSceneLabel(detailSession.sceneType)} - ${detailSession.role || detailSession.employeeId}`}
        actions={detailSession && model?.detail ? (
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
                  {t("sessionsPage.backToList")}
                </a>
              </Button>
            ) : null}
            {shouldShowRelatedChat && activeChatReturnTarget && onOpenChatTarget ? (
              <Button type="button" variant="secondary" size="sm" className="h-8 px-3" onClick={() => onOpenChatTarget(activeChatReturnTarget)}>
                <MessageSquare className="mr-2 size-4" />
                {t("sessionsPage.openRelatedChat")}
              </Button>
            ) : null}
          </div>
        ) : undefined}
      /> : null}
      <section className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--tiny-canvas)]">
        <ScrollArea className="min-h-0">
          <div className="grid w-full gap-4 px-6 py-5">
            {sessionsQuery.isLoading ? (
              <ProductState compact description={t("sessionsPage.loading")} />
            ) : sessionsQuery.error ? (
              <ProductState compact tone="error" description={sessionsQuery.error instanceof Error ? sessionsQuery.error.message : t("sessionsPage.loadFailed")} />
            ) : !model ? (
              <ProductState compact description={t("sessionsPage.noCompanySession")} />
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
  const { t } = useTranslation();
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
                {list.showEmployeeColumn ? <TableHead className="h-8 w-[180px] px-3 text-[11px] uppercase text-muted-foreground">{t("sessionsPage.employee")}</TableHead> : null}
                {list.showSceneColumn ? <TableHead className="h-8 w-[132px] px-3 text-[11px] uppercase text-muted-foreground">{t("sessionsPage.scene")}</TableHead> : null}
                <TableHead className="h-8 w-[112px] px-3 text-right text-[11px] uppercase text-muted-foreground">{t("sessionsPage.usage")}</TableHead>
                <TableHead className="h-8 w-[178px] px-3 text-right text-[11px] uppercase text-muted-foreground">{t("sessionsPage.lastActive")}</TableHead>
                <TableHead className="h-8 px-3 text-[11px] uppercase text-muted-foreground">{t("sessionsPage.preview")}</TableHead>
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
                  {list.showSceneColumn ? <TableCell className="px-3 py-2 text-xs text-muted-foreground">{localizedSessionSceneLabel(session.sceneType)}</TableCell> : null}
                  <TableCell className="px-3 py-2 text-right text-xs text-muted-foreground">{localizedSessionTokenLabel(session)}</TableCell>
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
          <ProductState compact description={t("sessionsPage.noMatch")} />
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
  const { t } = useTranslation();
  return (
    <div className="tiny-session-filters grid gap-2 rounded-lg border px-4 py-3">
      <Input
        value={query}
        placeholder={t("sessionsPage.search")}
        disabled={disabled}
        className="h-8 max-w-xl bg-[var(--tiny-surface)]"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      <FilterGroup label={t("sessionsPage.people")}>
        <FilterChip active={!employeeIdFilter} disabled={disabled} onClick={() => onEmployeeFilterChange("")}>
          {t("sessionsPage.allPeople")}
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
      <FilterGroup label={t("sessionsPage.scene")}>
        {SESSION_SCENE_FILTERS.map((filter) => (
          <FilterChip
            key={filter.value || "all-scenes"}
            active={sceneFilter === filter.value}
            disabled={disabled}
            onClick={() => onSceneFilterChange(filter.value)}
          >
            {t(`sessionsPage.${filter.value === "" ? "allScenes" : filter.value}`)}
          </FilterChip>
        ))}
      </FilterGroup>
      <FilterGroup label={t("sessionsPage.time")}>
        {SESSION_TIME_FILTERS.map((filter) => (
          <FilterChip
            key={filter.value || "any-time"}
            active={timeFilter === filter.value}
            disabled={disabled}
            onClick={() => onTimeFilterChange(filter.value)}
          >
            {t(`sessionsPage.${filter.value === "" ? "anyTime" : filter.value === "24h" ? "hours24" : filter.value === "3d" ? "days3" : "days7"}`)}
          </FilterChip>
        ))}
      </FilterGroup>
      {updating ? (
        <div className="text-[11px] text-muted-foreground">{t("sessionsPage.updating")}</div>
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
  const hasModel = Boolean(detail.overview.model || detail.summary.modelProvider || detail.summary.modelId);
  const { t } = useTranslation();
  const modelLabel = detail.overview.model ?? modelDisplay(detail.summary);
  return (
    <div className="grid gap-4">
      <section className="grid gap-2 rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-fill)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold leading-tight">{t("sessionsPage.summary")}</h2>
          <SessionStatusBadge status={detail.overview.status} />
          {!hasModel ? null : (
            <Badge variant="secondary">{modelLabel}</Badge>
          )}
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Metric label={t("sessionsPage.turns")} value={String(detail.overview.turns)} />
          <Metric label={t("sessionsPage.tokensLabel")} value={formatUsage(detail.usage.total)} />
          <Metric label={t("sessionsPage.lastActive")} value={formatDateTime(detail.summary.lastActivityAt ?? detail.summary.startedAt)} />
        </div>
      </section>
      <Section title={t("sessionsPage.runtimeTurns")}>
        {detail.runtimeTurns.length ? (
          <div className="grid gap-4">
            {detail.runtimeTurns.map((turn) => <RuntimeTurnCard key={turn.turnId} turn={turn} />)}
          </div>
        ) : (
          <EmptyLine>{t("sessionsPage.noTurns")}</EmptyLine>
        )}
      </Section>
    </div>
  );
}

function RuntimeTurnCard({ turn }: { turn: SessionExplorerRuntimeTurn }): ReactElement {
  const { t } = useTranslation();
  return (
    <details open className="tiny-session-turn group grid gap-3 rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <DetailsChevron />
          <span className="font-semibold">{t("sessionsPage.turn", { index: turn.index })}</span>
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
  const { t } = useTranslation();
  const facts = inputPackageReadableFacts(prompt);
  const groups = groupInputPackageFacts(facts);
  return (
    <details className="tiny-session-disclosure group rounded-md bg-[var(--tiny-fill)] px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
        <DetailsChevron />
        <span>{t("sessionsPage.promptInput")}</span>
        <SessionCount icon={<Wrench />} count={prompt.tools.length} label={t("sessionsPage.tools")} tone="cyan" />
        <SessionCount icon={<Sparkles />} count={prompt.skills.length} label={t("sessionsPage.loadedSkills")} tone="yellow" />
      </summary>
      <div className="mt-3 grid gap-2 text-xs">
        {groups.visible.map((group) => (
          <PromptFactGroup key={group.label} label={localizedPromptGroupLabel(group.label)} facts={group.facts} />
        ))}
        <ToolsAndSkillsDetails tools={prompt.tools} skills={prompt.skills} />
        {groups.diagnostics.length ? (
          <details className="tiny-session-disclosure group rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-2 py-1.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
              <DetailsChevron />
              {t("sessionsPage.diagnostics")}
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
  const { t } = useTranslation();
  if (turn.activity.items.length === 0) {
    return <EmptyLine>{t("sessionsPage.noActivity")}</EmptyLine>;
  }
  return (
    <details className="tiny-session-disclosure group rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-fill)] px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
        <DetailsChevron />
        <span>{t("sessionsPage.activity")}</span>
        <SessionCount icon={<Activity />} count={turn.activity.items.length} label={turn.activity.items.length === 1 ? t("sessionsPage.activity") : t("sessionsPage.activities")} tone="mint" />
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

function localizedPromptGroupLabel(label: SessionExplorerInputPackageFact["group"]): string {
  if (label === "Prompt input") return i18n.t("sessionsPage.promptInput");
  if (label === "Context input") return i18n.t("sessionsPage.contextInput");
  if (label === "Diagnostics") return i18n.t("sessionsPage.diagnostics");
  return label;
}

function PromptFactGroup({
  label,
  facts,
}: {
  label: string;
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
  const { t } = useTranslation();
  if (tools.length === 0 && skills.length === 0) {
    return null;
  }
  return (
    <details className="tiny-session-disclosure group rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-2 py-1.5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
        <DetailsChevron />
        <span>{t("sessionsPage.toolsSkills")}</span>
        <SessionCount icon={<Wrench />} count={tools.length} label={t("sessionsPage.tools")} tone="cyan" />
        <SessionCount icon={<Sparkles />} count={skills.length} label={t("sessionsPage.loadedSkills")} tone="yellow" />
      </summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <ToolSkillList label={t("sessionsPage.tools")} items={tools} />
        <ToolSkillList label={t("sessionsPage.skills")} items={skills} />
      </div>
    </details>
  );
}

function ToolSkillList({ label, items }: { label: string; items: string[] }): ReactElement {
  const { t } = useTranslation();
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
        <p className="text-sm text-muted-foreground">{t("sessionsPage.noItemsRecorded", { label })}</p>
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
  const key = ({ completed: "completed", running: "running", pending: "pending", blocked: "blocked", queued: "queued", done: "done", in_progress: "inProgress", active: "active", canceled: "canceled", archived: "archived" } as const)[status as "completed" | "running" | "pending" | "blocked" | "queued" | "done" | "in_progress" | "active" | "canceled" | "archived"];
  return key ? i18n.t(`enums.${key}`) : status ? `${status.charAt(0).toUpperCase()}${status.slice(1).replaceAll("_", " ")}` : i18n.t("common.unknown");
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
      <span className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 [overflow-wrap:anywhere]">{value || i18n.t("sessionsPage.notRecorded")}</span>
    </div>
  );
}

function DetailsChevron(): ReactElement {
  return <ChevronDown aria-hidden="true" className="size-3 shrink-0 transition-transform group-open:rotate-180" />;
}


function EmptyLine({ children }: { children: string }): ReactElement {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function formatUsage(usage: SessionExplorerUsageTotals): string {
  const total = usage.inputTokens + usage.outputTokens + usage.cacheTokens;
  return total > 0 ? i18n.t("common.tokens", { count: total.toLocaleString(currentUiLocale()) }) : i18n.t("common.noUsage");
}

function localizedSessionSceneLabel(sceneType?: string): string {
  const label = sessionSceneLabel(sceneType);
  const key = ({ "Direct message": "direct_message", "Channel topic": "channel_topic", "Work run": "work_run", Intake: "intake", Session: "session" } as const)[label as "Direct message" | "Channel topic" | "Work run" | "Intake" | "Session"];
  return key ? i18n.t(`enums.${key}`) : label;
}

function localizedSessionTokenLabel(session: SessionExplorerSessionSummary): string {
  const total = session.tokenInputTotal + session.tokenOutputTotal + session.tokenCacheTotal;
  return total > 0 ? i18n.t("common.tokens", { count: total.toLocaleString(currentUiLocale()) }) : i18n.t("common.noUsage");
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return i18n.t("sessionsPage.noTimestamp");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(currentUiLocale());
}

function modelDisplay(session: SessionExplorerSessionSummary): string {
  return [session.modelProvider, session.modelId].filter(Boolean).join(" / ") || i18n.t("sessionsPage.noModel");
}
