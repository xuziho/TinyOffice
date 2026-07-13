import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUnsavedChangesNavigation } from "@/config/unsavedChangesContext";
import { AccessPage } from "@/access/AccessPage";
import { CapabilitiesPage } from "@/capabilities/CapabilitiesPage";
import { CenterWorkspace } from "@/chat/CenterWorkspace";
import { CompanyLifecyclePage } from "./CompanyLifecyclePage";
import { ContextPanel } from "@/chat/ContextPanel";
import { DoctorPage } from "@/doctor/DoctorPage";
import { BackupPage } from "@/backup/BackupPage";
import { EmployeesPage } from "@/employees/EmployeesPage";
import { IntegrationsPage } from "@/integrations/IntegrationsPage";
import { PromptPolicyPage } from "@/prompt/PromptPolicyPage";
import { SessionsPage, type SessionChatReturnTarget, type SessionFocus } from "@/sessions/SessionsPage";
import { SettingsPage } from "@/settings/SettingsPage";
import { CompanySkillsPage } from "@/skills/CompanySkillsPage";
import { SystemAiPage } from "@/system-ai/SystemAiPage";
import { TasksPage } from "@/tasks/TasksPage";
import { WorkspaceSidebar } from "@/chat/WorkspaceSidebar";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { chatRouteFocusFromSearch, chatRouteForSelectedRoom, type ChatRouteFocus } from "@/chat/chatRouteSync";
import { browserTitleFor } from "@/chat/chatUiUtils";
import { useChatWorkspace } from "@/chat/useChatWorkspace";
import {
  appViewHref,
  navigationHref,
  navigationReturnContextFromState,
  navigationStateWithReturn,
  navigationViewForTarget,
  shouldUseClientNavigation,
  type AppView,
  type NavigationReturnContext,
  type NavigationTarget,
} from "@/app/navigationRoutes";
import { listCompanies } from "@/api/companyClient";
import { getCompanyBranding } from "@/api/brandingClient";
import { switchCurrentCompany } from "@/api/currentSessionClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BotIcon, BriefcaseBusinessIcon, Boxes, FileTextIcon, ListChecks, MessageCircle, PlugZapIcon, ScrollText, SettingsIcon, ShieldCheck, Stethoscope, UsersRound, Wrench } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from "react";
import type { CompaniesAdminViewModel, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

export function App(): ReactElement {
  const { hasUnsavedChanges, requestTransition } = useUnsavedChangesNavigation();
  const committedLocationRef = useRef(window.location.href);
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<AppView>(() => initialViewFromLocation());
  const [chatFocus, setChatFocus] = useState<ChatRouteFocus>(() => chatFocusFromLocation());
  const workspace = useChatWorkspace({ requestedRoomId: activeView === "chat" ? chatFocus.roomId : undefined });
  const { model } = workspace;
  const [sessionFocus, setSessionFocus] = useState<SessionFocus>(() => sessionFocusFromLocation());
  const [taskFocus, setTaskFocus] = useState(() => taskFocusFromLocation());
  const [returnContext, setReturnContext] = useState<NavigationReturnContext | undefined>(() =>
    navigationReturnContextFromState(window.history.state)
  );
  const needsInitialization = Boolean(workspace.currentSession?.needsInitialization);
  const companiesQuery = useQuery({
    queryKey: chatQueryKeys.companies(),
    queryFn: listCompanies,
  });
  const currentCompanyName = currentCompanyDisplayName(workspace.currentSession, companiesQuery.data);
  const currentCompanyId = workspace.currentSession?.companyId ?? workspace.currentSession?.currentCompanyId ?? "";
  const brandingQuery = useQuery({ queryKey: ["company-branding", currentCompanyId], enabled: Boolean(currentCompanyId), queryFn: () => getCompanyBranding({ companyId: currentCompanyId }) });
  const switchCompanyMutation = useMutation({
    mutationFn: switchCurrentCompany,
    onSuccess: async (session) => {
      queryClient.setQueryData(chatQueryKeys.currentSession(), session);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.all() });
    },
  });

  useEffect(() => {
    document.title = browserTitleFor(model);
  }, [model]);

  useEffect(() => {
    if (activeView !== "chat") {
      return;
    }
    const nextRoute = chatRouteForSelectedRoom({
      selectedRoomId: model.selectedRoomId,
      selectedContainerKind: model.selectedContainer?.kind,
    });
    if (!nextRoute) {
      return;
    }
    if (model.selectedRoomId === chatFocus.roomId) {
      return;
    }
    setChatFocus(chatRouteFocusFromSearch(new URL(nextRoute, window.location.origin).search));
    window.history.replaceState({}, "", nextRoute);
    committedLocationRef.current = window.location.href;
  }, [activeView, chatFocus.roomId, model]);

  useEffect(() => {
    if (needsInitialization && activeView !== "company" && activeView !== "settings") {
      setActiveView("company");
      window.history.replaceState({}, "", "/company");
      committedLocationRef.current = window.location.href;
    }
  }, [activeView, needsInitialization]);

  useEffect(() => {
    function syncViewFromLocation(): void {
      setActiveView(initialViewFromLocation());
      setSessionFocus(sessionFocusFromLocation());
      setTaskFocus(taskFocusFromLocation());
      setChatFocus(chatFocusFromLocation());
      setReturnContext(navigationReturnContextFromState(window.history.state));
    }
    function handlePopState(event: PopStateEvent): void {
      const targetUrl = window.location.href;
      if (!hasUnsavedChanges) {
        committedLocationRef.current = targetUrl;
        syncViewFromLocation();
        return;
      }
      window.history.pushState({}, "", committedLocationRef.current);
      requestTransition(() => {
        window.history.pushState(event.state, "", targetUrl);
        committedLocationRef.current = targetUrl;
        syncViewFromLocation();
      });
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [hasUnsavedChanges, requestTransition]);

  function selectView(view: AppView): void {
    if (needsInitialization && view !== "company" && view !== "settings") {
      return;
    }
    requestTransition(() => {
      setActiveView(view);
      if (view === "chat") {
        setChatFocus({});
      }
      if (view === "sessions") {
        setSessionFocus({});
      }
      if (view === "tasks") {
        setTaskFocus({});
      }
      setReturnContext(undefined);
      window.history.pushState({}, "", appViewHref(view));
      committedLocationRef.current = window.location.href;
    });
  }

  function clearChatRoute(): void {
    setChatFocus({});
    setReturnContext(undefined);
    window.history.replaceState({}, "", "/chat");
    committedLocationRef.current = window.location.href;
  }

  function selectChatSurface(surface: Parameters<typeof workspace.selectSurface>[0]): void {
    workspace.selectSurface(surface);
    if (surface.kind !== "entry-room") {
      clearChatRoute();
    }
  }

  function startDraftEntry(): void {
    workspace.startDraftEntry();
    clearChatRoute();
  }

  function backToList(): void {
    workspace.backToList();
    clearChatRoute();
  }

  function openNavigationTarget(target: NavigationTarget, options: { from?: NavigationReturnContext } = {}): void {
    if (needsInitialization) {
      return;
    }
    requestTransition(() => {
      const view = navigationViewForTarget(target);
      setActiveView(view);
      setReturnContext(options.from);
      if (target.kind === "chat-room") {
        workspace.selectRoom(target.roomId);
        setChatFocus({ roomId: target.roomId, surface: target.surface });
      } else if (target.kind === "session") {
        setSessionFocus({
          ...(target.employeeId ? { employeeId: target.employeeId } : {}),
          ...(target.sessionId ? { sessionId: target.sessionId } : {}),
          ...(target.query ? { query: target.query } : {}),
        });
      } else if (target.kind === "task") {
        setTaskFocus({
          ...(target.taskId ? { workTaskId: target.taskId } : {}),
        });
      } else if (target.kind === "app") {
        if (target.view === "chat") {
          setChatFocus({});
        }
        if (target.view === "sessions") {
          setSessionFocus({});
        }
        if (target.view === "tasks") {
          setTaskFocus({});
        }
      }
      window.history.pushState(navigationStateWithReturn(options), "", navigationHref(target));
      committedLocationRef.current = window.location.href;
    });
  }

  function openChatTarget(target: SessionChatReturnTarget): void {
    openNavigationTarget({ kind: "chat-room", roomId: target.conversationId, surface: target.surface });
  }

  return (
    <TooltipProvider>
      <main className="tiny-shell tiny-soft-retro-shell flex h-svh overflow-hidden">
        <nav className="tiny-rail flex w-[60px] shrink-0 flex-col items-center justify-between border-r px-2 py-3" aria-label="TinyOffice">
          <div className="flex flex-col items-center">
            <div className="mb-3 flex flex-col items-center gap-3">
              <CompanySwitcher
                currentSession={workspace.currentSession}
                logoUrl={brandingQuery.data?.logoUrl}
                viewModel={companiesQuery.data}
                loading={companiesQuery.isLoading || switchCompanyMutation.isPending}
                disabled={needsInitialization}
                onSwitch={(companyId) => requestTransition(() => switchCompanyMutation.mutate({ companyId }))}
              />
              <Separator className="w-8" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <ViewButton view="chat" label="Chat" active={activeView === "chat"} disabled={needsInitialization} indicator={workspace.navigationAlerts.chat} indicatorLabel="unread messages or requests" onClick={() => selectView("chat")}>
                <MessageCircle />
              </ViewButton>
              <ViewButton view="tasks" label="Tasks" active={activeView === "tasks"} disabled={needsInitialization} indicator={workspace.navigationAlerts.tasks} indicatorLabel="execution needs action" onClick={() => selectView("tasks")}>
                <ListChecks />
              </ViewButton>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ViewButton view="sessions" label="Sessions" active={activeView === "sessions"} disabled={needsInitialization} onClick={() => selectView("sessions")}>
              <FileTextIcon />
            </ViewButton>
            <Separator className="w-8" />
            <ManageMenu activeView={activeView} disabled={needsInitialization} onSelect={selectView} />
            <DeveloperToolsMenu activeView={activeView} disabled={needsInitialization} onSelect={selectView} />
            <ViewButton view="settings" label="Settings" active={activeView === "settings"} onClick={() => selectView("settings")}>
              <SettingsIcon />
            </ViewButton>
          </div>
        </nav>
        <section className={`min-w-0 flex-1 overflow-hidden ${activeView === "chat" || activeView === "tasks" ? "" : "tiny-soft-retro-product"}`}>
          {activeView === "company" ? (
            <CompanyLifecyclePage currentSession={workspace.currentSession} />
          ) : activeView === "employees" ? (
            <EmployeesPage currentSession={workspace.currentSession} />
          ) : activeView === "skills" ? (
            <CompanySkillsPage currentSession={workspace.currentSession} />
          ) : activeView === "integrations" ? (
            <IntegrationsPage currentSession={workspace.currentSession} />
          ) : activeView === "prompt" ? (
            <PromptPolicyPage currentSession={workspace.currentSession} />
          ) : activeView === "system-ai" ? (
            <SystemAiPage currentSession={workspace.currentSession} />
          ) : activeView === "access" ? (
            <AccessPage currentSession={workspace.currentSession} />
          ) : activeView === "capabilities" ? (
            <CapabilitiesPage currentSession={workspace.currentSession} />
          ) : activeView === "doctor" ? (
            <DoctorPage currentSession={workspace.currentSession} />
          ) : activeView === "backup" ? (
            <BackupPage />
          ) : activeView === "sessions" ? (
            <SessionsPage
              currentSession={workspace.currentSession}
              focus={sessionFocus}
              returnContext={returnContext}
              onOpenNavigationTarget={openNavigationTarget}
              onClearReturnContext={() => setReturnContext(undefined)}
              onOpenChatTarget={openChatTarget}
            />
          ) : activeView === "tasks" ? (
            <TasksPage
              currentSession={workspace.currentSession}
              focus={taskFocus}
              returnContext={returnContext}
              onOpenNavigationTarget={openNavigationTarget}
              onClearReturnContext={() => setReturnContext(undefined)}
            />
          ) : activeView === "settings" ? (
            <SettingsPage currentSession={workspace.currentSession} />
          ) : (
            <div data-tiny-chat-workbench className="tiny-chat-workbench tiny-soft-retro-chat grid h-svh w-full overflow-hidden">
              <div data-tiny-chat-sidebar-pane className="min-w-0 overflow-hidden">
                <WorkspaceSidebar
                  model={model}
                  companyName={currentCompanyName}
                  onSelectSurface={selectChatSurface}
                  onCreateChannel={workspace.createChannel}
                />
              </div>
              <div data-tiny-chat-primary-pane className="min-w-0 overflow-hidden">
                <CenterWorkspace
                  model={model}
                  status={workspace.status}
                  error={workspace.error}
                  onSelectEntry={workspace.selectEntry}
                  onStartDraft={startDraftEntry}
                  onArchiveEntry={workspace.archiveEntry}
                  onRestoreEntry={workspace.restoreEntry}
                  onBackToList={backToList}
                  onCreateEntry={workspace.createEntry}
                  onSendReply={workspace.sendReply}
                  onClearComposerNotice={workspace.clearComposerNotice}
                  onCancelRun={workspace.cancelActiveRun}
                  onRetryRun={workspace.retryFailedRun}
                  onUpdateTitle={workspace.updateTitle}
                  onOpenMessageActivity={workspace.openMessageActivity}
                  selectedActivitySourceMessageId={workspace.activitySelection?.sourceMessageId}
                  onResolveAccessRequest={workspace.resolveAccessRequest}
                  activeRun={workspace.activeRun}
                  draftReply={workspace.draftReply}
                  isCancelingRun={workspace.isCancelingRun}
                  accessRequests={workspace.accessRequests}
                  isResolvingAccessRequest={workspace.isResolvingAccessRequest}
                  composerNotice={workspace.composerNotice}
                />
              </div>
              <div data-tiny-chat-context-pane className="min-w-0 overflow-hidden">
                <ContextPanel
                  model={model}
                  activityItems={workspace.activity.items}
                  hasActivitySource={Boolean(workspace.activitySelection)}
                  activitySource={workspace.activitySource}
                  onOpenSession={(focus) => openNavigationTarget(
                    { kind: "session", ...focus },
                    { from: chatReturnContextForModel(model) },
                  )}
                  onOpenNavigationTarget={(target) => openNavigationTarget(target, { from: chatReturnContextForModel(model) })}
                  onUpdateChannelDetails={workspace.updateChannelDetails}
                  onAddChannelMembers={workspace.addChannelMembers}
                  onRemoveChannelMember={workspace.removeChannelMember}
                  onDissolveChannel={workspace.dissolveChannel}
                />
              </div>
            </div>
          )}
        </section>
      </main>
    </TooltipProvider>
  );
}

function DeveloperToolsMenu({
  activeView,
  disabled,
  onSelect,
}: {
  activeView: AppView;
  disabled?: boolean;
  onSelect(view: AppView): void;
}): ReactElement {
  const active = isDeveloperToolView(activeView);
  const hoverMenu = useRailHoverMenu(disabled);
  return (
    <DropdownMenu modal={false} open={hoverMenu.open} onOpenChange={hoverMenu.setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={active ? "secondary" : "ghost"}
          disabled={disabled}
          aria-label="Developer tools"
          title="Developer tools"
          className="tiny-rail-button"
          data-active={active || undefined}
          onMouseEnter={hoverMenu.openNow}
          onMouseLeave={hoverMenu.closeSoon}
        >
          <Wrench />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="tiny-product-menu w-48" onMouseEnter={hoverMenu.cancelClose} onMouseLeave={hoverMenu.closeSoon}>
        <DropdownMenuLabel>Developer tools</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onSelect("system-ai")}>
          <BotIcon />
          System AI
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect("prompt")}>
          <ScrollText />
          Prompt
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect("access")}>
          <ShieldCheck />
          Access
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect("capabilities")}>
          <Boxes />
          Capabilities
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect("doctor")}>
          <Stethoscope />
          Doctor
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect("backup")}>
          <Archive />
          Backup & Restore
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ManageMenu({ activeView, disabled, onSelect }: { activeView: AppView; disabled?: boolean; onSelect(view: AppView): void }): ReactElement {
  const active = activeView === "employees" || activeView === "skills" || activeView === "integrations" || activeView === "company";
  const hoverMenu = useRailHoverMenu(disabled);
  return <DropdownMenu modal={false} open={hoverMenu.open} onOpenChange={hoverMenu.setOpen}>
    <DropdownMenuTrigger asChild><Button type="button" size="icon" variant={active ? "secondary" : "ghost"} disabled={disabled} aria-label="Manage" title="Manage" className="tiny-rail-button" data-active={active || undefined} onMouseEnter={hoverMenu.openNow} onMouseLeave={hoverMenu.closeSoon}><BriefcaseBusinessIcon /></Button></DropdownMenuTrigger>
    <DropdownMenuContent side="right" align="end" className="tiny-product-menu w-52" onMouseEnter={hoverMenu.cancelClose} onMouseLeave={hoverMenu.closeSoon}>
      <DropdownMenuLabel>Manage</DropdownMenuLabel><DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onSelect("employees")}><UsersRound />Employees</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onSelect("skills")}><Boxes />Company Skills</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onSelect("integrations")}><PlugZapIcon />Integrations</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onSelect("company")}><BriefcaseBusinessIcon />Organization</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function useRailHoverMenu(disabled = false): {
  open: boolean;
  setOpen(open: boolean): void;
  openNow(): void;
  closeSoon(): void;
  cancelClose(): void;
} {
  const [open, setOpenState] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const cancelClose = (): void => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  };
  const setOpen = (nextOpen: boolean): void => {
    cancelClose();
    setOpenState(nextOpen);
  };
  const openNow = (): void => {
    if (!disabled) {
      setOpen(true);
    }
  };
  const closeSoon = (): void => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpenState(false), 140);
  };

  useEffect(() => () => cancelClose(), []);

  return { open, setOpen, openNow, closeSoon, cancelClose };
}

