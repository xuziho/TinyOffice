import { listCompanies, saveCompanySystemAiSettings } from "@/api/companyClient";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SaveStateBadge } from "@/config/SaveStateBadge";
import { useUnsavedChanges } from "@/config/unsavedChangesContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BotIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { CompaniesAdminViewModel, CompanySystemAiSettingDto, SaveCompanySystemAiSettingsRequest, TinyOfficeCurrentSession, TinyOfficeRuntimeModelDto } from "tinyoffice/frontend-api-contracts";

export function SystemAiPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const queryClient = useQueryClient();
  const companiesQuery = useQuery({ queryKey: chatQueryKeys.companies(), queryFn: listCompanies });
  const mutation = useMutation({
    mutationFn: saveCompanySystemAiSettings,
    onSuccess: (result) => queryClient.setQueryData(chatQueryKeys.companies(), result),
  });

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <section className="mx-auto max-w-5xl bg-background">
          <div className="flex items-start justify-between gap-3 border-b pb-5">
            <div className="flex gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><BotIcon className="size-4" /></div>
              <div>
                <h2 className="font-semibold">Workspace automation models</h2>
                <p className="mt-1 text-sm text-muted-foreground">System AI handles generated Chat titles and Topic summaries. It is separate from employee runtime models.</p>
              </div>
            </div>
            <Badge variant="secondary">Developer tool</Badge>
          </div>
          <div className="pt-5">
            {companiesQuery.isLoading ? <StateBlock text="Loading System AI settings..." />
              : companiesQuery.error ? <StateBlock text={companiesQuery.error instanceof Error ? companiesQuery.error.message : "Failed to load System AI settings."} />
                : !companyId ? <StateBlock text="Select a Company before configuring System AI." />
                  : <SystemAiSettingsForm companyId={companyId} viewModel={companiesQuery.data} busy={mutation.isPending} error={mutation.error} onSave={(input) => mutation.mutate(input)} />}
          </div>
        </section>
      </div>
    </div>
  );
}

function SystemAiSettingsForm({ companyId, viewModel, busy, error, onSave }: { companyId: string; viewModel?: CompaniesAdminViewModel; busy: boolean; error: unknown; onSave(input: SaveCompanySystemAiSettingsRequest): void }): ReactElement {
  const availableModels = viewModel?.availableModels ?? [];
  const titleValue = modelValue(settingFor(viewModel, companyId, "chat_title_generation"));
  const summaryValue = modelValue(settingFor(viewModel, companyId, "chat_topic_summary"));
  const [titleModel, setTitleModel] = useState(titleValue);
  const [summaryModel, setSummaryModel] = useState(summaryValue);
  const previousCompanyId = useRef(companyId);
  const dirty = titleModel !== titleValue || summaryModel !== summaryValue;
  useUnsavedChanges(`system-ai:${companyId}`, dirty);

  useEffect(() => {
    if (previousCompanyId.current !== companyId || !dirty) {
      previousCompanyId.current = companyId;
      setTitleModel(titleValue);
      setSummaryModel(summaryValue);
    }
  }, [companyId, dirty, titleValue, summaryValue]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSave({ companyId, chatTitleGeneration: modelInput(titleModel), chatTopicSummary: modelInput(summaryModel) });
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <ModelSelect label="Chat title generation" value={titleModel} options={availableModels} onChange={setTitleModel} />
        <ModelSelect label="Topic summaries" value={summaryModel} options={availableModels} onChange={setSummaryModel} />
      </div>
      {error ? <p className="text-sm text-destructive">{error instanceof Error ? error.message : String(error)}</p> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !dirty}>Save System AI</Button>
        <SaveStateBadge dirty={dirty} saving={busy && dirty} />
      </div>
    </form>
  );
}

function ModelSelect({ label, value, options, onChange }: { label: string; value: string; options: TinyOfficeRuntimeModelDto[]; onChange(value: string): void }): ReactElement {
  return <label className="grid gap-1.5 text-sm">{label}<Select value={value || "none"} onValueChange={(next) => onChange(next === "none" ? "" : next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Set later</SelectItem>{options.map((option) => <SelectItem key={`${label}-${option.provider}/${option.id}`} value={`${option.provider}/${option.id}`}>{option.name}</SelectItem>)}</SelectContent></Select></label>;
}

function settingFor(model: CompaniesAdminViewModel | undefined, companyId: string, capability: CompanySystemAiSettingDto["capability"]): CompanySystemAiSettingDto | undefined {
  return model?.systemAiSettings?.find((setting) => setting.companyId === companyId && setting.capability === capability);
}

function modelValue(setting: CompanySystemAiSettingDto | undefined): string { return setting?.configured && setting.modelProvider && setting.modelId ? `${setting.modelProvider}/${setting.modelId}` : ""; }
function modelInput(value: string): SaveCompanySystemAiSettingsRequest["chatTitleGeneration"] { const [provider, ...id] = value.split("/"); return provider && id.length ? { modelProvider: provider, modelId: id.join("/") } : {}; }
function StateBlock({ text }: { text: string }): ReactElement { return <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{text}</div>; }
