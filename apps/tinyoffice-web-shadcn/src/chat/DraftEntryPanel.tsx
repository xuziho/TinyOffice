import { Button } from "@/components/ui/button";
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
      <header className="flex min-h-14 items-center justify-between gap-3 border-b px-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{header.title}</h1>
          {header.subtitle ? <p className="truncate text-xs text-muted-foreground">{header.subtitle}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onBackToList}>
          Back to list
        </Button>
      </header>
      <div className="min-h-0 flex-1" />
      {error ? <div className="border-t px-4 py-2 text-xs text-destructive">{error}</div> : null}
      <RoomReplyComposer
        placeholder="Type a message..."
        onSendReply={onCreateEntry}
        notice={composerNotice}
        onClearNotice={onClearComposerNotice}
        mentionCandidates={model.mentionCandidates}
        submitLabel="Start topic"
        pendingLabel="Creating..."
        companyId={model.companyId}
        viewerMemberId={model.viewerMemberId}
        imageAttachmentsEnabled={model.imageAttachmentsEnabled}
      />
    </section>
  );
}