function currentCompanyDisplayName(
  currentSession: TinyOfficeCurrentSession | undefined,
  viewModel: CompaniesAdminViewModel | undefined,
): string | undefined {
  const currentCompanyId = currentSession?.companyId ?? currentSession?.currentCompanyId;
  if (!currentCompanyId) {
    return undefined;
  }
  return viewModel?.companies.find((company) => company.companyId === currentCompanyId)?.displayName ?? currentCompanyId;
}

function CompanySwitcher({
  currentSession,
  logoUrl,
  viewModel,
  loading,
  disabled,
  onSwitch,
}: {
  currentSession?: TinyOfficeCurrentSession;
  logoUrl?: string;
  viewModel?: CompaniesAdminViewModel;
  loading: boolean;
  disabled: boolean;
  onSwitch: (companyId: string) => void;
}): ReactElement {
  const currentCompanyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const companies = viewModel?.companies ?? [];
  const currentCompanyName = companies.find((company) => company.companyId === currentCompanyId)?.displayName ?? currentCompanyId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="tiny-company-mark p-0 disabled:opacity-45"
          disabled={disabled || loading || companies.length === 0}
          aria-label={currentCompanyName ? `Switch company: ${currentCompanyName}` : "Switch company"}
          title={currentCompanyName ? `Company: ${currentCompanyName}` : "Company"}
        >
          {logoUrl ? <img src={logoUrl} alt="" className="size-full rounded-xl object-cover" /> : <CompanyAvatar name={currentCompanyName} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start" side="right">
        <DropdownMenuLabel>Company</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={currentCompanyId}
          onValueChange={(companyId) => {
            if (companyId && companyId !== currentCompanyId) {
              onSwitch(companyId);
            }
          }}
        >
          {companies.map((company) => (
            <DropdownMenuRadioItem key={company.companyId} value={company.companyId}>
              <span className="min-w-0 flex-1 truncate">{company.displayName}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CompanyAvatar({ name }: { name: string }): ReactElement {
  return (
    <span className="flex size-full items-center justify-center text-xs font-semibold leading-none">
      {companyInitials(name)}
    </span>
  );
}

function companyInitials(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    return "TO";
  }
  const words = normalized.split(/[\s._-]+/).filter(Boolean);
  const initials = words.length > 1
    ? words.slice(0, 2).map((word) => Array.from(word)[0])
    : Array.from(words[0] ?? normalized).slice(0, 2);
  return initials.join("").toUpperCase() || "TO";
}

function ViewButton({
  view,
  label,
  active,
  disabled,
  indicator,
  indicatorLabel,
  onClick,
  children,
}: {
  view: AppView;
  label: string;
  active: boolean;
  disabled?: boolean;
  indicator?: boolean;
  indicatorLabel?: string;
  onClick: () => void;
  children: ReactElement;
}): ReactElement {
  const href = appViewHref(view);
  const accessibleLabel = indicator ? `${label}, ${indicatorLabel || "new activity"}` : label;
  return (
    <Button
      asChild
      size="icon"
      variant={active ? "secondary" : "ghost"}
      disabled={disabled}
      aria-label={accessibleLabel}
      title={label}
      className="tiny-rail-button relative"
      data-active={active || undefined}
    >
      <a
        href={disabled ? undefined : href}
        aria-disabled={disabled || undefined}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          if (!shouldUseClientNavigation(event)) {
            return;
          }
          event.preventDefault();
          onClick();
        }}
      >
        {children}
        {indicator ? (
          <span className="absolute right-1 top-1 size-2 rounded-full bg-destructive ring-2 ring-background" aria-hidden="true" />
        ) : null}
      </a>
    </Button>
  );
}

function initialViewFromLocation(): AppView {
  if (window.location.pathname.includes("company")) {
    return "company";
  }
  if (window.location.pathname.includes("employees")) {
    return "employees";
  }
  if (window.location.pathname.includes("integrations")) {
    return "integrations";
  }
  if (window.location.pathname.includes("skills")) {
    return "skills";
  }
  if (window.location.pathname.includes("capabilities")) {
    return "capabilities";
  }
  if (window.location.pathname.includes("prompt")) {
    return "prompt";
  }
  if (window.location.pathname.includes("access")) {
    return "access";
  }
  if (window.location.pathname.includes("doctor")) {
    return "doctor";
  }
  if (window.location.pathname.includes("backup")) {
    return "backup";
  }
  if (window.location.pathname.includes("sessions")) {
    return "sessions";
  }
  if (window.location.pathname.includes("tasks")) {
    return "tasks";
  }
  if (window.location.pathname.includes("settings")) {
    return "settings";
  }
  if (window.location.pathname.includes("system-ai")) {
    return "system-ai";
  }
  return "chat";
}

function isDeveloperToolView(view: AppView): boolean {
  return view === "access" || view === "backup" || view === "capabilities" || view === "doctor" || view === "prompt" || view === "system-ai";
}

function chatReturnContextForModel(model: ReturnType<typeof useChatWorkspace>["model"]): NavigationReturnContext | undefined {
  if (!model.selectedRoomId) {
    return undefined;
  }
  const route = chatRouteForSelectedRoom({
    selectedRoomId: model.selectedRoomId,
    selectedContainerKind: model.selectedContainer?.kind,
  });
  if (!route) {
    return undefined;
  }
  const focus = chatRouteFocusFromSearch(new URL(route, window.location.origin).search);
  if (!focus.roomId || !focus.surface) {
    return undefined;
  }
  return {
    label: `Back to ${model.context.room.title}`,
    target: { kind: "chat-room", roomId: focus.roomId, surface: focus.surface },
  };
}

function sessionFocusFromLocation(): SessionFocus {
  const params = new URLSearchParams(window.location.search);
  return {
    ...(params.get("employeeId") ? { employeeId: params.get("employeeId") ?? undefined } : {}),
    ...(params.get("sessionId") ? { sessionId: params.get("sessionId") ?? undefined } : {}),
    ...(params.get("q") ? { query: params.get("q") ?? undefined } : {}),
  };
}

function taskFocusFromLocation(): { workTaskId?: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    ...(params.get("taskId") ? { workTaskId: params.get("taskId") ?? undefined } : {}),
  };
}

function chatFocusFromLocation(): ChatRouteFocus {
  return chatRouteFocusFromSearch(window.location.search);
}
