import {
  getAccessPolicy,
  saveAccessPolicy,
} from "@/api/accessClient";
import { Button } from "@/components/ui/button";
import { SelectionList, SelectionRow, SelectionRowTitle } from "@/components/product/SelectionList";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { SaveStateBadge } from "@/config/SaveStateBadge";
import { useUnsavedChanges } from "@/config/unsavedChangesContext";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { SectionContentHeader } from "@/app/SectionContentHeader";
import type {
  TinyOfficeCurrentSession,
  ToolGuardPolicy,
  ToolSafetyCapabilityGroup,
  ToolSafetyDecision,
  ToolSafetyViewModel,
} from "tinyoffice/frontend-api-contracts";

const decisionClassName: Record<ToolSafetyDecision, string> = {
  allow: "tiny-semantic-success",
  ask: "tiny-semantic-warning",
  deny: "tiny-semantic-danger",
};

export interface AccessPolicyEditorState {
  companyId: string;
  serverJson: string;
  draftJson: string;
}

export function AccessPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const queryClient = useQueryClient();
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const accessQuery = useQuery({
    queryKey: chatQueryKeys.accessPolicy(companyId),
    enabled: Boolean(companyId),
    queryFn: () => getAccessPolicy({ companyId }),
  });
  const model = accessQuery.data;
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const selectedGroup = selectedAccessGroup(model, selectedGroupId);
  const [policyEditor, setPolicyEditor] = useState<AccessPolicyEditorState>();
  const policyJson = policyEditor?.draftJson ?? "";
  const parsedPolicy = useMemo(() => policyEditor ? parsePolicyJson(policyEditor.draftJson) : undefined, [policyEditor]);
  const policyChanged = Boolean(policyEditor && policyEditor.draftJson !== policyEditor.serverJson);
  useUnsavedChanges(`access-policy:${companyId}`, policyChanged);

  useEffect(() => {
    if (!selectedGroupId && model?.capabilityGroups[0]) {
      setSelectedGroupId(model.capabilityGroups[0].id);
    }
  }, [model?.capabilityGroups, selectedGroupId]);

  useEffect(() => {
    if (model) {
      setPolicyEditor((current) => reconcileAccessPolicyEditor(current, companyId, model.advancedEditor.policyJson));
    }
  }, [companyId, model]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!parsedPolicy?.ok) {
        throw new Error(parsedPolicy?.message ?? "Access policy is still loading.");
      }
      return saveAccessPolicy({ companyId, policy: parsedPolicy.policy });
    },
    onSuccess: async (nextModel) => {
      setPolicyEditor(reconcileAccessPolicyEditor(undefined, companyId, nextModel.advancedEditor.policyJson));
      queryClient.setQueryData(chatQueryKeys.accessPolicy(companyId), nextModel);
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.accessPolicy(companyId) });
    },
  });

  return (
    <div className="grid h-full w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <SectionContentHeader
        description={<>Company access policy - {companyId || "No company selected"}</>}
        actions={<>
          <Button type="button" size="sm" disabled={!parsedPolicy?.ok || !policyChanged || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            <Save className="mr-2 size-4" />
            Save changes
          </Button>
          <SaveStateBadge dirty={policyChanged} saving={saveMutation.isPending} />
        </>}
      />
      <section className="grid min-h-0 grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-[var(--tiny-line-soft)] bg-[var(--tiny-sidebar)]">
          <div className="border-b border-[var(--tiny-line-faint)] px-4 py-3">
            <div className="tiny-section-label">Rule groups</div>
          </div>
          <ScrollArea className="min-h-0">
            <SelectionList className="p-2">
              {(model?.capabilityGroups ?? []).map((group) => (
                <SelectionRow
                  key={group.id}
                  selected={group.id === selectedGroup?.id}
                  className="grid gap-1 px-3 py-2.5"
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <SelectionRowTitle className="truncate text-sm">{group.label}</SelectionRowTitle>
                  <span className="flex flex-wrap gap-1">
                    {group.readRule ? <DecisionBadge decision={group.readRule} label={`read ${group.readRule}`} /> : null}
                    {group.writeRule ? <DecisionBadge decision={group.writeRule} label={`write ${group.writeRule}`} /> : null}
                    {group.commandRule ? <DecisionBadge decision={group.commandRule} label={`bash ${group.commandRule}`} /> : null}
                  </span>
                </SelectionRow>
              ))}
              {accessQuery.isLoading ? <PanelNote>Loading Access policy...</PanelNote> : null}
              {accessQuery.error ? <PanelNote>{errorText(accessQuery.error, "Failed to load Access policy.")}</PanelNote> : null}
            </SelectionList>
          </ScrollArea>
        </aside>
        <ScrollArea className="min-h-0 min-w-0">
          <main className="grid min-w-0 gap-5 px-5 py-4">
            {model ? (
              <>
                <section className="grid gap-3 border-b border-[var(--tiny-line-soft)] pb-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <ShieldCheck className="size-5 text-[var(--tiny-muted)]" />
                    <h1 className="truncate text-xl font-semibold">{selectedGroup?.label ?? "Runtime guard"}</h1>
                  </div>
                  {selectedGroup ? <p className="text-sm text-[var(--tiny-muted)]">{selectedGroup.summary}</p> : null}
                  {saveMutation.error ? <div className="text-sm text-destructive">{errorText(saveMutation.error, "Failed to save Access policy.")}</div> : null}
                  {parsedPolicy && !parsedPolicy.ok ? <div className="text-sm text-destructive">{parsedPolicy.message}</div> : null}
                </section>
                {selectedGroup ? <RuleGroupDetails group={selectedGroup} /> : null}
                <GuardBoundary />
                <details className="group rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)]">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--tiny-muted)] transition-colors hover:bg-[var(--tiny-hover)]">
                    Advanced policy JSON
                  </summary>
                  <div className="grid gap-2 border-t border-[var(--tiny-line-faint)] p-3">
                    <Textarea
                      className="min-h-[220px] resize-y font-mono text-xs leading-5"
                      value={policyJson}
                      onChange={(event) => setPolicyEditor((current) => current ? { ...current, draftJson: event.currentTarget.value } : current)}
                    />
                  </div>
                </details>
              </>
            ) : (
              <PanelNote>Select a company to edit Access policy.</PanelNote>
            )}
          </main>
        </ScrollArea>
      </section>
    </div>
  );
}

