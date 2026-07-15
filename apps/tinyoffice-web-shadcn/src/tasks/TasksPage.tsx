import { executeTasksRunAction, executeWorkTaskLifecycleAction, getTasksViewModel, type WorkTaskLifecycleAction } from "@/api/tasksClient";
import { Badge } from "@/components/ui/badge";
import { EmployeeAvatar } from "@/components/product/EmployeeAvatar";
import { Button } from "@/components/ui/button";
import { ProductState } from "@/components/product/ProductState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { navigationHref, shouldUseClientNavigation, tasksHref, type NavigationReturnContext, type NavigationTarget } from "@/app/navigationRoutes";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, ArrowLeft, ArrowUpDown, Clock3, Filter, MessageCircle, PlugZap, RefreshCw, Search, Undo2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { currentUiLocale } from "@/i18n";
import type { TFunction } from "i18next";
import type {
  TasksAction,
  TasksSortMode,
  TasksStatusFilter,
  TasksTaskDetail,
  TasksTaskListItem,
  TasksViewModel,
  TinyOfficeCurrentSession,
} from "tinyoffice/frontend-api-contracts";

type Selection =
  | { kind: "task"; id: string }
  | { kind: undefined };

type TaskTimeFilter = "" | "24h" | "3d" | "7d";
type TaskListView = "current" | "scheduled" | "history";

