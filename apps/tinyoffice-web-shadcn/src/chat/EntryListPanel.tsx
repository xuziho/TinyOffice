import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { chatRoomHref, shouldUseClientNavigation } from "@/app/navigationRoutes";
import { ArchiveIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import type { ChatShellModel } from "./chatShellModel";
import { StartEntryButton } from "./Composer";
import { SystemMessage } from "./SystemMessage";
import {
  activeEntryContainerId,
  emptyEntriesTextFor,
  entryListHeaderFor,
  entryListScrollKey,
  formatMessageTime,
  formatRelativeTime,
  startEntryLabelFor,
} from "./chatUiUtils";

export function EntryListPanel({
  model,
  status,
  error,
  onSelectEntry,
  onStartDraft,
  onArchiveEntry,
  onRestoreEntry,
}: {
  model: ChatShellModel;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  onSelectEntry(entryId: string): void;
  onStartDraft(): void;
  onArchiveEntry(entryId: string): Promise<void>;
  onRestoreEntry(entryId: string): Promise<void>;
}): ReactElement {
  const [showArchived, setShowArchived] = useState(false);
  const header = entryListHeaderFor(model);
  const createLabel = startEntryLabelFor(model);
  const canCreateEntry = activeEntryContainerId(model) !== undefined;
  const isChannel = model.selectedContainer?.kind === "channel";
  const archiveNoun = isChannel ? "topics" : "conversations";
  useEffect(() => setShowArchived(false), [model.selectedContainer?.containerId]);

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden">
      <header className="tiny-room-header flex items-center justify-between gap-3 border-b">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="tiny-room-title truncate">{showArchived ? `Archived ${archiveNoun}` : header.title}</h1>
            <span className="tiny-room-subtitle min-w-0 truncate">{showArchived ? header.title : header.subtitle}</span>
          </div>
        </div>
        {model.selectedContainer ? (
          <Button
            type="button"
            size={showArchived ? "sm" : "icon"}
            variant="ghost"
            className={showArchived ? "h-8 px-2 text-xs" : "tiny-archived-toggle relative h-8 w-8"}
            onClick={() => setShowArchived((current) => !current)}
            aria-label={showArchived ? "Back to topics" : `View archived ${archiveNoun}`}
            title={showArchived ? "Back to topics" : `View archived ${archiveNoun}`}
          >
            {showArchived ? (
              <><RotateCcwIcon className="size-3.5" /> Back to topics</>
            ) : (
              <ArchiveIcon className="size-4" />
            )}
          </Button>
        ) : null}
      </header>
      <EntryListSurface model={model} status={status} error={error} onSelectEntry={onSelectEntry} onStartDraft={onStartDraft} onArchiveEntry={onArchiveEntry} onRestoreEntry={onRestoreEntry} createLabel={!showArchived && canCreateEntry ? createLabel : undefined} showArchived={showArchived} />
    </section>
  );
}

