import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { EmployeeAvatar } from "@/components/product/EmployeeAvatar";
import { discardChatImageAttachment, uploadChatImageAttachment } from "@/api/chatClient";
import { AtSignIcon, ImageIcon, MessageSquarePlusIcon, PaperclipIcon, SendIcon, SquareIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type FocusEvent, type ReactElement } from "react";
import { shouldSubmitComposerKey } from "./composerKeyModel";
import { canAcceptImageFile, pendingImageFromFile, type PendingImageAttachment } from "./imageAttachmentState";
import {
  applyMentionSelection,
  applyAllMentionSelection,
  buildComposerSubmitValue,
  composerErrorMessage,
  ensureMentionStarter,
  isAllMentionOptionVisible,
  visibleMentionOptions,
  type ComposerSubmitValue,
  type MentionCandidate,
} from "./mentionComposerModel";

export function StartEntryButton({
  label,
  onStartDraft,
}: {
  label: string;
  onStartDraft(): void;
}): ReactElement {
  return (
    <div className="flex justify-center">
      <Button type="button" variant="secondary" className="h-10 w-full max-w-sm justify-center rounded-md text-sm" onClick={onStartDraft}>
        <MessageSquarePlusIcon data-icon="inline-start" />
        {label}
      </Button>
    </div>
  );
}

