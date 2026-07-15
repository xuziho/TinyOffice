import { CenterWorkspace } from "@/chat/CenterWorkspace";
import { ContextPanel } from "@/chat/ContextPanel";
import { WorkspaceSidebar } from "@/chat/WorkspaceSidebar";
import { chatRouteFocusFromSearch, chatRouteForSelectedRoom, type ChatRouteFocus } from "@/chat/chatRouteSync";
import { browserTitleFor } from "@/chat/chatUiUtils";
import { useChatWorkspace } from "@/chat/useChatWorkspace";
import type { NavigationAlertState } from "@/chat/navigationAlertState";
import type { NavigationReturnContext, NavigationTarget } from "@/app/navigationRoutes";
import { useEffect, type ReactElement } from "react";
import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import { i18n } from "@/i18n";

export function ChatWorkspaceRoute({
  currentSession,
  companyName,
  focus,
  onFocusChange,
  onNavigationAlertsChange,
  onOpenNavigationTarget,
  onCommittedLocationChange,
}: {
  currentSession?: TinyOfficeCurrentSession;
  companyName?: string;
  focus: ChatRouteFocus;
  onFocusChange(focus: ChatRouteFocus): void;
  onNavigationAlertsChange(alerts: NavigationAlertState): void;
  onOpenNavigationTarget(target: NavigationTarget, options?: { from?: NavigationReturnContext }): void;
  onCommittedLocationChange(): void;
}): ReactElement {
  const workspace = useChatWorkspace({ requestedRoomId: focus.roomId, currentSession, sessionOwnedByParent: true });
  const { model } = workspace;

  useEffect(() => {
    document.title = browserTitleFor(model);
  }, [model]);

  useEffect(() => {
    onNavigationAlertsChange(workspace.navigationAlerts);
  }, [onNavigationAlertsChange, workspace.navigationAlerts]);

  useEffect(() => {
    const nextRoute = chatRouteForSelectedRoom({
      selectedRoomId: model.selectedRoomId,
      selectedContainerKind: model.selectedContainer?.kind,
    });
    if (!nextRoute || model.selectedRoomId === focus.roomId) {
      return;
    }
    onFocusChange(chatRouteFocusFromSearch(new URL(nextRoute, window.location.origin).search));
    window.history.replaceState({}, "", nextRoute);
    onCommittedLocationChange();
  }, [focus.roomId, model, onCommittedLocationChange, onFocusChange]);

  function clearChatRoute(): void {
    onFocusChange({});
    window.history.replaceState({}, "", "/chat");
    onCommittedLocationChange();
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

  const returnContext = chatReturnContextForModel(model);

  return (
    <div data-tiny-chat-workbench className="tiny-chat-workbench tiny-soft-retro-chat grid h-svh w-full overflow-hidden">
      <div data-tiny-chat-sidebar-pane className="min-w-0 overflow-hidden">
        <WorkspaceSidebar model={model} companyName={companyName} onSelectSurface={selectChatSurface} onCreateChannel={workspace.createChannel} />
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
          activityIsPrevious={Boolean(workspace.activeRun?.sourceMessageId && workspace.activitySelection?.sourceMessageId !== workspace.activeRun.sourceMessageId)}
          onOpenSession={(sessionFocus) => onOpenNavigationTarget({ kind: "session", ...sessionFocus }, { from: returnContext })}
          onOpenNavigationTarget={(target) => onOpenNavigationTarget(target, { from: returnContext })}
          onUpdateChannelDetails={workspace.updateChannelDetails}
          onAddChannelMembers={workspace.addChannelMembers}
          onRemoveChannelMember={workspace.removeChannelMember}
          onDissolveChannel={workspace.dissolveChannel}
        />
      </div>
    </div>
  );
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
    label: i18n.t("chat.backToRoom", { title: model.context.room.title }),
    target: { kind: "chat-room", roomId: focus.roomId, surface: focus.surface },
  };
}