function EntryListSurface({
  model,
  status,
  error,
  onSelectEntry,
  onStartDraft,
  onArchiveEntry,
  onRestoreEntry,
  createLabel,
  showArchived,
}: {
  model: ChatShellModel;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  onSelectEntry(entryId: string): void;
  onStartDraft(): void;
  onArchiveEntry(entryId: string): Promise<void>;
  onRestoreEntry(entryId: string): Promise<void>;
  createLabel?: string;
  showArchived: boolean;
}): ReactElement {
  const visibleEntries = showArchived ? model.archivedDirectoryEntries ?? [] : model.directoryEntries;
  return (
    <MessageScrollerProvider key={entryListScrollKey(model)} defaultScrollPosition="end">
      <MessageScroller className="min-w-0 flex-1">
        <MessageScrollerViewport className="tiny-message-viewport overflow-x-hidden">
          <EntryListScrollerContent>
            {error ? (
              <MessageScrollerItem>
                <SystemMessage text={error} tone="error" />
              </MessageScrollerItem>
            ) : null}
            {!error && visibleEntries.length === 0 ? (
              <MessageScrollerItem>
                <SystemMessage text={status === "loading" ? "Loading entries..." : showArchived ? "Nothing archived here." : emptyEntriesTextFor(model)} />
              </MessageScrollerItem>
            ) : null}
            {visibleEntries.map((entry) => (
              <MessageScrollerItem key={entry.entryId}>
                {showArchived ? (
                  <ArchivedTopicRow entry={entry} onRestoreEntry={onRestoreEntry} />
                ) : (
                  <EntryTopicRow entry={entry} onSelectEntry={onSelectEntry} onArchiveEntry={onArchiveEntry} />
                )}
              </MessageScrollerItem>
            ))}
            {createLabel ? (
              <MessageScrollerItem className="pt-7">
                <StartEntryButton label={createLabel} onStartDraft={onStartDraft} />
              </MessageScrollerItem>
            ) : null}
          </EntryListScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function ArchivedTopicRow({ entry, onRestoreEntry }: {
  entry: ChatShellModel["rooms"][number];
  onRestoreEntry(entryId: string): Promise<void>;
}): ReactElement {
  return (
    <div className="tiny-topic-row flex min-w-0 items-center justify-between gap-3 px-2 py-2.5">
      <span className="min-w-0">
        <span className="tiny-topic-title block truncate text-foreground">{entry.title}</span>
        {entry.summary ? <span className="tiny-topic-preview mt-0.5 block truncate font-normal">{entry.summary}</span> : null}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={() => void onRestoreEntry(entry.entryId)}>
        <RotateCcwIcon className="mr-2 size-3.5" /> Restore
      </Button>
    </div>
  );
}

function EntryTopicRow({
  entry,
  onSelectEntry,
  onArchiveEntry,
}: {
  entry: ChatShellModel["directoryEntries"][number];
  onSelectEntry(entryId: string): void;
  onArchiveEntry(entryId: string): Promise<void>;
}): ReactElement {
  const [isArchiveConfirming, setIsArchiveConfirming] = useState(false);
  const href = chatRoomHref({
    roomId: entry.openTarget.roomId,
    surface: entry.openTarget.kind === "dm_session_entry_room" ? "direct" : "channel",
  });

  return (
    <div
      role="button"
      tabIndex={0}
      className={isArchiveConfirming
        ? "tiny-topic-row group grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_5.75rem_1.75rem_4.75rem] items-center gap-2 px-2 py-2.5 text-left font-normal"
        : "tiny-topic-row group grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_5.75rem_1.75rem_2.125rem] items-center gap-2 px-2 py-2.5 text-left font-normal"}
      onClick={() => onSelectEntry(entry.entryId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectEntry(entry.entryId);
        }
      }}
    >
      <span className="min-w-0">
        <a
          href={href}
          className="tiny-topic-title block truncate text-foreground hover:underline"
          onClick={(event) => {
            if (!shouldUseClientNavigation(event)) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onSelectEntry(entry.entryId);
          }}
        >
          {entry.title}
        </a>
        {entry.summary ? <span className="tiny-topic-preview mt-0.5 block truncate font-normal">{entry.summary}</span> : null}
      </span>
      <span className="tiny-topic-time shrink-0 text-right text-xs font-normal">
        <EntryUpdatedTime entry={entry} />
      </span>
      <span className="flex min-h-5 min-w-5 items-center justify-end">
        <EntryUnreadBadge mentionCount={entry.mentionCount} unreadCount={entry.unreadCount} />
      </span>
      <ArchiveEntryAction
        entryId={entry.entryId}
        title={entry.title}
        isConfirming={isArchiveConfirming}
        onConfirmingChange={setIsArchiveConfirming}
        onArchiveEntry={onArchiveEntry}
      />
    </div>
  );
}

function EntryUnreadBadge({
  mentionCount,
  unreadCount,
}: {
  mentionCount: number;
  unreadCount: number;
}): ReactElement | null {
  if (mentionCount > 0) {
    return (
      <span className="tiny-attention-badge tiny-attention-badge-mention" aria-label={`${mentionCount} mention${mentionCount === 1 ? "" : "s"}`}>
        {mentionCount}
      </span>
    );
  }
  if (unreadCount > 0) {
    return (
      <span className="tiny-attention-badge tiny-attention-badge-unread" aria-label={`${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`}>
        {unreadCount}
      </span>
    );
  }
  return null;
}

function EntryListScrollerContent({ children }: { children: ReactNode }): ReactElement {
  return (
    <MessageScrollerContent className="min-w-0 justify-start gap-0 px-[42px] py-[26px]">
      <div className="tiny-main-width tiny-topic-list grid">
        {children}
      </div>
    </MessageScrollerContent>
  );
}

function ArchiveEntryAction({
  entryId,
  title,
  isConfirming,
  onConfirmingChange,
  onArchiveEntry,
}: {
  entryId: string;
  title: string;
  isConfirming: boolean;
  onConfirmingChange(value: boolean): void;
  onArchiveEntry(entryId: string): Promise<void>;
}): ReactElement {
  return (
    <Button
      type="button"
      size={isConfirming ? "sm" : "icon-xs"}
      variant="ghost"
      className={isConfirming
        ? "tiny-archive-confirm h-7 w-[4.5rem] justify-self-end px-2 text-xs"
        : "tiny-icon-quiet h-7 w-7 justify-self-end opacity-35 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"}
      aria-label={isConfirming ? `Confirm archive ${title}` : `Archive ${title}`}
      title={isConfirming ? "Confirm archive" : "Archive conversation"}
      onBlur={() => onConfirmingChange(false)}
      onClick={(event) => {
        event.stopPropagation();
        if (!isConfirming) {
          onConfirmingChange(true);
          return;
        }
        void onArchiveEntry(entryId);
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {isConfirming ? "Archive" : <ArchiveIcon className="h-3.5 w-3.5" />}
    </Button>
  );
}

function EntryUpdatedTime({ entry }: { entry: ChatShellModel["directoryEntries"][number] }): ReactElement {
  return (
    <span className="shrink-0 text-xs text-muted-foreground" title={`Last updated ${formatMessageTime(entry.updatedAt)}`}>
      {formatRelativeTime(entry.updatedAt)}
    </span>
  );
}
