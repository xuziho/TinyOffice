import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { EmployeeAvatar } from "@/components/product/EmployeeAvatar";
import { RuntimeActivityList } from "@/activity/RuntimeActivityList";
import { navigationHref, shouldUseClientNavigation, tasksHref, type NavigationTarget } from "@/app/navigationRoutes";
import type { ChatChannelMemberDto, CompanyDirectoryMemberEntryDto, EmployeeRuntimeSummaryCard, RuntimeActivityItem } from "tinyoffice/frontend-api-contracts";
import { FileTextIcon, ListTodoIcon, SettingsIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { currentUiLocale, i18n } from "@/i18n";
import type { ChatRelatedTask, ChatShellEvidence, ChatShellModel } from "./chatShellModel";
import { contextPanelRuntimeMode } from "./contextPanelMode";
import type { ActivitySourceSummary } from "./useChatWorkspace";

export function ContextPanel({
  model,
  activityItems,
  hasActivitySource,
  activitySource,
  activityIsPrevious,
  onOpenSession,
  onOpenNavigationTarget,
  onUpdateChannelDetails,
  onAddChannelMembers,
  onRemoveChannelMember,
  onDissolveChannel,
}: {
  model: ChatShellModel;
  activityItems: RuntimeActivityItem[];
  hasActivitySource: boolean;
  activitySource?: ActivitySourceSummary;
  activityIsPrevious?: boolean;
  onOpenSession?: (input: { employeeId?: string; sessionId?: string; query?: string }) => void;
  onOpenNavigationTarget?: (target: NavigationTarget) => void;
  onUpdateChannelDetails?: (input: { title: string; summary?: string }) => Promise<void>;
  onAddChannelMembers?: (members: CompanyDirectoryMemberEntryDto[]) => Promise<void>;
  onRemoveChannelMember?: (member: ChatChannelMemberDto) => Promise<void>;
  onDissolveChannel?: (confirmation: "DELETE") => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const runtimeMode = contextPanelRuntimeMode(model);
  const directMessageMember = directMessageMemberForContext(model);
  const shouldShowDirectMessageRuntimeSummary = model.surface.kind === "dm-directory";
  const directMessageRuntimeSummary = shouldShowDirectMessageRuntimeSummary && directMessageMember
    ? runtimeSummaryForMember(model, directMessageMember.memberId)
    : undefined;
  const isChannelContext = model.context.room.kind === "channel" && model.selectedContainer?.kind === "channel";
  const hasChannelSettings = isChannelContext;
  return (
    <aside className="tiny-context flex h-full min-w-0 max-w-full flex-col overflow-hidden border-l">
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid min-w-0 max-w-full gap-[18px] overflow-hidden p-[14px]">
          <div className="flex min-w-0 max-w-full items-start gap-2 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-hidden">
              {directMessageMember ? (
                <DirectMessageContextHeader
                  member={directMessageMember}
                  showSessions={runtimeMode.showParticipantSessions}
                  model={model}
                  onOpenSession={onOpenSession}
                />
              ) : isChannelContext ? (
                <ChannelContextHeader model={model} />
              ) : model.context.room.kind === "workspace" ? (
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 overflow-hidden">
                  <Badge variant="outline">{contextKindLabel(model.context.room.kind)}</Badge>
                  {model.context.room.subtitle ? <ContextText className="text-xs text-muted-foreground">{model.context.room.subtitle}</ContextText> : null}
                </div>
              ) : null}
            </div>
            {hasChannelSettings ? (
              <ChannelSettingsDialog
                model={model}
                onUpdateChannelDetails={onUpdateChannelDetails}
                onAddChannelMembers={onAddChannelMembers}
                onRemoveChannelMember={onRemoveChannelMember}
                onDissolveChannel={onDissolveChannel}
              />
            ) : null}
          </div>
          {directMessageMember?.summary ? <SummarySection summary={directMessageMember.summary} /> : null}
          {directMessageRuntimeSummary ? <DirectMessageWorkSummary summary={directMessageRuntimeSummary} onOpenNavigationTarget={onOpenNavigationTarget} /> : null}
          <RelatedTasksSection tasks={model.context.relatedTasks} onOpenNavigationTarget={onOpenNavigationTarget} />
          {shouldShowParticipants(model) ? <ParticipantsSection model={model} showSessions={runtimeMode.showParticipantSessions} onOpenSession={onOpenSession} /> : null}
          {runtimeMode.showActivityDock ? <ActivityDock activityItems={activityItems} hasActivitySource={hasActivitySource} activitySource={activitySource} activityIsPrevious={activityIsPrevious} /> : null}
          <EvidenceSection title={t("chat.workRuns")} items={model.context.evidence.workRuns} />
          <EvidenceSection title={t("chat.files")} items={model.context.evidence.files} />
          <EvidenceSection title={t("chat.otherEvidence")} items={model.context.evidence.other} />
        </div>
      </ScrollArea>
    </aside>
  );
}

function ChannelContextHeader({ model }: { model: ChatShellModel }): ReactElement {
  const { t } = useTranslation();
  return (
    <section className="grid min-w-0 gap-2">
      <div className="tiny-context-section-label">{t("chat.purpose")}</div>
      {model.context.room.subtitle ? (
        <ContextText className="tiny-context-note">{model.context.room.subtitle}</ContextText>
      ) : (
        <ContextText className="tiny-context-note">{t("chat.noPurpose")}</ContextText>
      )}
    </section>
  );
}

function DirectMessageContextHeader({
  member,
  showSessions,
  model,
  onOpenSession,
}: {
  member: CompanyDirectoryMemberEntryDto;
  showSessions: boolean;
  model: ChatShellModel;
  onOpenSession?: (input: { employeeId?: string; sessionId?: string; query?: string }) => void;
}): ReactElement {
  const { t } = useTranslation();
  const sessions = showSessions ? directMessageSessionsForMember(model, member.memberId) : [];
  return (
    <section className="grid min-w-0 gap-3">
      <div className="tiny-context-section-label">{t("chat.directMessage")}</div>
      <div className="tiny-context-row group grid min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden p-[5px]">
        <EmployeeAvatar memberId={member.memberId} avatarSeed={member.avatarSeed} displayName={member.displayName} className="size-6" />
        <div className="min-w-0 overflow-hidden">
          <div className="tiny-participant-name truncate">{member.displayName}</div>
          {member.role ? <div className="tiny-participant-role truncate">{member.role}</div> : null}
        </div>
        {showSessions && member.hasRuntimeProfile ? (
          <Button
            type="button"
            size="xs"
            variant={sessions.length > 0 ? "secondary" : "outline"}
            className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
            onClick={() => onOpenSession?.({
              employeeId: member.memberId,
              sessionId: sessions[0]?.targetId,
              query: sessions[0]?.targetId ? undefined : member.displayName,
            })}
            title={sessions[0]?.targetId ? t("chat.openSessionNamed", { id: sessions[0].targetId }) : t("chat.showSessionsFor", { name: member.displayName })}
          >
            <FileTextIcon className="size-3.5" aria-hidden="true" />
            {sessions.length > 0 ? t("chat.openSession") : t("chat.findSession")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function SummarySection({ summary }: { summary: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <section className="grid min-w-0 gap-2">
      <div className="tiny-context-section-label">{t("chat.summary")}</div>
      <ContextText className="tiny-context-note">{summary}</ContextText>
    </section>
  );
}

function DirectMessageWorkSummary({
  summary,
  onOpenNavigationTarget,
}: {
  summary: EmployeeRuntimeSummaryCard;
  onOpenNavigationTarget?: (target: NavigationTarget) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const current = compactCurrentWorkItems(summary.current).slice(0, 2);
  const issues = summary.issues.slice(0, 1);
  if (summary.status.kind === "idle" && current.length === 0 && issues.length === 0) {
    return null;
  }
  return (
    <section className="grid min-w-0 gap-2">
      <div className="tiny-context-section-label">{issues.length ? t("chat.blockedWork") : t("chat.currentWork")}</div>
      <div className="grid gap-1">
        {summary.status.kind !== "idle" && issues.length === 0 && current.length === 0 ? (
          <div className="tiny-runtime-work-row tiny-runtime-work-row-active">
            <div className="tiny-runtime-work-title">{summary.status.label}</div>
            <ContextText className="tiny-runtime-work-meta">{summary.status.reason}</ContextText>
          </div>
        ) : null}
        {issues.map((issue) => {
          const relatedTaskId = issue.relatedTarget?.kind === "work-task" ? issue.relatedTarget.id : undefined;
          return (
            <div key={`${issue.kind}:${issue.target.kind}:${issue.target.id}`} className="tiny-runtime-work-row tiny-runtime-work-row-blocked">
              <div className="tiny-runtime-work-title" title={issue.title}>{issue.title}</div>
              <ContextText className="tiny-runtime-work-meta line-clamp-2">{issue.summary}</ContextText>
              {relatedTaskId ? (
                <Button asChild size="xs" variant="ghost" className="tiny-runtime-work-action">
                  <a
                    href={tasksHref({ taskId: relatedTaskId })}
                    onClick={(event) => {
                      if (!onOpenNavigationTarget || !shouldUseClientNavigation(event)) {
                        return;
                      }
                      event.preventDefault();
                      onOpenNavigationTarget({ kind: "task", taskId: relatedTaskId });
                    }}
                  >
                    {t("chat.openTask")}
                  </a>
                </Button>
              ) : null}
            </div>
          );
        })}
        {issues.length === 0 ? current.map((item) => (
          <div key={`${item.kind}:${item.id}`} className="tiny-runtime-work-row tiny-runtime-work-row-active">
            <div className="tiny-runtime-work-title" title={item.title}>{item.title}</div>
            <div className="tiny-runtime-work-meta">{workItemLabel(item)}</div>
            {item.summary ? <ContextText className="tiny-runtime-work-meta line-clamp-2">{item.summary}</ContextText> : null}
            {runtimeWorkHref(item) ? (
              <Button asChild size="xs" variant="ghost" className="tiny-runtime-work-action">
                <a
                  href={runtimeWorkHref(item)}
                  onClick={(event) => {
                    const target = runtimeWorkTarget(item);
                    if (!onOpenNavigationTarget || !target || !shouldUseClientNavigation(event)) {
                      return;
                    }
                    event.preventDefault();
                    onOpenNavigationTarget(target);
                  }}
                >
                  {t("chat.open")}
                </a>
              </Button>
            ) : null}
          </div>
        )) : null}
      </div>
    </section>
  );
}

function compactCurrentWorkItems(items: EmployeeRuntimeSummaryCard["current"]): EmployeeRuntimeSummaryCard["current"] {
  const byTitle = new Map<string, EmployeeRuntimeSummaryCard["current"][number]>();
  for (const item of items) {
    const key = item.title.trim().toLocaleLowerCase() || item.id;
    const existing = byTitle.get(key);
    if (!existing || workItemRank(item.kind) < workItemRank(existing.kind)) {
      byTitle.set(key, item);
    }
  }
  return [...byTitle.values()];
}

function workItemRank(kind: EmployeeRuntimeSummaryCard["current"][number]["kind"]): number {
  return kind === "work-run" ? 0 : kind === "session" ? 1 : 2;
}

function workItemLabel(item: EmployeeRuntimeSummaryCard["current"][number]): string {
  if (item.kind === "work-run") {
    return item.status === "blocked" ? i18n.t("chat.workRunBlocked") : i18n.t("chat.workRunInProgress");
  }
  if (item.kind === "work-task") {
    return item.status === "active" ? i18n.t("chat.taskActive") : i18n.t("chat.taskStatus", { status: item.status });
  }
  return item.status === "running" ? i18n.t("chat.sessionRunning") : i18n.t("chat.sessionStatus", { status: item.status });
}

function runtimeWorkHref(item: EmployeeRuntimeSummaryCard["current"][number]): string | undefined {
  const target = runtimeWorkTarget(item);
  return target ? navigationHref(target) : undefined;
}

function RelatedTasksSection({
  tasks,
  onOpenNavigationTarget,
}: {
  tasks: ChatRelatedTask[];
  onOpenNavigationTarget?: (target: NavigationTarget) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  if (tasks.length === 0) {
    return null;
  }
  return (
    <section className="grid min-w-0 gap-2">
      <div className="tiny-context-section-label">{t("chat.relatedTasks")}</div>
      <div className="grid gap-1">
        {tasks.slice(0, 4).map((task) => (
          <div key={task.taskId} className="tiny-runtime-work-row tiny-related-task-row">
            <div className="flex min-w-0 items-start gap-2">
              <ListTodoIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="tiny-runtime-work-title" title={task.title}>{task.title}</div>
                <ContextText className="tiny-runtime-work-meta">
                  {`${statusLabel(task.status)} - ${task.ownerDisplayName ?? t("chat.unknownOwner")}`}
                </ContextText>
              </div>
            </div>
            <Button asChild size="xs" variant="ghost" className="tiny-runtime-work-action">
              <a
                href={tasksHref({ taskId: task.taskId })}
                onClick={(event) => {
                  if (!onOpenNavigationTarget || !shouldUseClientNavigation(event)) {
                    return;
                  }
                  event.preventDefault();
                  onOpenNavigationTarget({ kind: "task", taskId: task.taskId });
                }}
              >
                {t("chat.openTask")}
              </a>
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function runtimeWorkTarget(item: EmployeeRuntimeSummaryCard["current"][number]): NavigationTarget | undefined {
  if (!item.href) {
    return undefined;
  }
  const normalized = item.href.startsWith("/app/") ? item.href.slice(4) : item.href;
  if (normalized.startsWith("/tasks?")) {
    const params = new URLSearchParams(normalized.slice("/tasks?".length));
    const taskId = params.get("workTaskId") || params.get("taskId");
    return { kind: "task", ...(taskId ? { taskId } : {}) };
  }
  if (normalized.startsWith("/tasks")) {
    return { kind: "task" };
  }
  if (normalized.startsWith("/sessions?")) {
    const params = new URLSearchParams(normalized.slice("/sessions?".length));
    return {
      kind: "session",
      ...(params.get("employeeId") ? { employeeId: params.get("employeeId") ?? undefined } : {}),
      ...(params.get("sessionId") ? { sessionId: params.get("sessionId") ?? undefined } : {}),
      ...(params.get("q") ? { query: params.get("q") ?? undefined } : {}),
    };
  }
  if (normalized.startsWith("/sessions")) {
    return { kind: "session" };
  }
  return undefined;
}

function ActivityDock({
  activityItems,
  hasActivitySource,
  activitySource,
  activityIsPrevious,
}: {
  activityItems: RuntimeActivityItem[];
  hasActivitySource: boolean;
  activitySource?: ActivitySourceSummary;
  activityIsPrevious?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <section className="tiny-trace-dock grid min-w-0 gap-2">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="tiny-context-section-label">{t("chat.activity")}</div>
          {activityIsPrevious ? <Badge variant="outline">{t("chat.previousReply")}</Badge> : null}
        </div>
        {activitySource ? (
          <div className="min-w-0 truncate text-[11px] font-normal text-muted-foreground/70" title={`${activitySource.senderName} - ${formatActivitySourceTime(activitySource.createdAt)}`}>
            {activitySource.senderName} - {formatActivitySourceTime(activitySource.createdAt)}
          </div>
        ) : null}
      </div>
      <RuntimeActivityList
        items={activityItems}
        density="summary"
        collapseToolActivity
        maxHeight="min(420px, 46vh)"
        emptyText={hasActivitySource ? t("chat.noReplyActivity") : t("chat.selectReplyActivity")}
        followLatest
      />
    </section>
  );
}

function formatActivitySourceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(currentUiLocale(), {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChannelSettingsDialog({
  model,
  onUpdateChannelDetails,
  onAddChannelMembers,
  onRemoveChannelMember,
  onDissolveChannel,
}: {
  model: ChatShellModel;
  onUpdateChannelDetails?: (input: { title: string; summary?: string }) => Promise<void>;
  onAddChannelMembers?: (members: CompanyDirectoryMemberEntryDto[]) => Promise<void>;
  onRemoveChannelMember?: (member: ChatChannelMemberDto) => Promise<void>;
  onDissolveChannel?: (confirmation: "DELETE") => Promise<void>;
}): ReactElement | null {
  const { t } = useTranslation();
  const channel = model.selectedContainer;
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [title, setTitle] = useState(channel?.title ?? "");
  const [summary, setSummary] = useState(channel?.summary ?? "");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setTitle(channel?.title ?? "");
    setSummary(channel?.summary ?? "");
    setSelectedMemberIds([]);
    setConfirmation("");
  }, [channel?.containerId, channel?.title, channel?.summary]);

  const availableMembers = useMemo(() => availableDirectoryMembers(model), [model]);
  const selectedMembers = availableMembers.filter((member) => selectedMemberIds.includes(directoryMemberKey(member)));

  if (!channel || channel.kind !== "channel") {
    return null;
  }

  async function saveDetails(): Promise<void> {
    if (!onUpdateChannelDetails) {
      return;
    }
    setIsSaving(true);
    try {
      await onUpdateChannelDetails({ title, summary });
    } finally {
      setIsSaving(false);
    }
  }

  async function addSelectedMembers(): Promise<void> {
    if (!onAddChannelMembers || selectedMembers.length === 0) {
      return;
    }
    setIsSaving(true);
    try {
      await onAddChannelMembers(selectedMembers);
      setSelectedMemberIds([]);
    } finally {
      setIsSaving(false);
    }
  }

  async function removeMember(member: ChatChannelMemberDto): Promise<void> {
    if (!onRemoveChannelMember) {
      return;
    }
    setIsSaving(true);
    try {
      await onRemoveChannelMember(member);
    } finally {
      setIsSaving(false);
    }
  }

  async function dissolveChannel(): Promise<void> {
    if (!onDissolveChannel || confirmation !== "DELETE") {
      return;
    }
    setIsSaving(true);
    try {
      await onDissolveChannel("DELETE");
      setConfirmOpen(false);
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="tiny-icon-quiet h-8 w-8 shrink-0 rounded-md" size="icon" variant="ghost" aria-label={t("chat.manageChannel")} title={t("chat.manageChannel")}>
          <SettingsIcon className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="tiny-chat-dialog max-h-[90svh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("chat.channelSettings")}</DialogTitle>
          <DialogDescription>{t("chat.channelSettingsDescription")}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[68svh] pr-3">
          <div className="grid gap-5">
            <section className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">{t("chat.channelProfile")}</div>
              <Input value={title} disabled={isSaving} onChange={(event) => setTitle(event.currentTarget.value)} />
              <Textarea value={summary} disabled={isSaving} onChange={(event) => setSummary(event.currentTarget.value)} />
              <Button className="w-fit" size="sm" disabled={isSaving || !title.trim()} onClick={() => void saveDetails()}>
                {t("chat.saveDetails")}
              </Button>
            </section>
            <section className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">{t("chat.members")}</div>
              {(channel.members ?? []).map((member) => {
                return (
                  <div key={channelMemberKey(member)} className="grid min-w-0 gap-2 rounded-md border px-3 py-2 text-sm">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{member.displayName}</span>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{member.hasRuntimeProfile ? t("chat.runtimeCapable") : t("chat.companyMember")}</span>
                      <Button
                        size="xs"
                        variant="destructive"
                        disabled={isSaving || (channel.members ?? []).length <= 1}
                        onClick={() => void removeMember(member)}
                      >
                        {t("common.remove")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </section>
            <section className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">{t("chat.addMembers")}</div>
              {availableMembers.length === 0 ? (
                <ContextText className="text-xs text-muted-foreground">{t("chat.allMembersAdded")}</ContextText>
              ) : (
                <div className="grid gap-2">
                  {availableMembers.map((member) => {
                    const key = directoryMemberKey(member);
                    const selected = selectedMemberIds.includes(key);
                    return (
                      <Button
                        key={key}
                        type="button"
                        variant={selected ? "secondary" : "outline"}
                        className="h-auto justify-start px-3 py-2 text-left"
                        disabled={isSaving}
                        onClick={() => {
                          setSelectedMemberIds((current) => selected
                            ? current.filter((item) => item !== key)
                            : [...current, key]);
                        }}
                      >
                        <span className="grid min-w-0 gap-1">
                          <span className="break-words [overflow-wrap:anywhere]">{member.displayName}</span>
                          <span className="text-xs text-muted-foreground">{member.role ?? (member.hasRuntimeProfile ? t("chat.runtimeCapable") : t("chat.companyMember"))}</span>
                        </span>
                      </Button>
                    );
                  })}
                  <Button className="w-fit" size="sm" disabled={isSaving || selectedMembers.length === 0} onClick={() => void addSelectedMembers()}>
                    {t("chat.addSelected")}
                  </Button>
                </div>
              )}
            </section>
            <DissolveChannelDialog
              confirmation={confirmation}
              confirmOpen={confirmOpen}
              isSaving={isSaving}
              onConfirmationChange={setConfirmation}
              onConfirmOpenChange={setConfirmOpen}
              onDissolve={() => void dissolveChannel()}
            />
          </div>
        </ScrollArea>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function DissolveChannelDialog({
  confirmation,
  confirmOpen,
  isSaving,
  onConfirmationChange,
  onConfirmOpenChange,
  onDissolve,
}: {
  confirmation: string;
  confirmOpen: boolean;
  isSaving: boolean;
  onConfirmationChange(value: string): void;
  onConfirmOpenChange(value: boolean): void;
  onDissolve(): void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <section className="grid gap-2 rounded-md border border-destructive/40 px-3 py-3">
      <div className="text-xs font-medium text-destructive">{t("chat.dissolveChannel")}</div>
      <ContextText className="text-xs text-muted-foreground">
        {t("chat.dissolveDescription")}
      </ContextText>
      <Input
        value={confirmation}
        disabled={isSaving}
        placeholder="DELETE"
        onChange={(event) => onConfirmationChange(event.currentTarget.value)}
      />
      <Dialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <DialogTrigger asChild>
          <Button
            className="w-fit"
            size="sm"
            variant="destructive"
            disabled={isSaving || confirmation !== "DELETE"}
          >
            {t("chat.dissolvePermanently")}
          </Button>
        </DialogTrigger>
        <DialogContent className="tiny-chat-dialog">
          <DialogHeader>
            <DialogTitle>{t("chat.dissolveTitle")}</DialogTitle>
            <DialogDescription>
              {t("chat.dissolveConfirmation")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => onConfirmOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={isSaving} onClick={onDissolve}>
              {t("chat.understandDissolve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function availableDirectoryMembers(model: ChatShellModel): CompanyDirectoryMemberEntryDto[] {
  const channelMemberKeys = new Set((model.selectedContainer?.members ?? []).map(channelMemberKey));
  return model.directoryMembers.filter((member) => directoryMemberKeys(member).every((key) => !channelMemberKeys.has(key)));
}

function channelMemberKey(member: Pick<ChatChannelMemberDto, "memberId">): string {
  return `member:${member.memberId}`;
}

function directoryMemberKey(member: CompanyDirectoryMemberEntryDto): string {
  return directoryMemberKeys(member)[0] ?? `member:${member.memberId}`;
}

function directoryMemberKeys(member: CompanyDirectoryMemberEntryDto): string[] {
  return [
    member.memberId ? `member:${member.memberId}` : undefined,
  ].filter((key): key is string => Boolean(key));
}

function directMessageMemberForContext(model: ChatShellModel): CompanyDirectoryMemberEntryDto | undefined {
  if (model.surface.kind === "dm-directory") {
    const memberId = model.surface.memberId;
    return model.directoryMembers.find((member) => member.memberId === memberId);
  }
  if (model.selectedContainer?.kind !== "member_dm") {
    return undefined;
  }
  const directMessage = model.directMessages.find((item) => item.containerId === model.selectedContainer?.containerId);
  const memberId = directMessage?.id;
  if (!memberId) {
    return undefined;
  }
  return model.directoryMembers.find((member) => member.memberId === memberId);
}

function runtimeSummaryForMember(model: ChatShellModel, memberId: string): EmployeeRuntimeSummaryCard | undefined {
  return model.employeeRuntimeSummaries.find((summary) => summary.employeeId === memberId);
}

function directMessageSessionsForMember(model: ChatShellModel, memberId: string): Array<{ targetId: string; label?: string }> {
  return participantSessionsByMemberId(model).get(memberId) ?? [];
}

function ParticipantsSection({
  model,
  showSessions,
  onOpenSession,
}: {
  model: ChatShellModel;
  showSessions: boolean;
  onOpenSession?: (input: { employeeId?: string; sessionId?: string; query?: string }) => void;
}): ReactElement {
  const { t } = useTranslation();
  const sessionsByMemberId = participantSessionsByMemberId(model);

  return (
    <section className="grid min-w-0 max-w-full gap-2 overflow-hidden">
      <div className="tiny-context-section-label">{t("chat.participants")}</div>
      {model.context.participants.map((participant) => {
        const sessions = sessionsByMemberId.get(participant.id) ?? [];
        const hasSessionAction = showSessions && participant.hasRuntimeProfile;
        return (
          <div key={participant.id} className="tiny-context-row group grid min-w-0 max-w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden p-[5px]">
            <EmployeeAvatar
              memberId={participant.id}
              avatarSeed={participant.avatarSeed}
              displayName={participant.displayName}
              kind={participant.hasRuntimeProfile ? "employee" : "member"}
              className="size-6"
            />
            <div className="min-w-0 overflow-hidden">
              <div className="tiny-participant-name truncate">{participant.displayName}</div>
              {participant.role ? <div className="tiny-participant-role truncate">{participant.role}</div> : null}
            </div>
            {hasSessionAction || participant.chatStatus ? (
              <div className="relative flex min-h-6 min-w-0 items-center justify-end">
                {participant.chatStatus ? (
                  <div
                    className={`tiny-participant-chat-status tiny-participant-chat-status-${participant.chatStatus.kind} transition-opacity ${hasSessionAction ? "group-hover:opacity-0 group-focus-within:opacity-0" : ""}`}
                    role="status"
                    aria-label={`${participant.displayName} is ${participant.chatStatus.kind}`}
                  >
                    <span className="tiny-participant-chat-status-dot motion-safe:animate-pulse" aria-hidden="true" />
                    <span>{participant.chatStatus.label}</span>
                  </div>
                ) : null}
                {hasSessionAction ? (
                <Button
                  type="button"
                  size="xs"
                  variant={sessions.length > 0 ? "secondary" : "outline"}
                  className={`gap-1.5 transition-opacity focus-visible:opacity-100 ${participant.chatStatus ? "absolute right-0 opacity-0 group-hover:opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                  onClick={() => onOpenSession?.({
                    employeeId: participant.id,
                    sessionId: sessions[0]?.targetId,
                    query: sessions[0]?.targetId ? undefined : participant.displayName,
                  })}
                  title={sessions[0]?.targetId ? `Open session ${sessions[0].targetId}` : `Show sessions for ${participant.displayName}`}
                >
                  <FileTextIcon className="size-3.5" aria-hidden="true" />
                  {sessions.length > 0 ? "Open session" : "Find session"}
                </Button>
                ) : null}
              </div>
            ) : <span />}
          </div>
        );
      })}
    </section>
  );
}

function participantSessionsByMemberId(model: ChatShellModel): Map<string, Array<{ targetId: string; label?: string }>> {
  const sessionsByMemberId = new Map<string, Array<{ targetId: string; label?: string }>>();
  const seen = new Set<string>();
  for (const message of model.messages) {
    const memberId = message.sender.memberId;
    if (!memberId) {
      continue;
    }
    for (const link of message.runtimeLinks) {
      if (link.targetKind !== "session") {
        continue;
      }
      const key = `${memberId}:${link.targetId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const sessions = sessionsByMemberId.get(memberId) ?? [];
      sessions.push({ targetId: link.targetId, ...(link.label ? { label: link.label } : {}) });
      sessionsByMemberId.set(memberId, sessions);
    }
  }
  return sessionsByMemberId;
}

function shouldShowParticipants(model: ChatShellModel): boolean {
  return (model.context.room.kind === "channel" || model.context.room.kind === "thread") && model.context.participants.length > 0;
}

function EvidenceSection({
  title,
  items,
}: {
  title: string;
  items: ChatShellEvidence[keyof ChatShellEvidence];
}): ReactElement | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="grid min-w-0 max-w-full gap-2 overflow-hidden">
      <div className="tiny-context-section-label">{title}</div>
      {items.map((link) => (
        <div key={link.linkId} className="tiny-context-row min-w-0 max-w-full overflow-hidden rounded-md border px-3 py-2 text-sm">
          <div className="break-words font-medium [overflow-wrap:anywhere]">{link.label ?? link.targetKind}</div>
          <EvidenceTarget>{link.targetId}</EvidenceTarget>
        </div>
      ))}
    </section>
  );
}

function ContextText({ className = "", children }: { className?: string; children: string }): ReactElement {
  return <p className={`min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${className}`}>{children}</p>;
}

function EvidenceTarget({ children }: { children: string }): ReactElement {
  return <div className="mt-1 min-w-0 max-w-full break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{children}</div>;
}

function statusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  const key = ({ completed: "completed", running: "running", pending: "pending", blocked: "blocked", queued: "queued", done: "done", in_progress: "inProgress", active: "active", canceled: "canceled", archived: "archived" } as const)[normalized as "completed" | "running" | "pending" | "blocked" | "queued" | "done" | "in_progress" | "active" | "canceled" | "archived"];
  return key ? i18n.t(`enums.${key}`) : normalized.replaceAll("_", " ");
}

function contextKindLabel(kind: ChatShellModel["context"]["room"]["kind"]): string {
  switch (kind) {
    case "channel":
      return i18n.t("sessionsPage.channel");
    case "member-dm":
      return i18n.t("chat.directMessage");
    case "thread":
      return i18n.t("chat.topic");
    case "workspace":
      return i18n.t("chat.workspace");
  }
}

