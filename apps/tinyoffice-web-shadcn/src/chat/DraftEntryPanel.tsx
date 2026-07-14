import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "lucide-react";
import type { ReactElement } from "react";
import type { ChatShellModel } from "./chatShellModel";
import { RoomReplyComposer } from "./Composer";
import { messageHeaderFor } from "./chatUiUtils";
import type { ComposerSubmitValue } from "./mentionComposerModel";

export function DraftEntryPanel({
  model,
  error,
  onBackToList,
  onCreateEntry,
  onClearComposerNotice,
  composerNotice,
}: {
  model: ChatShellModel;
  error?: string;
  onBackToList(): void;
  onCreateEntry(value: ComposerSubmitValue): Promise<void>;
  onClearComposerNotice(): void;
  composerNotice?: string;
}): ReactElement {
  const header = messageHeaderFor(model);

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden">
      <header className="tiny-room-header flex items-center gap-2 border-b">
        <Button type="button" variant="ghost" size="icon" className="tiny-icon-quiet h-9 w-9 shrink-0 rounded-lg" onClick={onBackToList} aria-label="Back to list" title="Back to list">
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="tiny-room-title truncate">{header.title}</h1>
            {header.subtitle ? <span className="tiny-room-subtitle min-w-0 truncate">{header.subtitle}</span> : null}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1" />
      {error ? <div className="border-t px-4 py-2 text-xs text-destructive">{error}</div> : null}
      <RoomReplyComposer
        placeholder="Type a message..."
        onSendReply={onCreateEntry}
        notice={composerNotice}
        onClearNotice={onClearComposerNotice}
        mentionCandidates={model.mentionCandidates}
        allowAllMention={model.selectedContainer?.kind === "channel"}
        submitLabel="Start topic"
        pendingLabel="Creating..."
        companyId={model.companyId}
        viewerMemberId={model.viewerMemberId}
        imageAttachmentsEnabled={model.imageAttachmentsEnabled}
      />
    </section>
  );
}
