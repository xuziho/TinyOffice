import {
  getPromptPolicy,
  resetPromptPolicyBlock,
  resetPromptPolicyTemplate,
  savePromptPolicyBlock,
  savePromptPolicyTemplate,
} from "@/api/promptPolicyClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectionGroupLabel, SelectionRow, SelectionRowTitle } from "@/components/product/SelectionList";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { SaveStateBadge } from "@/config/SaveStateBadge";
import { useUnsavedChanges, useUnsavedChangesNavigation } from "@/config/unsavedChangesContext";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save, ScrollText } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type {
  PromptPolicyBlockViewModel,
  PromptPolicyTemplateViewModel,
  PromptPolicyViewModel,
  TinyOfficeCurrentSession,
} from "tinyoffice/frontend-api-contracts";

type PromptTarget =
  | { kind: "template"; key: string; template: PromptPolicyTemplateViewModel }
  | { kind: "block"; key: string; block: PromptPolicyBlockViewModel };

export function PromptPolicyPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const { requestTransition } = useUnsavedChangesNavigation();
  const queryClient = useQueryClient();
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const promptPolicyQuery = useQuery({
    queryKey: chatQueryKeys.promptPolicy(companyId),
    enabled: Boolean(companyId),
    queryFn: () => getPromptPolicy({ companyId }),
  });
  const model = promptPolicyQuery.data;
  const [selectedKey, setSelectedKey] = useState("");
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const target = selectedPromptFor(model, selectedKey);
  const persistedContent = targetContent(target);
  const [draftContent, setDraftContent] = useState("");
  const previousTargetKey = useRef(target?.key);
  const dirty = Boolean(target && draftContent !== persistedContent);
  useUnsavedChanges(`prompt-policy:${companyId}`, dirty);

  useEffect(() => {
    const firstTarget = selectedPromptFor(model, "");
    if (!selectedKey && firstTarget) {
      setSelectedKey(firstTarget.key);
    }
  }, [model, selectedKey]);

  useEffect(() => {
    const targetChanged = previousTargetKey.current !== target?.key;
    if (targetChanged || !dirty) {
      previousTargetKey.current = target?.key;
      setDraftContent(persistedContent);
    }
  }, [dirty, target?.key, persistedContent]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!target) {
        throw new Error("Select a prompt before saving.");
      }
      return target.kind === "template"
        ? savePromptPolicyTemplate({
          companyId,
          templateId: target.template.id,
          content: draftContent,
        })
        : savePromptPolicyBlock({
          companyId,
          path: target.block.path,
          content: draftContent,
        });
    },
    onSuccess: async (nextModel) => {
      queryClient.setQueryData(chatQueryKeys.promptPolicy(companyId), nextModel);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.promptPolicy(companyId) });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => {
      if (!target) {
        throw new Error("Select a prompt before resetting.");
      }
      return target.kind === "template"
        ? resetPromptPolicyTemplate({ companyId, templateId: target.template.id })
        : resetPromptPolicyBlock({ companyId, path: target.block.path });
    },
    onSuccess: async (nextModel) => {
      setResetDialogOpen(false);
      queryClient.setQueryData(chatQueryKeys.promptPolicy(companyId), nextModel);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.promptPolicy(companyId) });
    },
  });

  const diagnostics = diagnosticItems(model);
  const usageItems = runtimeUsageItems(target);
  const showSidePanel = diagnostics.length > 0 || usageItems.length > 0;

  return (
    <div className="grid h-svh w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <header className="tiny-room-header flex items-center justify-between gap-3 border-b">
        <div className="min-w-0">
          <div className="tiny-room-title truncate">Prompt Policy</div>
          <div className="tiny-room-subtitle truncate">Company prompt configuration - {companyId || "No company selected"}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" disabled={!target || saveMutation.isPending || !dirty} onClick={() => saveMutation.mutate()}>
            <Save className="mr-2 size-4" />
            Save changes
          </Button>
          <SaveStateBadge dirty={dirty} saving={saveMutation.isPending} />
          <Button type="button" size="sm" variant="outline" disabled={!target || resetMutation.isPending} onClick={() => setResetDialogOpen(true)}>
            <RotateCcw className="mr-2 size-4" />
            Reset to default
          </Button>
        </div>
      </header>
      <section className={showSidePanel
        ? "grid min-h-0 grid-cols-[300px_minmax(0,1fr)_300px] overflow-hidden"
        : "grid min-h-0 grid-cols-[300px_minmax(0,1fr)] overflow-hidden"}
      >
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-[var(--tiny-line-soft)] bg-[var(--tiny-sidebar)]">
          <div className="border-b border-[var(--tiny-line-faint)] px-4 py-3">
            <div className="tiny-section-label">Prompts</div>
          </div>
          <ScrollArea className="min-h-0">
            <div className="grid gap-4 p-2">
              <PromptGroup title="Foundation prompts">
                {(model?.templates ?? []).map((template) => (
                  <PromptListButton
                    key={template.id}
                    active={target?.kind === "template" && target.template.id === template.id}
                    title={template.label}
                    onClick={() => requestTransition(() => setSelectedKey(templateKey(template.id)))}
                  />
                ))}
              </PromptGroup>
              <PromptGroup title="Scene blocks">
                {editableBlocks(model).map((block) => (
                  <PromptListButton
                    key={block.path}
                    active={target?.kind === "block" && target.block.path === block.path}
                    title={block.title}
                    onClick={() => requestTransition(() => setSelectedKey(blockKey(block.path)))}
                  />
                ))}
              </PromptGroup>
              {promptPolicyQuery.isLoading ? <PanelNote>Loading Prompt Policy...</PanelNote> : null}
              {promptPolicyQuery.error ? <PanelNote>{errorText(promptPolicyQuery.error, "Failed to load Prompt Policy.")}</PanelNote> : null}
            </div>
          </ScrollArea>
        </aside>
        <ScrollArea className="min-h-0 min-w-0">
          <main className="grid min-w-0 gap-4 px-5 py-4">
            {target ? (
              <>
                <section className="grid gap-3 border-b border-[var(--tiny-line-soft)] pb-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <ScrollText className="size-5 text-[var(--tiny-muted)]" />
                        <h1 className="truncate text-xl font-semibold">{targetTitle(target)}</h1>
                      </div>
                      <div className="mt-1 text-sm text-[var(--tiny-muted)]">{targetDescription(target)}</div>
                    </div>
                  </div>
                  {saveMutation.error ? <div className="text-sm text-destructive">{errorText(saveMutation.error, "Failed to save Prompt Policy.")}</div> : null}
                  {resetMutation.error ? <div className="text-sm text-destructive">{errorText(resetMutation.error, "Failed to reset Prompt Policy.")}</div> : null}
                </section>
                <section className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {variableHints(target).map((hint) => <Badge key={hint} variant="outline" className="font-mono">{hint}</Badge>)}
                  </div>
                  <Textarea
                    className="min-h-[520px] resize-y font-mono text-xs leading-5"
                    value={draftContent}
                    onChange={(event) => setDraftContent(event.currentTarget.value)}
                  />
                </section>
              </>
            ) : (
              <PanelNote>Select a Prompt Policy entry to edit company prompt text.</PanelNote>
            )}
          </main>
        </ScrollArea>
        {showSidePanel ? (
          <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-[var(--tiny-line-soft)] bg-[var(--tiny-sidebar)]">
            <div className="border-b border-[var(--tiny-line-faint)] px-4 py-3">
              <div className="tiny-section-label">{usageItems.length ? "Runtime usage" : "Issues"}</div>
            </div>
            <ScrollArea className="min-h-0">
              <div className="grid gap-3 p-3">
                {usageItems.length ? (
                  <MetaPanel title="Loaded by">
                    <div className="grid gap-1" role="list">
                      {usageItems.map((item) => (
                        <div key={item} className="tiny-readonly-fact" role="listitem">
                          <span className="tiny-readonly-fact-mark" aria-hidden="true" />
                          {item}
                        </div>
                      ))}
                    </div>
                  </MetaPanel>
                ) : null}
                {diagnostics.length ? (
                  <MetaPanel title="Diagnostics">
                  <div className="grid gap-2">
                    {diagnostics.map((item) => (
                      <div key={`${item.code}:${item.message}`} className="rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-3 py-2 text-sm">
                        <div className="font-mono text-xs text-[var(--tiny-muted)]">{item.code}</div>
                        <div>{item.message}</div>
                      </div>
                    ))}
                  </div>
                  </MetaPanel>
                ) : null}
              </div>
            </ScrollArea>
          </aside>
        ) : null}
      </section>
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset this prompt?</DialogTitle>
            <DialogDescription>
              {target ? `${targetTitle(target)} will be restored to its TinyOffice default. Other Prompt Policy entries will not change.` : "Select a prompt before resetting."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetDialogOpen(false)}>Keep current prompt</Button>
            <Button type="button" variant="destructive" disabled={!target || resetMutation.isPending} onClick={() => resetMutation.mutate()}>
              <RotateCcw /> Reset prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PromptGroup({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="grid gap-1">
      <SelectionGroupLabel>{title}</SelectionGroupLabel>
      {children}
    </div>
  );
}

function PromptListButton({
  active,
  title,
  onClick,
}: {
  active: boolean;
  title: string;
  onClick(): void;
}): ReactElement {
  return (
    <SelectionRow
      selected={active}
      className="grid gap-1 px-3 py-2.5"
      onClick={onClick}
    >
      <SelectionRowTitle className="truncate text-sm">{title}</SelectionRowTitle>
    </SelectionRow>
  );
}

function MetaPanel({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="grid gap-2">
      <div className="text-xs font-semibold uppercase tracking-normal text-[var(--tiny-muted)]">{title}</div>
      {children}
    </section>
  );
}

function PanelNote({ children }: { children: ReactNode }): ReactElement {
  return <div className="rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-3 py-2 text-sm text-[var(--tiny-muted)]">{children}</div>;
}

function selectedPromptFor(model: PromptPolicyViewModel | undefined, selectedKey: string): PromptTarget | undefined {
  const targets: PromptTarget[] = [
    ...(model?.templates ?? []).map((template) => ({ kind: "template" as const, key: templateKey(template.id), template })),
    ...editableBlocks(model).map((block) => ({ kind: "block" as const, key: blockKey(block.path), block })),
  ];
  return targets.find((item) => item.key === selectedKey) ?? targets[0];
}

function editableBlocks(model: PromptPolicyViewModel | undefined): PromptPolicyBlockViewModel[] {
  const scenePaths = new Set((model?.scenes ?? []).flatMap((scene) => scene.effectiveBlockPaths));
  return (model?.availableBlocks ?? []).filter((block) => scenePaths.has(block.path) || block.loadedBy.length > 0);
}

function templateKey(templateId: string): string {
  return `template:${templateId}`;
}

function blockKey(path: string): string {
  return `block:${path}`;
}

function targetContent(target: PromptTarget | undefined): string {
  if (!target) {
    return "";
  }
  return target.kind === "template" ? target.template.content : target.block.content;
}

function targetTitle(target: PromptTarget): string {
  return target.kind === "template" ? target.template.label : target.block.title;
}

function targetDescription(target: PromptTarget): string {
  return target.kind === "template" ? target.template.description : target.block.preview;
}

function variableHints(target: PromptTarget): string[] {
  return target.kind === "template" ? target.template.variableHints : [];
}

function diagnosticItems(model: PromptPolicyViewModel | undefined): Array<{ code: string; message: string }> {
  return [
    ...(model?.diagnostics.errors ?? []),
    ...(model?.diagnostics.warnings ?? []),
  ].map((item) => ({ code: item.code, message: item.message }));
}

function runtimeUsageItems(target: PromptTarget | undefined): string[] {
  if (!target || target.kind !== "block") {
    return [];
  }
  return target.block.loadedBy.map((usage) => usage.label);
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
