import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUnsavedChangesNavigation } from "@/config/unsavedChangesContext";
import type { SessionChatReturnTarget, SessionFocus } from "@/sessions/SessionsPage";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { chatRouteFocusFromSearch, type ChatRouteFocus } from "@/chat/chatRouteSync";
import type { NavigationAlertState } from "@/chat/navigationAlertState";
import {
  appViewHref,
  appViewFromPathname,
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
import { getCurrentSession, switchCurrentCompany } from "@/api/currentSessionClient";
import { getMyProfile } from "@/api/profileClient";
import { applyUiLocalePreference } from "@/i18n";
import { applyUiThemePreference } from "@/theme";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BlocksIcon, BotIcon, BriefcaseBusinessIcon, ListChecks, MessageCircle, PlugZapIcon, SettingsIcon, UsersRound, Wrench } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { CompaniesAdminViewModel, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import { isAiRuntimeView, isOperationsView, isWorkforceView, pageSectionForView } from "./navigationStructure";
import { SectionNavigation } from "./SectionNavigation";

const AccessPage = lazy(() => import("@/access/AccessPage").then((module) => ({ default: module.AccessPage })));
const CompanyLifecyclePage = lazy(() => import("./CompanyLifecyclePage").then((module) => ({ default: module.CompanyLifecyclePage })));
const BackupPage = lazy(() => import("@/backup/BackupPage").then((module) => ({ default: module.BackupPage })));
const CapabilitiesPage = lazy(() => import("@/capabilities/CapabilitiesPage").then((module) => ({ default: module.CapabilitiesPage })));
const ChatWorkspaceRoute = lazy(() => import("@/chat/ChatWorkspaceRoute").then((module) => ({ default: module.ChatWorkspaceRoute })));
const DoctorPage = lazy(() => import("@/doctor/DoctorPage").then((module) => ({ default: module.DoctorPage })));
const EmployeesPage = lazy(() => import("@/employees/EmployeesPage").then((module) => ({ default: module.EmployeesPage })));
const IntegrationsPage = lazy(() => import("@/integrations/IntegrationsPage").then((module) => ({ default: module.IntegrationsPage })));
const McpPage = lazy(() => import("@/mcp/McpPage").then((module) => ({ default: module.McpPage })));
const OwnerOnboardingPage = lazy(() => import("@/onboarding/OwnerOnboardingPage").then((module) => ({ default: module.OwnerOnboardingPage })));
const PromptPolicyPage = lazy(() => import("@/prompt/PromptPolicyPage").then((module) => ({ default: module.PromptPolicyPage })));
const SessionsPage = lazy(() => import("@/sessions/SessionsPage").then((module) => ({ default: module.SessionsPage })));
const SettingsPage = lazy(() => import("@/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const CompanySkillsPage = lazy(() => import("@/skills/CompanySkillsPage").then((module) => ({ default: module.CompanySkillsPage })));
const SystemAiPage = lazy(() => import("@/system-ai/SystemAiPage").then((module) => ({ default: module.SystemAiPage })));
const TasksPage = lazy(() => import("@/tasks/TasksPage").then((module) => ({ default: module.TasksPage })));
const UpdatesPage = lazy(() => import("@/updates/UpdatesPage").then((module) => ({ default: module.UpdatesPage })));

export function App(): ReactElement {
  const { t } = useTranslation();
  const { hasUnsavedChanges, requestTransition } = useUnsavedChangesNavigation();
  const committedLocationRef = useRef(window.location.href);
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<AppView>(() => appViewFromPathname(window.location.pathname));
  const [chatFocus, setChatFocus] = useState<ChatRouteFocus>(() => chatFocusFromLocation());
  const sessionQuery = useQuery({ queryKey: chatQueryKeys.currentSession(), queryFn: getCurrentSession });
  const currentSession = sessionQuery.data;
  const profileQuery = useQuery({ queryKey: chatQueryKeys.myProfile(), queryFn: getMyProfile });
  const [navigationAlerts, setNavigationAlerts] = useState<NavigationAlertState>({ chat: false, tasks: false });
  const [sessionFocus, setSessionFocus] = useState<SessionFocus>(() => sessionFocusFromLocation());
  const [taskFocus, setTaskFocus] = useState(() => taskFocusFromLocation());
  const [returnContext, setReturnContext] = useState<NavigationReturnContext | undefined>(() =>
    navigationReturnContextFromState(window.history.state)
  );
  const needsInitialization = Boolean(currentSession?.needsProfileInitialization || currentSession?.needsCompanyInitialization);
  const companiesQuery = useQuery({
    queryKey: chatQueryKeys.companies(),
    queryFn: listCompanies,
  });
  const currentCompanyName = currentCompanyDisplayName(currentSession, companiesQuery.data);
  const currentCompanyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const pageSection = pageSectionForView(activeView);
  const brandingQuery = useQuery({ queryKey: chatQueryKeys.branding(currentCompanyId), enabled: Boolean(currentCompanyId), queryFn: () => getCompanyBranding({ companyId: currentCompanyId }) });
  useEffect(() => {
    if (profileQuery.data) {
      void applyUiLocalePreference(profileQuery.data.uiLocale);
      applyUiThemePreference(profileQuery.data.uiTheme);
    }
  }, [profileQuery.data]);
  const switchCompanyMutation = useMutation({
    mutationFn: switchCurrentCompany,
    onSuccess: async (session) => {
      queryClient.setQueryData(chatQueryKeys.currentSession(), session);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.all() });
    },
  });

  const handleCommittedLocationChange = useCallback(() => {
    committedLocationRef.current = window.location.href;
  }, []);

  useEffect(() => {
    if (needsInitialization && activeView !== "company" && activeView !== "settings") {
      setActiveView("company");
      window.history.replaceState({}, "", "/company");
      committedLocationRef.current = window.location.href;
    }
  }, [activeView, needsInitialization]);

  useEffect(() => {
    function syncViewFromLocation(): void {
      setActiveView(appViewFromPathname(window.location.pathname));
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

  function openNavigationTarget(target: NavigationTarget, options: { from?: NavigationReturnContext } = {}): void {
    if (needsInitialization) {
      return;
    }
    requestTransition(() => {
      const view = navigationViewForTarget(target);
      setActiveView(view);
      setReturnContext(options.from);
      if (target.kind === "chat-room") {
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

  if (currentSession && needsInitialization) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <OwnerOnboardingPage session={currentSession} />
      </Suspense>
    );
  }

  return (
    <TooltipProvider>
      <main className="tiny-shell tiny-soft-retro-shell flex h-svh overflow-hidden">
        <nav className="tiny-rail flex w-[60px] shrink-0 flex-col items-center justify-between border-r px-2 py-3" aria-label="TinyOffice">
          <div className="flex flex-col items-center">
            <div className="mb-3 flex flex-col items-center gap-3">
              <CompanySwitcher
                currentSession={currentSession}
                logoUrl={brandingQuery.data?.logoUrl}
                viewModel={companiesQuery.data}
                loading={companiesQuery.isLoading || switchCompanyMutation.isPending}
                disabled={needsInitialization}
                onSwitch={(companyId) => requestTransition(() => switchCompanyMutation.mutate({ companyId }))}
              />
              <Separator className="w-8" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <ViewButton view="chat" label={t("nav.chat")} active={activeView === "chat"} disabled={needsInitialization} indicator={navigationAlerts.chat} indicatorLabel={t("nav.unreadMessages")} onClick={() => selectView("chat")}>
                <MessageCircle />
              </ViewButton>
              <ViewButton view="tasks" label={t("nav.tasks")} active={activeView === "tasks"} disabled={needsInitialization} indicator={navigationAlerts.tasks} indicatorLabel={t("nav.executionNeedsAction")} onClick={() => selectView("tasks")}>
                <ListChecks />
              </ViewButton>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ViewButton view="employees" label={t("nav.workforce")} active={isWorkforceView(activeView)} disabled={needsInitialization} onClick={() => selectView("employees")}>
              <UsersRound />
            </ViewButton>
            <ViewButton view="company" label={t("nav.organization")} active={activeView === "company"} disabled={needsInitialization} onClick={() => selectView("company")}>
              <BriefcaseBusinessIcon />
            </ViewButton>
            <ViewButton view="integrations" label={t("nav.integrations")} active={activeView === "integrations"} disabled={needsInitialization} onClick={() => selectView("integrations")}>
              <PlugZapIcon />
            </ViewButton>
            <ViewButton view="mcp" label={t("nav.mcp")} active={activeView === "mcp"} disabled={needsInitialization} onClick={() => selectView("mcp")}>
              <BlocksIcon />
            </ViewButton>
            <ViewButton view="system-ai" label={t("nav.aiRuntime")} active={isAiRuntimeView(activeView)} disabled={needsInitialization} onClick={() => selectView("system-ai")}>
              <BotIcon />
            </ViewButton>
            <ViewButton view="sessions" label={t("nav.operations")} active={isOperationsView(activeView)} disabled={needsInitialization} onClick={() => selectView("sessions")}>
              <Wrench />
            </ViewButton>
            <Separator className="w-8" />
            <ViewButton view="settings" label={t("nav.settings")} active={activeView === "settings"} onClick={() => selectView("settings")}>
              <SettingsIcon />
            </ViewButton>
          </div>
        </nav>
        <section className={`min-w-0 flex-1 overflow-hidden ${activeView === "chat" || activeView === "tasks" ? "" : "tiny-soft-retro-product"}`}>
          <div className={pageSection ? "grid h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden" : "h-full overflow-hidden"}>
          {pageSection ? <SectionNavigation activeView={activeView} section={pageSection} onSelect={selectView} /> : null}
          <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<RouteLoadingFallback />}>
          {activeView === "company" ? (
            <CompanyLifecyclePage currentSession={currentSession} />
          ) : activeView === "employees" ? (
            <EmployeesPage currentSession={currentSession} />
          ) : activeView === "skills" ? (
            <CompanySkillsPage currentSession={currentSession} />
          ) : activeView === "integrations" ? (
            <IntegrationsPage />
          ) : activeView === "mcp" ? (
            <McpPage currentSession={currentSession} />
          ) : activeView === "prompt" ? (
            <PromptPolicyPage currentSession={currentSession} />
          ) : activeView === "system-ai" ? (
            <SystemAiPage currentSession={currentSession} />
          ) : activeView === "access" ? (
            <AccessPage currentSession={currentSession} />
          ) : activeView === "capabilities" ? (
            <CapabilitiesPage currentSession={currentSession} />
          ) : activeView === "doctor" ? (
            <DoctorPage currentSession={currentSession} />
          ) : activeView === "backup" ? (
            <BackupPage />
          ) : activeView === "sessions" ? (
            <SessionsPage
              currentSession={currentSession}
              focus={sessionFocus}
              returnContext={returnContext}
              onOpenNavigationTarget={openNavigationTarget}
              onClearReturnContext={() => setReturnContext(undefined)}
              onOpenChatTarget={openChatTarget}
            />
          ) : activeView === "tasks" ? (
            <TasksPage
              currentSession={currentSession}
              focus={taskFocus}
              returnContext={returnContext}
              onOpenNavigationTarget={openNavigationTarget}
              onClearReturnContext={() => setReturnContext(undefined)}
            />
          ) : activeView === "settings" ? (
            <SettingsPage currentSession={currentSession} />
          ) : activeView === "updates" ? (
            <UpdatesPage />
          ) : (
            <ChatWorkspaceRoute
              currentSession={currentSession}
              companyName={currentCompanyName}
              focus={chatFocus}
              onFocusChange={setChatFocus}
              onNavigationAlertsChange={setNavigationAlerts}
              onOpenNavigationTarget={openNavigationTarget}
              onCommittedLocationChange={handleCommittedLocationChange}
            />
          )}
          </Suspense>
          </div>
          </div>
        </section>
      </main>
    </TooltipProvider>
  );
}

function currentCompanyDisplayName(
  currentSession: TinyOfficeCurrentSession | undefined,
  viewModel: CompaniesAdminViewModel | undefined,
): string | undefined {
  const currentCompanyId = currentSession?.companyId ?? currentSession?.currentCompanyId;
  if (!currentCompanyId) {
    return undefined;
  }
  return viewModel?.companies.find((company) => company.companyId === currentCompanyId)?.displayName ?? "Company";
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
  const { t } = useTranslation();
  const currentCompanyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const companies = viewModel?.companies ?? [];
  const currentCompanyName = companies.find((company) => company.companyId === currentCompanyId)?.displayName ?? "Company";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="tiny-company-mark p-0 disabled:opacity-45"
          disabled={disabled || loading || companies.length === 0}
          aria-label={currentCompanyName ? t("nav.switchCompanyNamed", { name: currentCompanyName }) : t("nav.switchCompany")}
          title={currentCompanyName ? t("nav.companyNamed", { name: currentCompanyName }) : t("common.company")}
        >
          {logoUrl ? <img src={logoUrl} alt="" className="size-full rounded-xl object-cover" /> : <CompanyAvatar name={currentCompanyName} />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start" side="right">
        <DropdownMenuLabel>{t("common.company")}</DropdownMenuLabel>
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

function RouteLoadingFallback(): ReactElement {
  const { t } = useTranslation();
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">{t("nav.loadingWorkspace")}</div>;
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
