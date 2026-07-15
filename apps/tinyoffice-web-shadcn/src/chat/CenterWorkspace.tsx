import type { ReactElement } from "react";
import type { AccessRequestDecision, AccessRequestDto } from "tinyoffice/frontend-api-contracts";
import type { ChatShellModel } from "./chatShellModel";
import type { ChatRunRecord, DraftReply } from "./chatRunState";
import { DraftEntryPanel } from "./DraftEntryPanel";
import { EntryListPanel } from "./EntryListPanel";
import { MessagePanel } from "./MessagePanel";
import { SystemMessage } from "./SystemMessage";
import { centerWorkspaceMode } from "./centerWorkspaceMode";
import type { ComposerSubmitValue } from "./mentionComposerModel";
import { useTranslation } from "react-i18next";

export function CenterWorkspace({
  model,
  status,
  error,
  onSelectEntry,
  onStartDraft,
  onArchiveEntry,
  onRestoreEntry,
  onBackToList,
  onCreateEntry,
  onSendReply,
  onClearComposerNotice,
  onCancelRun,
  onRetryRun,
  onResolveAccessRequest,
  onUpdateTitle,
  onOpenMessageActivity,
  selectedActivitySourceMessageId,
  activeRun,
  draftReply,
  isCancelingRun,
  accessRequests,
  isResolvingAccessRequest,
  composerNotice,
}: {
  model: ChatShellModel;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  onSelectEntry(entryId: string): void;
  onStartDraft(): void;
  onArchiveEntry(entryId: string): Promise<void>;
  onRestoreEntry(entryId: string): Promise<void>;
  onBackToList(): void;
  onCreateEntry(value: ComposerSubmitValue): Promise<void>;
  onSendReply(value: ComposerSubmitValue): Promise<void>;
  onClearComposerNotice(): void;
  onCancelRun(): Promise<void>;
  onRetryRun(): Promise<void>;
  onResolveAccessRequest(input: { request: AccessRequestDto; decision: AccessRequestDecision; note?: string }): Promise<void>;
  onUpdateTitle(title: string): Promise<void>;
  onOpenMessageActivity(input: { sourceMessageId: string }): void;
  selectedActivitySourceMessageId?: string;
  activeRun?: ChatRunRecord;
  draftReply?: DraftReply;
  isCancelingRun: boolean;
  accessRequests: AccessRequestDto[];
  isResolvingAccessRequest: boolean;
  composerNotice?: string;
}): ReactElement {
  const { t } = useTranslation();
  const mode = centerWorkspaceMode(model);
  if (mode === "entry-room") {
    return (
      <MessagePanel
        model={model}
        status={status}
        error={error}
        onBackToList={onBackToList}
        onSendReply={onSendReply}
        onClearComposerNotice={onClearComposerNotice}
        onCancelRun={onCancelRun}
        onRetryRun={onRetryRun}
        onResolveAccessRequest={onResolveAccessRequest}
        onUpdateTitle={onUpdateTitle}
        onOpenMessageActivity={onOpenMessageActivity}
        selectedActivitySourceMessageId={selectedActivitySourceMessageId}
        activeRun={activeRun}
        draftReply={draftReply}
        isCancelingRun={isCancelingRun}
        accessRequests={accessRequests}
        isResolvingAccessRequest={isResolvingAccessRequest}
        composerNotice={composerNotice}
      />
    );
  }

  if (mode === "entry-room-pending") {
    return (
      <section className="flex h-full min-w-0 flex-col overflow-hidden">
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <SystemMessage text={t("chat.loadingConversation")} />
          </div>
        </div>
      </section>
    );
  }

  if (mode === "draft-entry") {
    return (
      <DraftEntryPanel
        model={model}
        error={error}
        onBackToList={onBackToList}
        onCreateEntry={onCreateEntry}
        onClearComposerNotice={onClearComposerNotice}
        composerNotice={composerNotice}
      />
    );
  }

  return (
    <EntryListPanel
      model={model}
      status={status}
      error={error}
      onSelectEntry={onSelectEntry}
      onStartDraft={onStartDraft}
      onArchiveEntry={onArchiveEntry}
      onRestoreEntry={onRestoreEntry}
    />
  );
}