const TASK_TIME_FILTERS: Array<{ value: TaskTimeFilter; label: string }> = [
  { value: "", label: "Any time" },
  { value: "24h", label: "24h" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
];

export interface TaskFocus {
  workTaskId?: string;
}

function tasksQueryPlaceholderData(previousData: TasksViewModel | undefined): TasksViewModel | undefined {
  return previousData;
}

export function TasksPage({
  currentSession,
  focus,
  returnContext,
  onOpenNavigationTarget,
  onClearReturnContext,
}: {
  currentSession?: TinyOfficeCurrentSession;
  focus?: TaskFocus;
  returnContext?: NavigationReturnContext;
  onOpenNavigationTarget?: (target: NavigationTarget) => void;
  onClearReturnContext?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const [view, setView] = useState<TaskListView>("current");
  const [sort, setSort] = useState<TasksSortMode>("recent");
  const [owner, setOwner] = useState("");
  const [query, setQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<TaskTimeFilter>("");
  const [selection, setSelection] = useState<Selection>(focus?.workTaskId ? { kind: "task", id: focus.workTaskId } : { kind: undefined });

  useEffect(() => {
    setSelection(focus?.workTaskId ? { kind: "task", id: focus.workTaskId } : { kind: undefined });
  }, [focus?.workTaskId]);

  function selectTask(nextSelection: Selection): void {
    onClearReturnContext?.();
    setSelection(nextSelection);
    window.history.pushState({}, "", nextSelection.kind === "task" ? tasksHref({ taskId: nextSelection.id }) : tasksHref());
  }

  function clearTaskSelection(): void {
    onClearReturnContext?.();
    setSelection({ kind: undefined });
    window.history.pushState({}, "", tasksHref());
  }
  const queryInput = {
    status: "all" as TasksStatusFilter,
    sort,
    workTaskId: selection.kind === "task" ? selection.id : undefined,
  };
  const tasksQuery = useQuery({
    queryKey: chatQueryKeys.tasks(companyId, queryInput),
    enabled: Boolean(companyId),
    queryFn: () => getTasksViewModel({ companyId, ...queryInput }),
    placeholderData: tasksQueryPlaceholderData,
    refetchInterval: (query) => query.state.data?.refresh.indexIntervalMs,
  });
  const model = tasksQuery.data;
  const viewCounts = useMemo(() => taskViewCounts(model?.tasks ?? []), [model?.tasks]);
  const rows = useMemo(
    () => visibleTaskRows(model?.tasks ?? [], { view, owner, query, timeFilter }),
    [model?.tasks, view, owner, query, timeFilter],
  );
  const selected = model?.selected;
  const selectedTask = selection.kind === "task" && selected?.kind === "task" && selected.task.id === selection.id
    ? selected.task
    : undefined;
  const hasSourceReturn = Boolean(returnContext && onOpenNavigationTarget);
  const taskLifecycleMutation = useMutation({
    mutationFn: (input: { workTaskId: string; action: WorkTaskLifecycleAction; reason?: string }) =>
      executeWorkTaskLifecycleAction({
        companyId,
        workTaskId: input.workTaskId,
        action: input.action,
        reason: input.reason,
    }),
    onSuccess: async () => {
      await invalidateTasksRuntimeProjections(queryClient, companyId);
    },
  });
  const runActionMutation = useMutation({
    mutationFn: (action: TasksAction) => executeTasksRunAction({
      path: action.path,
      reason: action.id === "cancel-run" ? "Canceled from Tasks." : "Retried from Tasks.",
    }),
    onSuccess: async () => {
      await invalidateTasksRuntimeProjections(queryClient, companyId);
    },
  });

  return (
    <div className="tiny-soft-retro-tasks grid h-svh w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <header className="tiny-task-header flex items-center justify-between gap-3 border-b">
        <div className="min-w-0">
          <div className="tiny-room-title truncate">{selectedTask?.title ?? t("tasksPage.title")}</div>
          <div className="tiny-room-subtitle truncate">
            {selectedTask
              ? `${sourceLabel(selectedTask.sourceKind)} - ${taskOwnerLabel(selectedTask)}`
              : t("tasksPage.commandCenter")}
          </div>
        </div>
        {selectedTask ? (
          <div className="flex shrink-0 items-center gap-2">
            {returnContext && onOpenNavigationTarget ? (
              <Button asChild variant="ghost" size="sm" className="h-8 px-2">
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
                  href={tasksHref()}
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    if (!shouldUseClientNavigation(event)) {
                      return;
                    }
                    event.preventDefault();
                    clearTaskSelection();
                  }}
                >
                  <ArrowLeft className="mr-2 size-4" />
                  {t("tasksPage.backToList")}
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      <section className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--tiny-canvas)]">
        {selectedTask ? null : (
          <div className="grid gap-4 border-b border-[var(--tiny-line-faint)] bg-[var(--tiny-canvas)] px-6 pb-5 pt-4">
            {view === "current" ? <TaskAttentionZone tasks={(model?.tasks ?? []).filter(taskNeedsAttention)} onSelect={selectTask} /> : null}
            <div className="tiny-task-filter-panel"><TaskViewTabs view={view} counts={viewCounts} onViewChange={(value) => { setView(value); clearTaskSelection(); }} />
            {(model?.tasks.length ?? 0) > 0 ? <TasksToolbar
              model={model}
              owner={owner}
              query={query}
              sort={sort}
              timeFilter={timeFilter}
              onOwnerChange={(value) => {
                setOwner(value);
                clearTaskSelection();
              }}
              onQueryChange={(value) => {
                setQuery(value);
                clearTaskSelection();
              }}
              onSortChange={(value) => {
                setSort(value);
                clearTaskSelection();
              }}
              onTimeFilterChange={(value) => {
                setTimeFilter(value);
                clearTaskSelection();
              }}
            /> : null}</div>
          </div>
        )}
        <ScrollArea className="min-h-0 min-w-0">
          <div className="grid w-full gap-4 bg-[var(--tiny-canvas)] px-6 py-5">
            {tasksQuery.isLoading ? (
              <ProductState compact description={t("tasksPage.loading")} />
            ) : tasksQuery.error ? (
              <ProductState compact tone="error" description={tasksQuery.error instanceof Error ? tasksQuery.error.message : t("tasksPage.loadFailed")} />
            ) : selectedTask ? (
              <TaskDetail
                task={selectedTask}
                actionPending={taskLifecycleMutation.isPending}
                actionError={taskLifecycleMutation.error instanceof Error ? taskLifecycleMutation.error.message : undefined}
                onTaskAction={(workTaskId, action, reason) => taskLifecycleMutation.mutate({ workTaskId, action, reason })}
                onRunAction={(action) => runActionMutation.mutate(action)}
                runActionPending={runActionMutation.isPending}
                runActionError={runActionMutation.error instanceof Error ? runActionMutation.error.message : undefined}
                onOpenNavigationTarget={onOpenNavigationTarget}
              />
            ) : rows.length ? (
              <TaskOperationsTable
                rows={rows}
                view={view}
                selected={selection}
                onSelect={selectTask}
              />
            ) : (
              model && model.tasks.length === 0
                ? <TasksFirstEmptyState />
                : view === "scheduled" && !owner && !query && !timeFilter
                  ? <TasksViewEmptyState title={t("tasksPage.noScheduled")} description={t("tasksPage.noScheduledDescription")} />
                  : <TasksViewEmptyState title={t("tasksPage.noMatching")} description={t("tasksPage.noMatchingDescription")} />
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}

function TaskOwnerAvatar({ task, className }: { task: Pick<TasksTaskListItem, "ownerMemberId" | "ownerDisplayName" | "ownerAvatarSeed">; className: string }): ReactElement {
  return <EmployeeAvatar memberId={task.ownerMemberId} avatarSeed={task.ownerAvatarSeed ?? task.ownerMemberId} displayName={taskOwnerLabel(task)} className={className} />;
}

function taskOwnerLabel(task: Pick<TasksTaskListItem, "ownerDisplayName">): string {
  return task.ownerDisplayName?.trim() || "Unknown owner";
}

function TasksFirstEmptyState(): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="tiny-task-empty grid justify-items-center gap-3 rounded-lg border border-dashed px-5 py-10 text-center">
      <div className="text-sm font-medium">{t("tasksPage.noTasks")}</div>
      <p className="max-w-xl text-sm leading-6 text-muted-foreground">
        {t("tasksPage.noTasksDescription")}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild size="sm" className="tiny-task-primary-action"><a href="/chat"><MessageCircle />{t("tasksPage.openChat")}</a></Button>
        <Button asChild size="sm" variant="outline" className="tiny-task-quiet-action"><a href="/integrations"><PlugZap />{t("tasksPage.viewIntegrations")}</a></Button>
      </div>
    </div>
  );
}

function TaskAttentionZone({ tasks, onSelect }: { tasks: TasksTaskListItem[]; onSelect(selection: Selection): void }): ReactElement | null {
  const { t } = useTranslation();
  if (!tasks.length) return null;
  return <section className="tiny-task-attention">
    <div className="flex items-center gap-2 border-b border-[var(--tiny-line-faint)] px-4 py-2.5"><AlertTriangle className="size-4" /><strong className="text-sm">{t("tasksPage.needsAttention")}</strong><span className="text-xs text-muted-foreground">{t("tasksPage.waiting", { count: tasks.length })}</span></div>
    {tasks.map((task) => <div key={task.id} className="grid gap-3 px-4 py-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <TaskOwnerAvatar task={task} className="size-11" /><div className="min-w-0"><div className="truncate text-base font-semibold">{task.title}</div><p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{attentionHintForTask(task)}</p><div className="mt-2 text-xs text-muted-foreground">{taskOwnerLabel(task)} · {formatDateTime(task.updatedAt)}</div></div>
      <Button type="button" size="sm" className="tiny-task-attention-action" onClick={() => onSelect({ kind: "task", id: task.id })}>{t("tasksPage.reviewTask")}</Button>
    </div>)}
  </section>;
}

function TasksViewEmptyState({ title, description }: { title: string; description: string }): ReactElement {
  return <div className="tiny-task-empty"><Clock3 className="size-5" /><div className="font-semibold">{title}</div><p>{description}</p></div>;
}

function TaskViewTabs({ view, counts, onViewChange }: { view: TaskListView; counts: ReturnType<typeof taskViewCounts>; onViewChange(value: TaskListView): void }): ReactElement {
  const { t } = useTranslation();
  return <div className="tiny-task-filter-row"><span>{t("tasksPage.view")}</span><Tabs value={view} onValueChange={(value) => onViewChange(value as TaskListView)}><TabsList className="h-auto gap-1 bg-transparent p-0"><TabsTrigger value="current">{t("tasksPage.current", { count: counts.current })}</TabsTrigger><TabsTrigger value="scheduled">{t("tasksPage.scheduled", { count: counts.scheduled })}</TabsTrigger><TabsTrigger value="history">{t("tasksPage.history", { count: counts.history })}</TabsTrigger></TabsList></Tabs></div>;
}

function TasksToolbar({
  model,
  owner,
  query,
  sort,
  timeFilter,
  onOwnerChange,
  onQueryChange,
  onSortChange,
  onTimeFilterChange,
}: {
  model?: TasksViewModel;
  owner: string;
  query: string;
  sort: TasksSortMode;
  timeFilter: TaskTimeFilter;
  onOwnerChange(value: string): void;
  onQueryChange(value: string): void;
  onSortChange(value: TasksSortMode): void;
  onTimeFilterChange(value: TaskTimeFilter): void;
}): ReactElement {
  const { t } = useTranslation();
  const ownerOptions = taskOwnerOptions(model?.tasks ?? []);
  return (
    <div className="tiny-task-controls flex flex-wrap items-center gap-2">
      <div className="relative min-w-[260px] flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} placeholder={t("tasksPage.search")} className="h-9 bg-[var(--tiny-surface)] pl-8" onChange={(event) => onQueryChange(event.currentTarget.value)} />
      </div>
      <Select value={owner || "all"} onValueChange={(value) => onOwnerChange(value === "all" ? "" : value)}>
        <SelectTrigger aria-label={t("tasksPage.filterOwner")} className="h-9 min-w-[138px] bg-[var(--tiny-surface)]"><SelectValue placeholder={t("tasksPage.ownerAll")} /></SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="all">{t("tasksPage.ownerAll")}</SelectItem>
          {ownerOptions.map((option) => <SelectItem key={option.ownerMemberId} value={option.ownerMemberId}>{option.displayName} ({option.count})</SelectItem>)}
        </SelectContent>
      </Select>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="h-9 gap-2 bg-[var(--tiny-surface)]"><Filter className="size-4" />{t("tasksPage.moreFilters")}{timeFilter ? " · 1" : ""}</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <div className="text-xs font-semibold uppercase text-muted-foreground">{t("tasksPage.updated")}</div>
          <div className="flex flex-wrap gap-1">
            {TASK_TIME_FILTERS.map((filter) => <TaskFilterChip key={filter.value || "any-time"} active={timeFilter === filter.value} onClick={() => onTimeFilterChange(filter.value)}>{localizedTimeFilter(filter.value, t)}</TaskFilterChip>)}
          </div>
        </PopoverContent>
      </Popover>
      <div className="ml-auto flex items-center gap-2">
        <ArrowUpDown className="size-4 text-muted-foreground" />
        <Select value={sort} onValueChange={(value) => onSortChange(value as TasksSortMode)}>
          <SelectTrigger aria-label={t("tasksPage.sort")} className="h-9 min-w-[132px] bg-[var(--tiny-surface)]"><SelectValue /></SelectTrigger>
          <SelectContent align="end">
            {(model?.sortOptions ?? [{ id: "recent", label: "Recent" }]).map((option) => <SelectItem key={option.id} value={option.id}>{t("tasksPage.sortPrefix", { label: t(`enums.${option.id}`, { defaultValue: option.label }) })}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function TaskFilterChip({ active, children, onClick }: { active: boolean; children: ReactNode; onClick(): void }): ReactElement {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function localizedTimeFilter(value: TaskTimeFilter, t: TFunction): string {
  if (!value) return t("tasksPage.anyTime");
  if (value === "24h") return "24h";
  return t("tasksPage.days", { count: Number.parseInt(value, 10) });
}

function taskViewCounts(tasks: TasksTaskListItem[]): { current: number; attention: number; scheduled: number; history: number } {
  return {
    current: tasks.filter((task) => task.status === "active").length,
    attention: tasks.filter((task) => task.status === "active" && taskNeedsAttention(task)).length,
    scheduled: tasks.filter((task) => task.status === "active" && task.schedule.status === "enabled").length,
    history: tasks.filter((task) => task.status !== "active").length,
  };
}

function taskMatchesView(task: TasksTaskListItem, view: TaskListView): boolean {
  if (view === "current") return task.status === "active";
  if (view === "scheduled") return task.status === "active" && task.schedule.status === "enabled";
  return task.status !== "active";
}

function visibleTaskRows(
  tasks: TasksTaskListItem[],
  filters: { view: TaskListView; owner: string; query: string; timeFilter: TaskTimeFilter; now?: Date },
): TasksTaskListItem[] {
  const owner = filters.owner.trim();
  const query = filters.query.trim().toLocaleLowerCase();
  const nowMs = filters.now?.getTime() ?? Date.now();
  return tasks.filter((task) => {
    if (!taskMatchesView(task, filters.view)) {
      return false;
    }
    if (owner && task.ownerMemberId !== owner) {
      return false;
    }
    if (!taskMatchesTimeFilter(task, filters.timeFilter, nowMs)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      task.title,
      task.acceptanceCriteria,
      task.ownerMemberId,
      task.sourceKind,
      task.nextStep,
      task.id,
      task.latestExecution?.id,
      task.latestExecution?.status,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

function taskNeedsAttention(task: TasksTaskListItem): boolean {
  return displayStatusForTask(task).label === "Needs attention";
}

function taskMatchesTimeFilter(task: TasksTaskListItem, filter: TaskTimeFilter, nowMs: number): boolean {
  if (!filter) {
    return true;
  }
  const taskMs = new Date(task.updatedAt).getTime();
  if (Number.isNaN(taskMs)) {
    return false;
  }
  const rangeMs = filter === "24h"
    ? 24 * 60 * 60 * 1000
    : filter === "3d"
      ? 3 * 24 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;
  return nowMs - taskMs <= rangeMs;
}

function taskOwnerOptions(tasks: TasksTaskListItem[]): Array<{ ownerMemberId: string; displayName: string; count: number }> {
  const counts = new Map<string, { displayName: string; count: number }>();
  for (const task of tasks) {
    const owner = task.ownerMemberId?.trim();
    if (!owner) {
      continue;
    }
    const current = counts.get(owner);
    counts.set(owner, { displayName: taskOwnerLabel(task), count: (current?.count ?? 0) + 1 });
  }
  return [...counts.entries()]
    .map(([ownerMemberId, value]) => ({ ownerMemberId, ...value }))
    .sort((left, right) => right.count - left.count || left.displayName.localeCompare(right.displayName));
}

function TaskOperationsTable({
  rows,
  view,
  selected,
  onSelect,
}: {
  rows: TasksTaskListItem[];
  view: TaskListView;
  selected: Selection;
  onSelect(selection: Selection): void;
}): ReactElement {
  const { t } = useTranslation();
  const groups = taskRowGroups(rows, view, t);
  return (
    <div className="tiny-task-table overflow-hidden rounded-lg border border-[var(--tiny-line)] bg-[var(--tiny-surface)]">
      <div className="tiny-task-table-title"><strong>{t("tasksPage.allTasks")}</strong><span>{t("tasksPage.visible", { count: rows.length })}</span></div>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 px-4 text-[10px] uppercase text-muted-foreground">{t("tasksPage.task")}</TableHead>
            <TableHead className="h-8 w-[170px] px-3 text-[10px] uppercase text-muted-foreground">{t("tasksPage.state")}</TableHead>
            <TableHead className="h-8 w-[160px] px-3 text-[10px] uppercase text-muted-foreground">{t("tasksPage.owner")}</TableHead>
            <TableHead className="h-8 w-[360px] px-3 text-[10px] uppercase text-muted-foreground">{view === "history" ? t("common.outcome") : t("common.nextAction")}</TableHead>
            <TableHead className="h-8 w-[168px] px-4 text-right text-[10px] uppercase text-muted-foreground">{t("tasksPage.updated")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => <Fragment key={group.id}>{group.label ? <TaskGroupRow label={group.label} count={group.rows.length} tone={group.id === "attention" ? "attention" : undefined} /> : null}{group.rows.map((row) => <TaskOperationRow key={row.id} task={row} view={view} selected={selected} onSelect={onSelect} />)}</Fragment>)}
        </TableBody>
      </Table>
    </div>
  );
}

function TaskOperationRow({ task, view, selected, onSelect }: { task: TasksTaskListItem; view: TaskListView; selected: Selection; onSelect(selection: Selection): void }): ReactElement {
  const hint = attentionHintForTask(task);
  return (
    <TableRow data-state={selected.kind !== undefined && selected.id === task.id ? "selected" : undefined} className="cursor-pointer" onClick={() => onSelect({ kind: "task", id: task.id })}>
      <TableCell className="max-w-0 px-4 py-3">
        <a href={tasksHref({ taskId: task.id })} className="block truncate text-sm font-semibold text-foreground hover:underline" onClick={(event) => {
          if (!shouldUseClientNavigation(event)) return;
          event.preventDefault();
          event.stopPropagation();
          onSelect({ kind: "task", id: task.id });
        }}>{task.title}</a>
        <div className="truncate text-xs text-muted-foreground" title={hint ?? nextActionForTask(task, view)}>{hint ?? nextActionForTask(task, view)}</div>
      </TableCell>
      <TableCell className="px-3 py-3"><TaskStateBadge task={task} view={view} /></TableCell>
      <TableCell className="max-w-0 px-3 py-3"><div className="flex items-center gap-2"><TaskOwnerAvatar task={task} className="size-6" /><div className="truncate text-xs">{taskOwnerLabel(task)}</div></div></TableCell>
      <TableCell className="max-w-0 px-3 py-3"><div className="truncate text-xs text-muted-foreground" title={nextActionForTask(task, view)}>{nextActionForTask(task, view)}</div></TableCell>
      <TableCell className="max-w-0 px-4 py-3 text-right"><div className="truncate text-xs text-muted-foreground" title={formatDateTime(task.updatedAt)}>{formatDateTime(task.updatedAt)}</div></TableCell>
    </TableRow>
  );
}

function TaskGroupRow({ label, count, tone }: { label: string; count: number; tone?: "attention" }): ReactElement {
  return <TableRow className="tiny-task-group-row"><TableCell colSpan={5} className="h-9 px-4 py-1.5"><div className="flex items-center gap-2 text-sm font-semibold">{tone === "attention" ? <AlertTriangle className="size-4" /> : <Clock3 className="size-4" />}{label}<Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1.5 tabular-nums">{count}</Badge></div></TableCell></TableRow>;
}

function TaskStateBadge({ task, view }: { task: TasksTaskListItem; view: TaskListView }): ReactElement {
  const { t } = useTranslation();
  const display = view === "scheduled" ? { label: t("tasksPage.scheduledLabel") } : displayStatusForTask(task);
  const stableClass = view === "scheduled" ? "scheduled" : display.label.toLowerCase().replaceAll(" ", "-");
  return <Badge variant="outline" className={`tiny-task-status ${stableClass}`}>{localizedTaskStatus(display.label, t)}</Badge>;
}

function localizedTaskStatus(label: string, t: TFunction): string {
  const key = ({ Archived: "archived", Canceled: "canceled", Completed: "completed", Running: "running", Pending: "pending", Open: "open", "Needs attention": "needsAttention" } as const)[label as "Archived" | "Canceled" | "Completed" | "Running" | "Pending" | "Open" | "Needs attention"];
  return key ? t(`enums.${key}`) : label;
}

function taskRowGroups(rows: TasksTaskListItem[], view: TaskListView, t: TFunction): Array<{ id: string; label?: string; rows: TasksTaskListItem[] }> {
  if (view !== "current") return [{ id: view, rows }];
  const attention = rows.filter(taskNeedsAttention);
  const upNext = rows.filter((task) => !taskNeedsAttention(task));
  return [...(attention.length ? [{ id: "attention", label: t("tasksPage.needsAttention"), rows: attention }] : []), ...(upNext.length ? [{ id: "up-next", label: t("common.upNext"), rows: upNext }] : [])];
}

function nextActionForTask(task: TasksTaskListItem, view: TaskListView): string {
  if (view === "scheduled") return scheduleSummaryForTask(task);
  if (view === "history") return task.nextStep || `${runsSummaryForTask(task)} recorded`;
  return task.latestExecution?.nextStep || task.nextStep;
}

function TaskDetail({
  task,
  actionPending,
  actionError,
  onTaskAction,
  onRunAction,
  runActionPending,
  runActionError,
  onOpenNavigationTarget,
}: {
  task: TasksTaskDetail;
  actionPending: boolean;
  actionError?: string;
  onTaskAction(workTaskId: string, action: WorkTaskLifecycleAction, reason?: string): void;
  onRunAction(action: TasksAction): void;
  runActionPending: boolean;
  runActionError?: string;
  onOpenNavigationTarget?: (target: NavigationTarget) => void;
}): ReactElement {
  const { t } = useTranslation();
  const actions = workTaskActions(task.status);
  const [confirmingAction, setConfirmingAction] = useState<WorkTaskLifecycleAction | undefined>();
  const [confirmingRunAction, setConfirmingRunAction] = useState<TasksAction | undefined>();
  const cancelAction = actions.find((action) => action.id === "cancel");
  const sourceNavigationTarget = navigationTargetForSourceLink(task.sourceLink);
  return (
    <div className="tiny-task-detail grid min-w-0 gap-4 overflow-hidden p-4">
      <section className="tiny-task-current-state grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0"><div className="text-xs font-bold uppercase tracking-wide">{t("tasksPage.whatNext")}</div><p className="mt-1 break-words text-sm leading-6">{task.nextStep}</p><div className="mt-2 flex items-center gap-2"><TaskOwnerAvatar task={task} className="size-7" /><span className="text-xs font-medium">{taskOwnerLabel(task)}</span><span className="text-xs text-muted-foreground">· {formatDateTime(task.updatedAt)}</span></div></div>
        <StatusBadge status={displayStatusForTask(task).label} />
      </section>
      {actions.length ? (
        <div className="flex flex-wrap justify-end gap-2">
          {actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant={action.id === "cancel" ? "destructive" : "secondary"}
              disabled={actionPending}
              onClick={() => {
                if (action.id === "cancel") {
                  setConfirmingAction(action.id);
                  return;
                }
                onTaskAction(task.id, action.id, action.reason);
              }}
            >
              <WorkTaskActionIcon id={action.id} />
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
      <Dialog open={confirmingAction === "cancel"} onOpenChange={(open) => setConfirmingAction(open ? "cancel" : undefined)}>
        <DialogContent className="tiny-task-dialog">
          <DialogHeader>
            <DialogTitle>{t("tasksPage.cancelTask")}</DialogTitle>
            <DialogDescription>
              {t("tasksPage.cancelTaskDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-fill)] px-3 py-2 text-sm">
            <div className="font-medium">{task.title}</div>
            <div className="mt-1 text-muted-foreground">{task.id}</div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmingAction(undefined)}>
              {t("tasksPage.keepTask")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={actionPending || !cancelAction}
              onClick={() => {
                if (!cancelAction) {
                  return;
                }
                onTaskAction(task.id, cancelAction.id, cancelAction.reason);
                setConfirmingAction(undefined);
              }}
            >
              {t("tasksPage.cancelTask")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmingRunAction?.id === "cancel-run"} onOpenChange={(open) => !open && setConfirmingRunAction(undefined)}>
        <DialogContent className="tiny-task-dialog">
          <DialogHeader>
            <DialogTitle>{t("tasksPage.cancelExecution")}</DialogTitle>
            <DialogDescription>
              {t("tasksPage.cancelExecutionDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmingRunAction(undefined)}>
              {t("tasksPage.keepRunning")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={runActionPending || !confirmingRunAction}
              onClick={() => {
                if (confirmingRunAction) {
                  onRunAction(confirmingRunAction);
                }
                setConfirmingRunAction(undefined);
              }}
            >
              {t("tasksPage.cancelExecutionAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {actionError || runActionError ? <div className="tiny-task-error text-sm text-destructive">{actionError || runActionError}</div> : null}
      <DetailSection title={t("tasksPage.currentState")}>
        <FactRow label={t("tasksPage.status")} value={displayStatusForTask(task).label} />
        <FactRow label={t("tasksPage.owner")} value={taskOwnerLabel(task)} />
        <FactRow label={t("tasksPage.latestUpdate")} value={formatDateTime(task.updatedAt)} />
      </DetailSection>
      <DetailSection title={t("tasksPage.objective")}>
        <FactRow label={t("tasksPage.revision")} value={`v${task.revision}`} />
        {task.description ? <FactRow label={t("tasksPage.brief")} value={task.description} /> : null}
        <FactRow label={t("tasksPage.acceptance")} value={task.acceptanceCriteria} />
      </DetailSection>
      <DetailSection title={t("tasksPage.revisionHistory")} summary={`${task.revisions.length} confirmed objective version${task.revisions.length === 1 ? "" : "s"}`}>
        {task.revisions.map((revision) => (
          <FactRow
            key={revision.revision}
            label={`v${revision.revision}`}
            value={`${revision.title} — ${revision.reason} (${revision.changedByMemberId}, ${formatDateTime(revision.createdAt)})`}
          />
        ))}
      </DetailSection>
      <DetailSection title={t("tasksPage.source")} summary={sourceLabel(task.sourceKind)}>
        <FactRow label={t("tasksPage.source")} value={sourceLabel(task.sourceKind)} />
        {task.sourceLink ? <FactRow label={t("tasksPage.reference")} value={task.sourceLink.label} /> : null}
        {sourceNavigationTarget ? (
          <Button asChild size="xs" variant="outline" className="w-fit">
            <a
              href={navigationHref(sourceNavigationTarget)}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                if (!onOpenNavigationTarget || !shouldUseClientNavigation(event)) {
                  return;
                }
                event.preventDefault();
                onOpenNavigationTarget(sourceNavigationTarget);
              }}
            >
              {t("tasksPage.openSourceDiscussion")}
            </a>
          </Button>
        ) : null}
      </DetailSection>
      <DetailSection title={t("tasksPage.schedule")} summary={scheduleSummaryForTask(task)}>
        {task.scheduleRecord ? (
          <FactRow
            label={scheduleLabelForKind(task.scheduleRecord.kind)}
            value={`${statusLabel(task.scheduleRecord.status)} - ${nextStepForSchedule(task.scheduleRecord)}`}
          />
        ) : <EmptyLine>{t("tasksPage.noSchedule")}</EmptyLine>}
      </DetailSection>
      <DetailSection title={t("tasksPage.executionHistory")} summary={runsSummaryForTask(task)}>
        {task.executions.length ? task.executions.map((run) => (
          <div key={run.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <FactRow
                label={statusLabel(run.status)}
                value={`${run.id} · Task v${run.taskRevision} - ${run.nextStep}`}
              />
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              {run.actions.filter((action) => action.enabled).map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  size="xs"
                  variant={action.id === "cancel-run" ? "destructive" : "outline"}
                  disabled={runActionPending}
                  onClick={() => {
                    if (action.id === "cancel-run") {
                      setConfirmingRunAction(action);
                      return;
                    }
                    onRunAction(action);
                  }}
                >
                  {action.id === "cancel-run" ? <X className="size-3.5" /> : <RefreshCw className="size-3.5" />}
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        )) : <EmptyLine>{t("tasksPage.noExecutionHistory")}</EmptyLine>}
      </DetailSection>
    </div>
  );
}

function workTaskActions(status: TasksTaskDetail["status"]): Array<{ id: WorkTaskLifecycleAction; label: string; reason?: string }> {
  if (status === "archived") {
    return [{ id: "restore", label: "Restore" }];
  }
  if (status === "active") {
    return [{ id: "cancel", label: "Cancel Task", reason: "Canceled from Tasks." }];
  }
  if (status === "completed" || status === "canceled") {
    return [{ id: "archive", label: "Archive", reason: "Archived from Tasks." }];
  }
  return [];
}

function WorkTaskActionIcon({ id }: { id: WorkTaskLifecycleAction }): ReactElement {
  if (id === "archive") return <Archive className="size-4" />;
  if (id === "restore") return <Undo2 className="size-4" />;
  return <X className="size-4" />;
}

function DetailSection({ title, summary, children }: { title: string; summary?: string; children: ReactNode }): ReactElement {
  return (
    <section className="grid min-w-0 gap-2 overflow-hidden rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-fill)] px-3 py-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {summary ? <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{summary}</p> : null}
      </div>
      <div className="grid min-w-0 gap-1.5 overflow-hidden">{children}</div>
    </section>
  );
}

function FactRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="grid min-w-0 gap-1 overflow-hidden rounded-md bg-[var(--tiny-surface)] px-2 py-1.5">
      <span className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</span>
      <span className="break-words text-xs leading-5 [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): ReactElement {
  const variant = status === "failed" || status === "canceled" ? "destructive" : status === "blocked" ? "outline" : "secondary";
  return <Badge variant={variant} className="max-w-full whitespace-normal text-center leading-tight [overflow-wrap:anywhere]">{statusLabel(status)}</Badge>;
}

function navigationTargetForSourceLink(sourceLink: TasksTaskDetail["sourceLink"]): NavigationTarget | undefined {
  const conversationId = sourceLink?.conversationId?.trim();
  if (!conversationId) {
    return undefined;
  }
  return { kind: "chat-room", roomId: conversationId };
}

function displayStatusForTask(task: TasksTaskListItem | TasksTaskDetail): { label: string; tone?: "attention" | "danger" } {
  if (task.status === "archived") return { label: "Archived" };
  if (task.status === "canceled") return { label: "Canceled", tone: "danger" };
  if (task.status === "completed") return { label: "Completed" };

  const latestRun = task.latestExecution;
  if (latestRun?.status === "blocked" || latestRun?.status === "failed") {
    return { label: "Needs attention", tone: latestRun.status === "failed" ? "danger" : "attention" };
  }
  if (latestRun?.status === "in_progress") return { label: "Running" };
  if (latestRun?.status === "queued") return { label: "Pending" };
  if (latestRun?.status === "done" && !hasFutureSchedule(task)) return { label: "Completed" };

  const nextStep = task.nextStep.toLowerCase();
  if (nextStep.includes("participant input") || nextStep.includes("failed")) {
    return { label: "Needs attention", tone: "attention" };
  }
  if (nextStep.includes("in progress") || nextStep.includes("executing")) return { label: "Running" };
  if (nextStep.includes("queued") || nextStep.includes("dispatch") || nextStep.includes("next scheduled") || nextStep.includes("next schedule")) {
    return { label: "Pending" };
  }
  return { label: "Open" };
}

function sourceLabel(sourceKind: TasksTaskListItem["sourceKind"]): string {
  if (sourceKind === "intake_event") return "Intake";
  if (sourceKind === "chat_request") return "Chat";
  return "Manual";
}

function scheduleSummaryForTask(task: TasksTaskListItem | TasksTaskDetail): string {
  const label = task.schedule.ruleSummary || scheduleLabelForKind(task.schedule.kind);
  if (task.schedule.nextRunAt) {
    return `${label} - next ${formatDateTime(task.schedule.nextRunAt)}`;
  }
  if (task.schedule.status === "completed") {
    return `${label} - completed`;
  }
  if (task.schedule.status) {
    return `${label} - ${statusLabel(task.schedule.status)}`;
  }
  return label;
}

function runsSummaryForTask(task: TasksTaskListItem | TasksTaskDetail): string {
  const count = task.executionCount;
  return `${count} run${count === 1 ? "" : "s"}`;
}

function attentionHintForTask(task: TasksTaskListItem | TasksTaskDetail): string | undefined {
  const display = displayStatusForTask(task);
  if (display.label !== "Needs attention") return undefined;
  return task.latestExecution?.nextStep || task.nextStep;
}

function hasFutureSchedule(task: TasksTaskListItem | TasksTaskDetail): boolean {
  return task.schedule.status === "enabled";
}

function nextStepForSchedule(schedule: NonNullable<TasksTaskDetail["scheduleRecord"]>): string {
  if (schedule.nextRunAt) {
    return `Next run ${formatDateTime(schedule.nextRunAt)}`;
  }
  return schedule.nextStep;
}

function scheduleLabelForKind(scheduleKind: string): string {
  if (scheduleKind === "none") return "None";
  if (scheduleKind === "scheduled_once") return "Scheduled once";
  if (scheduleKind === "recurring") return "Recurring";
  if (scheduleKind === "immediate") return "Immediate";
  return statusLabel(scheduleKind);
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "No timestamp";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(currentUiLocale());
}


function EmptyLine({ children }: { children: string }): ReactElement {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

async function invalidateTasksRuntimeProjections(
  queryClient: ReturnType<typeof useQueryClient>,
  companyId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: chatQueryKeys.tasksScope(companyId) }),
    queryClient.invalidateQueries({ queryKey: chatQueryKeys.employeeRuntimeSummary(companyId) }),
    queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessionsScope(companyId) }),
  ]);
}