export function RoomReplyComposer({
  placeholder,
  onSendReply,
  mentionCandidates = [],
  allowAllMention = false,
  submitLabel = "Send",
  pendingLabel = "Sending...",
  isRunActive = false,
  isCancelingRun = false,
  onCancelRun,
  companyId,
  viewerMemberId,
  imageAttachmentsEnabled = true,
  notice,
  onClearNotice,
}: {
  placeholder: string;
  onSendReply(value: ComposerSubmitValue): Promise<void>;
  mentionCandidates?: MentionCandidate[];
  allowAllMention?: boolean;
  submitLabel?: string;
  pendingLabel?: string;
  isRunActive?: boolean;
  isCancelingRun?: boolean;
  onCancelRun?(): Promise<void>;
  companyId?: string;
  viewerMemberId?: string;
  imageAttachmentsEnabled?: boolean;
  notice?: string;
  onClearNotice?(): void;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>();
  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>([]);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [selectedMentionCandidates, setSelectedMentionCandidates] = useState<MentionCandidate[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImagesRef = useRef<PendingImageAttachment[]>([]);
  const discardedImageIdsRef = useRef(new Set<string>());
  const hadComposerFocusRef = useRef(false);
  const mentionOptions = visibleMentionOptions(draft, mentionCandidates);
  const showAllMentionOption = allowAllMention && isAllMentionOptionVisible(draft);
  const showMentionOptions = mentionMenuOpen && (showAllMentionOption || mentionOptions.length > 0);
  const canMention = allowAllMention || mentionCandidates.some((candidate) =>
    Boolean(candidate.memberId?.trim() && candidate.displayName.trim() && candidate.hasRuntimeProfile !== false)
  );
  const isUploadingAttachments = pendingImages.some((image) => image.status === "queued" || image.status === "uploading");
  const hasFailedAttachments = pendingImages.some((image) => image.status === "failed");
  const uploadedAttachmentIds = pendingImages
    .map((image) => image.attachmentId)
    .filter((attachmentId): attachmentId is string => Boolean(attachmentId));
  const submitValue = buildComposerSubmitValue({
    draft,
    uploadedAttachmentIds,
    mentionCandidates,
    selectedMentionCandidates,
  });
  const canSend = Boolean(submitValue) && !isSending && !isRunActive && !isUploadingAttachments && !hasFailedAttachments;

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  const discardUploadedAttachment = useCallback(async (attachmentId: string): Promise<void> => {
    if (!companyId || !viewerMemberId) {
      return;
    }
    await discardChatImageAttachment({
      companyId,
      memberId: viewerMemberId,
      attachmentId,
    }).catch(() => undefined);
  }, [companyId, viewerMemberId]);

  const cleanupPendingAttachments = useCallback((): void => {
      for (const image of pendingImagesRef.current) {
        URL.revokeObjectURL(image.previewObjectUrl);
        discardedImageIdsRef.current.add(image.localId);
        if (image.attachmentId) {
          void discardUploadedAttachment(image.attachmentId);
        }
      }
      pendingImagesRef.current = [];
  }, [discardUploadedAttachment]);

  useEffect(() => cleanupPendingAttachments, [cleanupPendingAttachments]);

  useEffect(() => {
    function restoreComposerFocus(): void {
      if (!hadComposerFocusRef.current || isSending) {
        return;
      }
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement !== document.body) {
        return;
      }
      requestAnimationFrame(() => textareaRef.current?.focus());
    }

    window.addEventListener("focus", restoreComposerFocus);
    return () => window.removeEventListener("focus", restoreComposerFocus);
  }, [isSending]);

  function selectMention(candidate: MentionCandidate): void {
    onClearNotice?.();
    setDraft((current) => applyMentionSelection(current, candidate));
    setSelectedMentionCandidates((current) => [
      ...current.filter((selected) => selected.memberId !== candidate.memberId),
      candidate,
    ]);
    setMentionMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function selectAllMention(): void {
    onClearNotice?.();
    setDraft((current) => applyAllMentionSelection(current));
    setMentionMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function openMentionPicker(): void {
    const currentDraft = textareaRef.current?.value ?? draft;
    const nextDraft = ensureMentionStarter(currentDraft);
    setDraft(nextDraft);
    setMentionMenuOpen((allowAllMention && isAllMentionOptionVisible(nextDraft)) || visibleMentionOptions(nextDraft, mentionCandidates).length > 0);
    hadComposerFocusRef.current = true;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleTextareaFocus(): void {
    hadComposerFocusRef.current = true;
  }

  function handleTextareaBlur(event: FocusEvent<HTMLTextAreaElement>): void {
    if (!document.hasFocus()) {
      return;
    }
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && formRef.current?.contains(nextTarget)) {
      return;
    }
    hadComposerFocusRef.current = false;
  }

  async function submit(): Promise<void> {
    if (!submitValue || !canSend) {
      return;
    }
    setIsSending(true);
    setError(undefined);
    try {
      await onSendReply(submitValue);
      setDraft("");
      setSelectedMentionCandidates([]);
      setMentionMenuOpen(false);
      clearPendingImages();
    } catch (caught) {
      setError(composerErrorMessage(caught));
    } finally {
      setIsSending(false);
    }
  }

  function addImageFiles(files: Iterable<File>): void {
    if (!imageAttachmentsEnabled) {
      setError("This employee cannot inspect images with the current model.");
      return;
    }
    for (const file of files) {
      if (!canAcceptImageFile(file)) {
        setError("Only PNG, JPEG, and WebP images can be attached.");
        continue;
      }
      const pending = pendingImageFromFile(file);
      setPendingImages((current) => [...current, pending]);
      void uploadPendingImage(pending);
    }
  }

  async function uploadPendingImage(pending: PendingImageAttachment): Promise<void> {
    if (!companyId || !viewerMemberId) {
      setPendingImages((current) => current.map((image) =>
        image.localId === pending.localId ? { ...image, status: "failed", error: "viewer identity is required" } : image
      ));
      return;
    }
    setPendingImages((current) => current.map((image) =>
      image.localId === pending.localId ? { ...image, status: "uploading", error: undefined } : image
    ));
    try {
      const response = await uploadChatImageAttachment({
        companyId,
        memberId: viewerMemberId,
        file: pending.file,
      });
      if (discardedImageIdsRef.current.has(pending.localId)) {
        void discardUploadedAttachment(response.attachment.attachmentId);
        return;
      }
      setPendingImages((current) => current.map((image) =>
        image.localId === pending.localId
          ? { ...image, status: "uploaded", attachmentId: response.attachment.attachmentId, error: undefined }
          : image
      ));
    } catch (caught) {
      setPendingImages((current) => current.map((image) =>
        image.localId === pending.localId
          ? { ...image, status: "failed", error: composerErrorMessage(caught) }
          : image
      ));
    }
  }

  function removePendingImage(localId: string): void {
    discardedImageIdsRef.current.add(localId);
    setPendingImages((current) => {
      const removed = current.find((image) => image.localId === localId);
      if (removed) {
        URL.revokeObjectURL(removed.previewObjectUrl);
        if (removed.attachmentId) {
          void discardUploadedAttachment(removed.attachmentId);
        }
      }
      const next = current.filter((image) => image.localId !== localId);
      pendingImagesRef.current = next;
      return next;
    });
  }

  function clearPendingImages(): void {
    setPendingImages((current) => {
      for (const image of current) {
        URL.revokeObjectURL(image.previewObjectUrl);
      }
      pendingImagesRef.current = [];
      return [];
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const files = [...event.clipboardData.files].filter(canAcceptImageFile);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    if (!imageAttachmentsEnabled) {
      setError("This employee cannot inspect images with the current model.");
      return;
    }
    addImageFiles(files);
  }

  async function cancelRun(): Promise<void> {
    if (!onCancelRun || isCancelingRun) {
      return;
    }
    setError(undefined);
    try {
      await onCancelRun();
    } catch (caught) {
      setError(composerErrorMessage(caught));
    }
  }

  return (
    <footer className="tiny-composer border-t">
      {notice ? (
        <div className="tiny-composer-box pb-0 pt-2 text-xs text-muted-foreground">
          {notice}
        </div>
      ) : null}
      <form
        ref={formRef}
        className="tiny-composer-box grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(event) => {
            addImageFiles(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
          }}
        />
        {pendingImages.length > 0 ? (
          <div className="flex max-w-full flex-wrap gap-2">
            {pendingImages.map((image) => (
              <div key={image.localId} className="tiny-chat-attachment-card grid w-28 gap-1 rounded-md border bg-muted/30 p-1.5">
                <div className="relative aspect-square overflow-hidden rounded-sm bg-background">
                  <img src={image.previewObjectUrl} alt={image.fileName} className="h-full w-full object-cover" />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-xs"
                    className="absolute right-1 top-1 h-6 w-6"
                    aria-label={`Remove ${image.fileName}`}
                    onClick={() => removePendingImage(image.localId)}
                  >
                    <XIcon />
                  </Button>
                </div>
                <div className="min-w-0 truncate text-xs">{image.fileName}</div>
                <div className={image.status === "failed" ? "truncate text-xs text-destructive" : "truncate text-xs text-muted-foreground"}>
                  {image.status === "uploaded" ? "Ready" : image.status === "failed" ? image.error : "Uploading..."}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <Popover open={showMentionOptions} onOpenChange={setMentionMenuOpen}>
          <PopoverAnchor asChild>
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                const nextDraft = event.currentTarget.value;
                onClearNotice?.();
                setDraft(nextDraft);
                setMentionMenuOpen((allowAllMention && isAllMentionOptionVisible(nextDraft)) || visibleMentionOptions(nextDraft, mentionCandidates).length > 0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setMentionMenuOpen(false);
                  return;
                }
                if (shouldSubmitComposerKey(event)) {
                  event.preventDefault();
                  void submit();
                }
              }}
              onFocus={handleTextareaFocus}
              onBlur={handleTextareaBlur}
              onPaste={handlePaste}
              placeholder={placeholder}
              className="tiny-composer-input resize-none px-1 py-1 focus-visible:ring-0"
              rows={2}
              disabled={isSending}
            />
          </PopoverAnchor>
          <PopoverContent align="start" side="top" className="tiny-chat-mention-popover w-72 p-1" onOpenAutoFocus={(event) => event.preventDefault()}>
            <Command shouldFilter={false} className="tiny-chat-mention-command">
              <CommandList className="max-h-56">
                <CommandGroup>
                  {showAllMentionOption ? (
                    <CommandItem
                      value="all"
                      className="tiny-chat-mention-item"
                      onMouseDown={(event) => event.preventDefault()}
                      onSelect={selectAllMention}
                    >
                      <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">@</span>
                      <span className="min-w-0 flex-1 truncate">all</span>
                      <span className="text-xs text-muted-foreground">Message everyone</span>
                    </CommandItem>
                  ) : null}
                  {mentionOptions.map((candidate) => (
                    <CommandItem
                      key={candidate.memberId}
                      value={candidate.memberId}
                      className="tiny-chat-mention-item"
                      onMouseDown={(event) => event.preventDefault()}
                      onSelect={() => selectMention(candidate)}
                    >
                      <EmployeeAvatar memberId={candidate.memberId} avatarSeed={candidate.avatarSeed ?? candidate.memberId} displayName={candidate.displayName} className="size-7" />
                      <span className="min-w-0 flex-1 truncate">{candidate.displayName}</span>
                      {candidate.role ? <span className="max-w-32 truncate text-xs text-muted-foreground">{candidate.role}</span> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
        <div className="flex items-center justify-between gap-2">
          <div className="composer-toolbar-actions flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="tiny-tool-button"
              aria-label="Attach image"
              title="Attach image"
              disabled={!imageAttachmentsEnabled || isSending || isRunActive}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImageIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="tiny-tool-button"
              aria-label="Attach file"
              title="File attachments are not available yet"
              disabled
              onMouseDown={(event) => event.preventDefault()}
            >
              <PaperclipIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="tiny-tool-button"
              aria-label="Mention someone"
              title="Mention someone"
              disabled={!canMention || isSending}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openMentionPicker}
            >
              <AtSignIcon />
            </Button>
          </div>
          <Button
            type={isRunActive ? "button" : "submit"}
            size="icon-lg"
            className="tiny-send-button"
            disabled={isCancelingRun || (!isRunActive && !canSend)}
            onClick={isRunActive ? () => {
              void cancelRun();
            } : undefined}
          >
            {isRunActive ? <SquareIcon /> : <SendIcon />}
            <span className="sr-only">{isRunActive ? (isCancelingRun ? "Stopping..." : "Stop") : isSending ? pendingLabel : submitLabel}</span>
          </Button>
        </div>
      </form>
    </footer>
  );
}
