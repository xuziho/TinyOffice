import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { AccessRequestCards } from "@/access/AccessRequestCards";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmployeeAvatar } from "@/components/product/EmployeeAvatar";
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { AccessRequestDecision, AccessRequestDto, MessagePage } from "tinyoffice/frontend-api-contracts";
import { ArrowLeftIcon, EditIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { messagesWithoutReconciledReply, persistedMessageForDraftReply } from "./chatReplyReconciliation";
import ReactMarkdown from "react-markdown";
import type { ChatShellModel } from "./chatShellModel";
import type { ChatRunRecord, DraftReply } from "./chatRunState";
import { RoomReplyComposer } from "./Composer";
import { SystemMessage } from "./SystemMessage";
import { formatMessageTime, memberDisplayNameFor, messageAlignFor, messageHeaderFor, messageStreamScrollKey } from "./chatUiUtils";
import { activitySourceForMessage } from "./messageActivitySource";
import type { ComposerSubmitValue } from "./mentionComposerModel";

export function MessagePanel({
  model,
  status,
  error,
  onBackToList,
  onSendReply,
  onClearComposerNotice,
  onCancelRun,
  onRetryRun,
  onResolveAccessRequest,
  onOpenMessageActivity,
  selectedActivitySourceMessageId,
  activeRun,
  draftReply,
  isCancelingRun,
  onUpdateTitle,
  accessRequests,
  isResolvingAccessRequest,
  composerNotice,
}: {
  model: ChatShellModel;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  onBackToList(): void;
  onSendReply(value: ComposerSubmitValue): Promise<void>;
  onClearComposerNotice(): void;
  onCancelRun(): Promise<void>;
  onRetryRun(): Promise<void>;
  onResolveAccessRequest(input: { request: AccessRequestDto; decision: AccessRequestDecision; note?: string }): Promise<void>;
  onOpenMessageActivity(input: { sourceMessageId: string }): void;
  selectedActivitySourceMessageId?: string;
  activeRun?: ChatRunRecord;
  draftReply?: DraftReply;
  isCancelingRun: boolean;
  onUpdateTitle(title: string): Promise<void>;
  accessRequests: AccessRequestDto[];
  isResolvingAccessRequest: boolean;
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
          <div className="group/title flex min-w-0 items-center gap-2">
            <h1 className="tiny-room-title truncate">{header.title}</h1>
            {header.subtitle ? <span className="tiny-room-subtitle min-w-0 truncate">{header.subtitle}</span> : null}
            <ThreadTitleEditor title={header.title} onUpdateTitle={onUpdateTitle} />
          </div>
        </div>
      </header>
      <EntryRoomSurface
        model={model}
        status={status}
        error={error}
        onSendReply={onSendReply}
        onClearComposerNotice={onClearComposerNotice}
        onCancelRun={onCancelRun}
        onRetryRun={onRetryRun}
        onResolveAccessRequest={onResolveAccessRequest}
        onOpenMessageActivity={onOpenMessageActivity}
        selectedActivitySourceMessageId={selectedActivitySourceMessageId}
        activeRun={activeRun}
        draftReply={draftReply}
        isCancelingRun={isCancelingRun}
        accessRequests={accessRequests}
        isResolvingAccessRequest={isResolvingAccessRequest}
        composerNotice={composerNotice}
      />
    </section>
  );
}

function ThreadTitleEditor({
  title,
  onUpdateTitle,
}: {
  title: string;
  onUpdateTitle(title: string): Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(title);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && trimmed !== title && !isSaving;

  useEffect(() => {
    if (!open) {
      setDraft(title);
      setError(undefined);
    }
  }, [open, title]);

  async function submitTitle(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    setIsSaving(true);
    setError(undefined);
    try {
      await onUpdateTitle(trimmed);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update title.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" className="tiny-icon-quiet opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100" aria-label="Edit topic title">
          <EditIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="tiny-chat-dialog">
        <form onSubmit={submitTitle} className="contents">
          <DialogHeader>
            <DialogTitle>Edit topic title</DialogTitle>
            <DialogDescription>Rename this topic for everyone in the room.</DialogDescription>
          </DialogHeader>
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EntryRoomSurface({
  model,
  status,
  error,
  onSendReply,
  onClearComposerNotice,
  onCancelRun,
  onRetryRun,
  onResolveAccessRequest,
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
  onSendReply(value: ComposerSubmitValue): Promise<void>;
  onClearComposerNotice(): void;
  onCancelRun(): Promise<void>;
  onRetryRun(): Promise<void>;
  onResolveAccessRequest(input: { request: AccessRequestDto; decision: AccessRequestDecision; note?: string }): Promise<void>;
  onOpenMessageActivity(input: { sourceMessageId: string }): void;
  selectedActivitySourceMessageId?: string;
  activeRun?: ChatRunRecord;
  draftReply?: DraftReply;
  isCancelingRun: boolean;
  accessRequests: AccessRequestDto[];
  isResolvingAccessRequest: boolean;
  composerNotice?: string;
}): ReactElement {
  const draftDisplayName = draftReply ? memberDisplayNameFor(model, draftReply.targetMemberId) ?? "Unknown participant" : undefined;
  const persistedDraftReply = persistedMessageForDraftReply(model.messages, draftReply);
  const visibleMessages = messagesWithoutReconciledReply(model.messages, persistedDraftReply);
  const streamStatus = messageStreamStatus({ status, error, messageCount: model.messages.length });

  return (
    <>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <MessageScrollerProvider key={messageStreamScrollKey(model)} autoScroll defaultScrollPosition="end">
          <MessageScroller className="h-full min-w-0">
            <MessageScrollerViewport className="tiny-message-viewport overflow-x-hidden">
              <MessageStreamScrollerContent>
                {visibleMessages.map((message) => (
                  <MessageRow
                    key={message.messageId}
                    message={message}
                    model={model}
                    onOpenMessageActivity={onOpenMessageActivity}
                    selectedActivitySourceMessageId={selectedActivitySourceMessageId}
                  />
                ))}
                {draftReply ? (
                  <ReplyRunRow
                    key={`draft-${draftReply.runId}`}
                    draftReply={draftReply}
                    persistedMessage={persistedDraftReply}
                    displayName={draftDisplayName || draftReply.targetMemberId}
                    avatarSeed={model.directoryMembers.find((member) => member.memberId === draftReply.targetMemberId)?.avatarSeed ?? draftReply.targetMemberId}
                    onRetryRun={onRetryRun}
                    onOpenMessageActivity={onOpenMessageActivity}
                    selectedActivitySourceMessageId={selectedActivitySourceMessageId}
                  />
                ) : null}
              </MessageStreamScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
        {streamStatus ? <MessageStreamStatusOverlay text={streamStatus.text} tone={streamStatus.tone} /> : null}
      </div>
      <RoomAccessRequestPanel
        requests={accessRequests}
        busy={isResolvingAccessRequest}
        onResolveAccessRequest={onResolveAccessRequest}
      />
      <RoomReplyComposer
        placeholder="Type a message..."
        onSendReply={onSendReply}
        notice={composerNotice}
        onClearNotice={onClearComposerNotice}
        mentionCandidates={model.mentionCandidates}
        isRunActive={Boolean(activeRun)}
        isCancelingRun={isCancelingRun}
        onCancelRun={onCancelRun}
        companyId={model.companyId}
        viewerMemberId={model.viewerMemberId}
        imageAttachmentsEnabled={model.imageAttachmentsEnabled}
      />
    </>
  );
}

function ReplyRunRow({
  draftReply,
  persistedMessage,
  displayName,
  avatarSeed,
  onRetryRun,
  onOpenMessageActivity,
  selectedActivitySourceMessageId,
}: {
  draftReply: DraftReply;
  persistedMessage?: MessagePage["messages"][number];
  displayName: string;
  avatarSeed: string;
  onRetryRun(): Promise<void>;
  onOpenMessageActivity(input: { sourceMessageId: string }): void;
  selectedActivitySourceMessageId?: string;
}): ReactElement {
  const activitySource = persistedMessage ? activitySourceForMessage(persistedMessage) : undefined;
  const isActivitySourceSelected = Boolean(activitySource && activitySource.sourceMessageId === selectedActivitySourceMessageId);
  const openActivity = () => {
    if (activitySource) {
      onOpenMessageActivity({ sourceMessageId: activitySource.sourceMessageId });
    }
  };
  const handleActivityClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("a,button")) {
      return;
    }
    openActivity();
  };
  const handleActivityKeyDown = (event: KeyboardEvent) => {
    if (!activitySource || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    openActivity();
  };
  const contentClassName = activitySource
    ? "max-w-full gap-1 overflow-hidden rounded-md transition-colors hover:bg-muted/20 focus-visible:bg-muted/30 focus-visible:outline-none"
    : "max-w-full gap-1 overflow-hidden";
  const senderMemberId = persistedMessage?.sender.memberId ?? draftReply.targetMemberId;
  const senderDisplayName = persistedMessage?.sender.displayName ?? displayName;

  return (
    <MessageScrollerItem messageId={`draft-${draftReply.runId}`} className="tiny-message-item">
      <Message align="start" className="tiny-message-row max-w-full overflow-visible px-0.5 py-1.5">
        <MessageAvatar>
          <EmployeeAvatar memberId={senderMemberId} avatarSeed={avatarSeed} displayName={senderDisplayName} kind="employee" className="size-11" />
        </MessageAvatar>
        <MessageContent
          className={contentClassName}
          role={activitySource ? "button" : undefined}
          tabIndex={activitySource ? 0 : undefined}
          aria-label={persistedMessage && activitySource ? `Show activity for ${senderDisplayName}'s message from ${formatMessageTime(persistedMessage.createdAt)}` : undefined}
          aria-pressed={activitySource ? isActivitySourceSelected : undefined}
          onClick={activitySource ? handleActivityClick : undefined}
          onKeyDown={activitySource ? handleActivityKeyDown : undefined}
        >
          <MessageHeader className="tiny-message-meta gap-2 px-0">
            <span className="truncate font-semibold text-foreground">{senderDisplayName}</span>
            <span className="shrink-0 text-muted-foreground/70">-</span>
            {persistedMessage ? (
              <>
                <span className="shrink-0 text-muted-foreground/70">{formatMessageTime(persistedMessage.createdAt)}</span>
                {persistedMessage.runtimeUsage && usageMagnitude(persistedMessage.runtimeUsage) > 0 ? (
                  <>
                    <span className="shrink-0 text-muted-foreground/70">-</span>
                    <span className="shrink-0 text-[11px] font-normal text-muted-foreground/70" title={usageTitle(persistedMessage.runtimeUsage)}>
                      {formatRuntimeUsage(persistedMessage.runtimeUsage)}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              <span className="shrink-0 text-muted-foreground/70">{draftStatusLabel(draftReply)}</span>
            )}
          </MessageHeader>
          {persistedMessage ? <MessageAttachments attachments={persistedMessage.attachments} align="start" /> : null}
          <Bubble variant="ghost" className="max-w-full">
            <BubbleContent className="tiny-message-body break-words [overflow-wrap:anywhere]">
              <MarkdownMessageBody body={persistedMessage?.body ?? draftReply.content} />
            </BubbleContent>
          </Bubble>
          {draftReply.status === "failed" ? (
            <Button type="button" size="sm" variant="outline" className="mt-2 w-fit" onClick={() => void onRetryRun()}>
              Retry original message
            </Button>
          ) : null}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

function RoomAccessRequestPanel({
  requests,
  busy,
  onResolveAccessRequest,
}: {
  requests: AccessRequestDto[];
  busy: boolean;
  onResolveAccessRequest(input: { request: AccessRequestDto; decision: AccessRequestDecision; note?: string }): Promise<void>;
}): ReactElement | null {
  if (requests.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-[var(--tiny-line-soft)] bg-background px-[42px] py-2">
      <div className="tiny-main-width mx-auto">
        <AccessRequestCards
          requests={requests}
          busy={busy}
          onResolveAccessRequest={onResolveAccessRequest}
        />
      </div>
    </div>
  );
}

function messageStreamStatus({
  status,
  error,
  messageCount,
}: {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  messageCount: number;
}): { text: string; tone: "default" | "error" } | undefined {
  if (error) {
    return { text: error, tone: "error" };
  }
  if (messageCount > 0) {
    return undefined;
  }
  return { text: status === "loading" ? "Loading messages..." : "No messages in this room yet.", tone: "default" };
}

function MessageStreamStatusOverlay({ text, tone }: { text: string; tone: "default" | "error" }): ReactElement {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <SystemMessage text={text} tone={tone} />
    </div>
  );
}

function MessageRow({
  message,
  model,
  onOpenMessageActivity,
  selectedActivitySourceMessageId,
}: {
  message: MessagePage["messages"][number];
  model: ChatShellModel;
  onOpenMessageActivity(input: { sourceMessageId: string }): void;
  selectedActivitySourceMessageId?: string;
}): ReactElement {
  const activitySource = activitySourceForMessage(message);
  const align = messageAlignFor(message, model);
  const isActivitySourceSelected = Boolean(activitySource && activitySource.sourceMessageId === selectedActivitySourceMessageId);
  const openActivity = () => {
    if (activitySource) {
      onOpenMessageActivity({ sourceMessageId: activitySource.sourceMessageId });
    }
  };
  const handleActivityClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("a,button")) {
      return;
    }
    openActivity();
  };
  const handleActivityKeyDown = (event: KeyboardEvent) => {
    if (!activitySource || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    openActivity();
  };
  const activityContentClassName = activitySource
    ? "max-w-full gap-1 overflow-hidden rounded-md transition-colors hover:bg-muted/20 focus-visible:bg-muted/30 focus-visible:outline-none"
    : "max-w-full gap-1 overflow-hidden";
  return (
    <>
      <MessageScrollerItem messageId={message.messageId} className="tiny-message-item">
        <Message align={align} className="tiny-message-row max-w-full overflow-visible px-0.5 py-1.5">
          <MessageAvatar>
            <EmployeeAvatar
              memberId={message.sender.memberId ?? message.sender.participantId}
              avatarSeed={messageSenderAvatarSeed(message, model)}
              displayName={message.sender.displayName}
              kind={messageSenderIsEmployee(message, model) ? "employee" : "member"}
              className="size-11"
            />
          </MessageAvatar>
          <MessageContent
            className={activityContentClassName}
            role={activitySource ? "button" : undefined}
            tabIndex={activitySource ? 0 : undefined}
            aria-label={activitySource ? `Show activity for ${message.sender.displayName}'s message from ${formatMessageTime(message.createdAt)}` : undefined}
            aria-pressed={activitySource ? isActivitySourceSelected : undefined}
            onClick={activitySource ? handleActivityClick : undefined}
            onKeyDown={activitySource ? handleActivityKeyDown : undefined}
          >
            <MessageMeta
              message={message}
              model={model}
            />
            <MessageAttachments attachments={message.attachments} align={align} />
            <Bubble
              variant={align === "end" ? "secondary" : "ghost"}
              className={align === "end" ? "tiny-message-mine max-w-full" : "max-w-full"}
            >
              <BubbleContent className="tiny-message-body break-words [overflow-wrap:anywhere]">
                <MarkdownMessageBody body={message.body} />
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    </>
  );
}

function messageSenderIsEmployee(message: MessagePage["messages"][number], model: ChatShellModel): boolean {
  const memberId = message.sender.memberId;
  return Boolean(memberId && model.directoryMembers.some((member) => member.memberId === memberId && member.hasRuntimeProfile));
}

function messageSenderAvatarSeed(message: MessagePage["messages"][number], model: ChatShellModel): string {
  const memberId = message.sender.memberId ?? message.sender.participantId;
  return model.directoryMembers.find((member) => member.memberId === memberId)?.avatarSeed ?? memberId;
}

function MessageAttachments({
  attachments,
  align,
}: {
  attachments: MessagePage["messages"][number]["attachments"];
  align: "start" | "end";
}): ReactElement | null {
  const imageAttachments = attachments.filter((attachment) => attachment.mimeType.startsWith("image/"));
  if (imageAttachments.length === 0) {
    return null;
  }
  return (
    <div className={`mb-2 flex max-w-full flex-wrap gap-2 ${align === "end" ? "justify-end" : "justify-start"}`}>
      {imageAttachments.map((attachment) => (
        <a
          key={attachment.attachmentId}
          href={attachment.previewUrl || attachment.downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="tiny-chat-attachment-card block max-w-56 overflow-hidden rounded-md border bg-muted"
        >
          <img
            src={attachment.previewUrl || attachment.downloadUrl}
            alt={attachment.fileName}
            className="max-h-48 w-full object-contain"
          />
        </a>
      ))}
    </div>
  );
}

function draftStatusLabel(draftReply: DraftReply): string {
  switch (draftReply.status) {
    case "canceled":
      return "stopped - not sent";
    case "failed":
      return "failed - not sent";
    default:
      return "writing";
  }
}

function MessageStreamScrollerContent({ children }: { children: ReactNode }): ReactElement {
  return (
    <MessageScrollerContent className="min-w-0 justify-end px-[42px] pb-[22px] pt-7">
      <div className="tiny-main-width flex min-h-full flex-col justify-end">
        {children}
      </div>
    </MessageScrollerContent>
  );
}

function MessageMeta({
  message,
  model,
}: {
  message: MessagePage["messages"][number];
  model: ChatShellModel;
}): ReactElement {
  const align = messageAlignFor(message, model);
  return (
    <MessageHeader className={align === "end" ? "tiny-message-meta justify-end gap-2 px-0" : "tiny-message-meta gap-2 px-0"}>
      <span className="truncate font-semibold text-foreground">{message.sender.displayName}</span>
      <span className="shrink-0 text-muted-foreground/70">-</span>
      <span className="shrink-0 text-muted-foreground/70">{formatMessageTime(message.createdAt)}</span>
      {message.runtimeUsage && usageMagnitude(message.runtimeUsage) > 0 ? (
        <>
          <span className="shrink-0 text-muted-foreground/70">-</span>
          <span className="shrink-0 text-[11px] font-normal text-muted-foreground/70" title={usageTitle(message.runtimeUsage)}>
            {formatRuntimeUsage(message.runtimeUsage)}
          </span>
        </>
      ) : null}
    </MessageHeader>
  );
}

function usageMagnitude(usage: NonNullable<MessagePage["messages"][number]["runtimeUsage"]>): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheTokens;
}

function formatRuntimeUsage(usage: NonNullable<MessagePage["messages"][number]["runtimeUsage"]>): string {
  return [
    `in ${formatCompactNumber(usage.inputTokens)}`,
    `out ${formatCompactNumber(usage.outputTokens)}`,
    usage.cacheTokens > 0 ? `cache ${formatCompactNumber(usage.cacheTokens)}` : undefined,
  ].filter(Boolean).join(" / ");
}

function usageTitle(usage: NonNullable<MessagePage["messages"][number]["runtimeUsage"]>): string {
  return [
    `Input tokens: ${usage.inputTokens.toLocaleString()}`,
    `Output tokens: ${usage.outputTokens.toLocaleString()}`,
    `Cache tokens: ${usage.cacheTokens.toLocaleString()}`,
  ].join("\n");
}

function formatCompactNumber(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  if (rounded < 1000) {
    return rounded.toLocaleString();
  }
  const compact = rounded / 1000;
  return `${compact >= 10 ? Math.round(compact) : compact.toFixed(1).replace(/\.0$/, "")}k`;
}

function MarkdownMessageBody({ body }: { body: string }): ReactElement {
  return (
    <div className="space-y-2 [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded-sm [&_code]:bg-background/70 [&_code]:px-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-background/70 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{renderMentionNodes(children)}</p>,
          li: ({ children }) => <li>{renderMentionNodes(children)}</li>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function renderMentionNodes(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return renderMentionString(children);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => <FragmentLike key={index}>{renderMentionNodes(child)}</FragmentLike>);
  }
  return children;
}

function renderMentionString(value: string): ReactNode {
  const parts: ReactNode[] = [];
  const mentionPattern = /@[\p{L}\p{N}_-]+/gu;
  let cursor = 0;
  for (const match of value.matchAll(mentionPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(value.slice(cursor, index));
    }
    const mention = match[0];
    parts.push(
      <span key={`${mention}-${index}`} className="tiny-mention-chip">
        {mention}
      </span>,
    );
    cursor = index + mention.length;
  }
  if (cursor < value.length) {
    parts.push(value.slice(cursor));
  }
  return parts.length > 0 ? parts : value;
}

function FragmentLike({ children }: { children: ReactNode }): ReactElement {
  return <>{children}</>;
}