function RuleGroupDetails({ group }: { group: ToolSafetyCapabilityGroup }): ReactElement {
  const resourcePatterns = group.resourcePatterns ?? [];
  const commandColumns = commandPatternColumns(group);
  return (
    <section className="grid gap-3">
      <SectionTitle>Configured rules</SectionTitle>
      {group.kind === "command" ? (
        commandColumns.length ? (
          <div className="grid gap-2 md:grid-cols-3">
            {commandColumns.map((column) => (
              <PatternList key={column.title} title={column.title} patterns={column.patterns} />
            ))}
          </div>
        ) : <PanelNote>No command patterns are configured here. Ordinary bash remains allowed unless a lower-level guard matches a sensitive path.</PanelNote>
      ) : (
        <div className="grid gap-2">
          {resourcePatterns.length ? resourcePatterns.map((item) => (
            <div key={item.pattern} className="grid gap-2 rounded-md border border-[var(--tiny-line-soft)] px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0 truncate font-mono text-xs" title={item.pattern}>{item.pattern}</div>
              <div className="flex flex-wrap gap-1">
                <DecisionBadge decision={item.readRule} label={`read ${item.readRule}`} />
                <DecisionBadge decision={item.writeRule} label={`write ${item.writeRule}`} />
              </div>
            </div>
          )) : <PanelNote>No configured patterns in this group.</PanelNote>}
        </div>
      )}
    </section>
  );
}

function GuardBoundary(): ReactElement {
  return (
    <section className="grid gap-3">
      <SectionTitle>Runtime boundary</SectionTitle>
      <div className="grid gap-2 text-sm text-[var(--tiny-muted)]">
        <div className="rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-3 py-2">
          Access guards tool calls for sensitive paths and high-risk commands. It is not a sandbox and not a full business permission system.
        </div>
        <div className="rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-3 py-2">
          Foreground approvals belong in the Chat room that raised them. This page edits the company guard policy.
        </div>
      </div>
    </section>
  );
}

function PatternList({ title, patterns }: { title: string; patterns: string[] }): ReactElement {
  return (
    <div className="grid content-start gap-2 rounded-md border border-[var(--tiny-line-soft)] px-3 py-2">
      <div className="text-xs font-semibold text-[var(--tiny-muted)]">{title}</div>
      {patterns.map((pattern) => (
        <div key={pattern} className="min-w-0 truncate font-mono text-xs" title={pattern}>{pattern}</div>
      ))}
    </div>
  );
}

function commandPatternColumns(group: ToolSafetyCapabilityGroup): Array<{ title: string; patterns: string[] }> {
  return [
    { title: "Deny", patterns: group.commandPatterns?.deny ?? [] },
    { title: "Ask", patterns: group.commandPatterns?.ask ?? [] },
    { title: "Allow", patterns: group.commandPatterns?.allow ?? [] },
  ].filter((column) => column.patterns.length > 0);
}

function SectionTitle({ children }: { children: ReactNode }): ReactElement {
  return <div className="text-xs font-semibold uppercase tracking-normal text-[var(--tiny-muted)]">{children}</div>;
}

function DecisionBadge({ decision, label }: { decision: ToolSafetyDecision; label: string }): ReactElement {
  return (
    <span className={`inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-semibold ${decisionClassName[decision]}`}>
      {label}
    </span>
  );
}

function PanelNote({ children }: { children: ReactNode }): ReactElement {
  return <div className="rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-3 py-2 text-sm text-[var(--tiny-muted)]">{children}</div>;
}

function selectedAccessGroup(model: ToolSafetyViewModel | undefined, selectedGroupId: string): ToolSafetyCapabilityGroup | undefined {
  return model?.capabilityGroups.find((group) => group.id === selectedGroupId) ?? model?.capabilityGroups[0];
}

export function reconcileAccessPolicyEditor(
  current: AccessPolicyEditorState | undefined,
  companyId: string,
  serverJson: string,
): AccessPolicyEditorState {
  if (!current || current.companyId !== companyId) {
    return { companyId, serverJson, draftJson: serverJson };
  }
  if (current.serverJson === serverJson) {
    return current;
  }
  return {
    companyId,
    serverJson,
    draftJson: current.draftJson === current.serverJson ? serverJson : current.draftJson,
  };
}

function parsePolicyJson(value: string): { ok: true; policy: ToolGuardPolicy } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(value) as ToolGuardPolicy;
    if (!parsed || parsed.version !== 1) {
      return { ok: false, message: "Policy JSON must include version 1." };
    }
    return { ok: true, policy: parsed };
  } catch (error) {
    return { ok: false, message: errorText(error, "Policy JSON is invalid.") };
  }
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
