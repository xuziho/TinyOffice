import { createCompany, deleteCompany, listCompanies, updateCompanyProfile } from "@/api/companyClient";
import { getCompanyBranding, removeCompanyLogo, uploadCompanyLogo } from "@/api/brandingClient";
import { switchCurrentCompany } from "@/api/currentSessionClient";
import { Badge } from "@/components/ui/badge";
import { useUnsavedChangesNavigation } from "@/config/unsavedChangesContext";
import { Button } from "@/components/ui/button";
import { ManagementPageHeader } from "@/components/product/ManagementPageHeader";
import { ProductState } from "@/components/product/ProductState";
import { SelectionRow, SelectionRowTitle } from "@/components/product/SelectionList";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BriefcaseBusinessIcon, Info, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import type {
  CompaniesAdminViewModel,
  CompanyLifecycleRecordDto,
  CreateCompanyRequest,
  TinyOfficeCurrentSession,
  TinyOfficeRuntimeModelDto,
} from "tinyoffice/frontend-api-contracts";

const EMPTY_COMPANIES: CompanyLifecycleRecordDto[] = [];

export function CompanyLifecyclePage({
  currentSession,
}: {
  currentSession?: TinyOfficeCurrentSession;
}): ReactElement {
  const { requestTransition } = useUnsavedChangesNavigation();
  const queryClient = useQueryClient();
  const companiesQuery = useQuery({
    queryKey: chatQueryKeys.companies(),
    queryFn: listCompanies,
  });
  const [message, setMessage] = useState<string>();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>();
  const [query, setQuery] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  async function refreshRuntimeState(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.companies() }),
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.currentSession() }),
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.all() }),
    ]);
  }

  const createMutation = useMutation({
    mutationFn: createCompany,
    onSuccess: async (result) => {
      setMessage(`${result.company.displayName} created.`);
      setSelectedCompanyId(result.company.companyId);
      setCreateDialogOpen(false);
      await refreshRuntimeState();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCompany,
    onSuccess: async () => {
      setMessage("Company deleted.");
      setSelectedCompanyId(undefined);
      await refreshRuntimeState();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  const updateProfileMutation = useMutation({
    mutationFn: updateCompanyProfile,
    onSuccess: async (result) => {
      queryClient.setQueryData(chatQueryKeys.companies(), result);
      setMessage("Company profile updated.");
      await refreshRuntimeState();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  const switchCompanyMutation = useMutation({
    mutationFn: switchCurrentCompany,
    onSuccess: async (session) => {
      queryClient.setQueryData(chatQueryKeys.currentSession(), session);
      setMessage("Current company changed.");
      await refreshRuntimeState();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
  });

  const viewModel = companiesQuery.data;
  const isInitializing = Boolean(currentSession?.needsCompanyInitialization || viewModel?.companies.length === 0);
  const currentCompanyId = currentSession?.companyId ?? currentSession?.currentCompanyId;
  const companies = viewModel?.companies ?? EMPTY_COMPANIES;
  const visibleCompanies = useMemo(() => visibleCompanyRows(companies, query), [companies, query]);
  const selectedCompany = selectedCompanyFor(companies, selectedCompanyId, currentCompanyId);
  const busy = createMutation.isPending || deleteMutation.isPending || updateProfileMutation.isPending || switchCompanyMutation.isPending;

  useEffect(() => {
    if (!companies.length) {
      setSelectedCompanyId(undefined);
      return;
    }
    if (selectedCompanyId && companies.some((company) => company.companyId === selectedCompanyId)) {
      return;
    }
    setSelectedCompanyId(currentCompanyId && companies.some((company) => company.companyId === currentCompanyId)
      ? currentCompanyId
      : companies[0]?.companyId);
  }, [companies, currentCompanyId, selectedCompanyId]);

  return (
    <main className="grid h-svh w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <ManagementPageHeader
        title="Organization"
        context={isInitializing ? "Set up a TinyOffice workspace" : undefined}
      />

      <section className="flex min-w-0 flex-col overflow-hidden bg-muted/20">
        {message || companiesQuery.isError ? <div className="grid gap-2 border-b border-[var(--tiny-line-soft)] bg-background px-5 py-3">
          {message ? (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="status">
              {message}
            </div>
          ) : null}
          {companiesQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {companiesQuery.error instanceof Error ? companiesQuery.error.message : "Company lifecycle could not load."}
            </div>
          ) : null}
        </div> : null}

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-5 my-4 grid overflow-hidden rounded-md border bg-background xl:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]">
            <section className="min-w-0 border-b xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold leading-tight">Companies</h2>
                </div>
                <NewCompanyDialog
                  open={createDialogOpen}
                  viewModel={viewModel}
                  busy={busy}
                  onOpenChange={setCreateDialogOpen}
                  onCreate={(input) => createMutation.mutate(input)}
                />
              </div>
              <div className="border-t px-3 py-3">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-9 pl-8"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="Search companies..."
                  />
                </label>
              </div>
              <Separator />
              <div className="grid gap-2 p-3">
                {companiesQuery.isLoading ? (
                  <ProductState compact description="Loading companies..." />
                ) : visibleCompanies.length ? (
                  visibleCompanies.map((company) => (
                    <CompanyRow
                      key={company.companyId}
                      company={company}
                      current={company.companyId === currentCompanyId}
                      selected={company.companyId === selectedCompany?.companyId}
                      onSelect={() => requestTransition(() => setSelectedCompanyId(company.companyId))}
                    />
                  ))
                ) : (
                  <ProductState compact description={companies.length ? "No company matches this search." : "No company has been initialized."} />
                )}
              </div>
            </section>

            <section className="min-w-0">
              {selectedCompany ? (
                <CompanySettingsPanel
                  company={selectedCompany}
                  current={selectedCompany.companyId === currentCompanyId}
                  busy={busy}
                  onMakeCurrent={() => requestTransition(() => switchCompanyMutation.mutate({ companyId: selectedCompany.companyId }))}
                  onUpdateProfile={(displayName) => updateProfileMutation.mutate({ companyId: selectedCompany.companyId, displayName })}
                  onDelete={(confirmationText) => requestTransition(() => deleteMutation.mutate({ companyId: selectedCompany.companyId, confirmationText }))}
                />
              ) : (
                <ProductState description="Select a company to view settings." />
              )}
            </section>
          </div>
        </ScrollArea>
      </section>
    </main>
  );
}

function NewCompanyDialog({
  open,
  viewModel,
  busy,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  viewModel?: CompaniesAdminViewModel;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateCompanyRequest) => void;
}): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="size-4" />
          New company
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Create company</DialogTitle>
          <DialogDescription>
            Initialize a company workspace, owner record, and first HR runtime member.
          </DialogDescription>
        </DialogHeader>
        <CreateCompanyPanel
          viewModel={viewModel}
          busy={busy}
          onCreate={onCreate}
        />
      </DialogContent>
    </Dialog>
  );
}

function CompanySettingsPanel({
  company,
  current,
  busy,
  onMakeCurrent,
  onUpdateProfile,
  onDelete,
}: {
  company: CompanyLifecycleRecordDto;
  current: boolean;
  busy: boolean;
  onMakeCurrent: () => void;
  onUpdateProfile: (displayName: string) => void;
  onDelete: (confirmationText: string) => void;
}): ReactElement {
  return (
    <div className="grid min-w-0 gap-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BriefcaseBusinessIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="truncate text-lg font-semibold leading-tight">{company.displayName}</h2>
            {current ? <Badge variant="secondary">Current</Badge> : null}
          </div>
        </div>
        {!current ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onMakeCurrent}>
            Make current
          </Button>
        ) : null}
      </div>
      <Separator />
      <div className="grid gap-5 p-5">
        <section className="grid gap-3">
          <SectionHeading title="Identity" />
          <CompanyIdentityEditor company={company} busy={busy} onSave={onUpdateProfile} />
        </section>

        <Separator />
        {current ? <CompanyBrandingPanel company={company} /> : <section className="grid gap-3"><SectionHeading title="Profile & branding" /><p className="text-sm text-muted-foreground">Make this Company current before editing its branding.</p></section>}

        <Separator />

        <DangerZone
          company={company}
          busy={busy}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

function CompanyIdentityEditor({
  company,
  busy,
  onSave,
}: {
  company: CompanyLifecycleRecordDto;
  busy: boolean;
  onSave: (displayName: string) => void;
}): ReactElement {
  const [displayName, setDisplayName] = useState(company.displayName);

  useEffect(() => setDisplayName(company.displayName), [company.companyId, company.displayName]);

  const normalized = displayName.trim();
  const dirty = normalized !== company.displayName;
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1.5 text-sm font-medium">
          Company name
          <Input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.currentTarget.value)} />
        </label>
        <Button type="button" size="sm" disabled={busy || !dirty || !normalized} onClick={() => onSave(normalized)}>
          Save name
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The internal company identifier stays fixed so conversations, employees, files, and runtime history keep the same identity.
      </p>
      <div className="grid divide-y border-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <Fact label="Created" value={formatTimestamp(company.createdAt)} />
        <Fact label="Updated" value={formatTimestamp(company.updatedAt)} />
      </div>
    </div>
  );
}

function CompanyBrandingPanel({ company }: { company: CompanyLifecycleRecordDto }): ReactElement {
  const queryClient = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const query = useQuery({ queryKey: chatQueryKeys.branding(company.companyId), queryFn: () => getCompanyBranding({ companyId: company.companyId }) });
  const upload = useMutation({ mutationFn: (file: File) => uploadCompanyLogo({ companyId: company.companyId, file }), onSuccess: (state) => queryClient.setQueryData(chatQueryKeys.branding(company.companyId), state) });
  const remove = useMutation({ mutationFn: () => removeCompanyLogo({ companyId: company.companyId }), onSuccess: (state) => queryClient.setQueryData(chatQueryKeys.branding(company.companyId), state) });
  return <section className="grid gap-3"><SectionHeading title="Profile & branding" /><div className="flex flex-wrap items-center gap-4 py-1">
    <div className="flex size-16 items-center justify-center overflow-hidden rounded-xl bg-muted text-lg font-semibold">{query.data?.logoUrl ? <img src={`${query.data.logoUrl}?v=${encodeURIComponent(query.data.logoUrl)}`} alt={`${company.displayName} logo`} className="size-full object-cover" /> : company.displayName.slice(0, 2).toUpperCase()}</div>
    <div className="grid gap-2"><div><div className="text-sm font-medium">Company logo</div><div className="text-xs text-muted-foreground">PNG, JPEG, or WebP. Up to 5 MB.</div></div><div className="flex flex-wrap gap-2"><input ref={logoInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" disabled={upload.isPending} tabIndex={-1} aria-hidden="true" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) upload.mutate(file); }} /><Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => logoInputRef.current?.click()}><Upload />{upload.isPending ? "Uploading..." : query.data?.logoUrl ? "Replace logo" : "Choose logo"}</Button>{query.data?.logoUrl ? <Button type="button" variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button> : null}</div></div>
  </div>{upload.error ? <p className="text-sm text-destructive">{upload.error instanceof Error ? upload.error.message : "Logo upload failed."}</p> : null}</section>;
}

export function CreateCompanyPanel({
  viewModel,
  busy,
  onCreate,
  title = "Create company",
  submitLabel = "Create company",
}: {
  viewModel?: CompaniesAdminViewModel;
  busy: boolean;
  onCreate: (input: CreateCompanyRequest) => void;
  title?: string;
  submitLabel?: string;
}): ReactElement {
  const [displayName, setDisplayName] = useState("");
  const [hrEmployeeDisplayName, setHrEmployeeDisplayName] = useState("");
  const [modelValue, setModelValue] = useState("");
  const [systemAiModelValue, setSystemAiModelValue] = useState("");
  const availableModels = viewModel?.availableModels ?? [];
  const selectedModel = availableModels.find((model) => modelValue === `${model.provider}/${model.id}`);
  const selectedSystemAiModel = availableModels.find((model) => systemAiModelValue === `${model.provider}/${model.id}`);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onCreate({
      displayName,
      hrEmployeeDisplayName,
      ...(selectedModel
        ? {
            hrRuntime: {
              version: 1,
              modelProvider: selectedModel.provider,
              modelId: selectedModel.id,
              thinkingLevel: "medium",
            },
          }
        : {}),
      ...(selectedSystemAiModel
        ? {
            systemAiRuntime: {
              version: 1,
              modelProvider: selectedSystemAiModel.provider,
              modelId: selectedSystemAiModel.id,
            },
          }
        : {}),
    });
    setDisplayName("");
    setHrEmployeeDisplayName("");
    setModelValue("");
    setSystemAiModelValue("");
  }

  return (
    <form className="rounded-md border bg-background" onSubmit={submit}>
      <div className="px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold leading-tight">
          {title}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-full text-muted-foreground"
                aria-label="Create company details"
              >
                <Info className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-sm">
              Creates the company, your boss member record, and the first HR runtime member.
            </TooltipContent>
          </Tooltip>
        </h2>
      </div>
      <Separator />
      <div className="grid gap-3 p-4">
        <label className="grid gap-1.5 text-sm">
          Company name
          <Input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} required />
        </label>
        <label className="grid gap-1.5 text-sm">
          HR name
          <Input value={hrEmployeeDisplayName} onChange={(event) => setHrEmployeeDisplayName(event.currentTarget.value)} required />
        </label>
        <RuntimeModelSelect
          label="HR model"
          value={modelValue}
          availableModels={availableModels}
          onChange={setModelValue}
        />
        <RuntimeModelSelect
          label="System AI model"
          value={systemAiModelValue}
          availableModels={availableModels}
          onChange={setSystemAiModelValue}
          tooltip="System AI handles backend workspace tasks such as chat title generation and topic summaries."
        />
        <Button className="w-fit" type="submit" disabled={busy}>
          <Plus />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function RuntimeModelSelect({
  label,
  value,
  availableModels,
  disabled,
  tooltip,
  className,
  onChange,
}: {
  label: string;
  value: string;
  availableModels: TinyOfficeRuntimeModelDto[];
  disabled?: boolean;
  tooltip?: string;
  className?: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <label className={`grid gap-1.5 text-sm ${className ?? ""}`}>
      <span className="flex items-center gap-1.5">
        {label}
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-full text-muted-foreground"
                aria-label={`${label} details`}
              >
                <Info className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-sm">{tooltip}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <Select value={value || "none"} disabled={disabled} onValueChange={(nextValue) => onChange(nextValue === "none" ? "" : nextValue)}>
        <SelectTrigger className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Set later</SelectItem>
          {availableModels.map((model) => (
            <SelectItem key={`${label}-${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
              {model.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function CompanyRow({
  company,
  current,
  selected,
  onSelect,
}: {
  company: CompanyLifecycleRecordDto;
  current: boolean;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <SelectionRow
      selected={selected}
      className="grid gap-1 border border-[var(--tiny-line-soft)] px-3 py-2.5"
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SelectionRowTitle className="truncate text-sm">{company.displayName}</SelectionRowTitle>
            {current ? <Badge variant="secondary">Current</Badge> : null}
          </div>
        </div>
        <div className="shrink-0 text-xs text-muted-foreground">{formatShortDate(company.updatedAt)}</div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Created {formatShortDate(company.createdAt)}</span>
        <span>Updated {formatShortDate(company.updatedAt)}</span>
      </div>
    </SelectionRow>
  );
}

function SectionHeading({ title }: { title: string }): ReactElement {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold leading-tight">{title}</h3>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm">{value}</div>
    </div>
  );
}

function DangerZone({
  company,
  busy,
  onDelete,
}: {
  company: CompanyLifecycleRecordDto;
  busy: boolean;
  onDelete: (confirmationText: string) => void;
}): ReactElement {
  const [confirmationText, setConfirmationText] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  function handleDeleteDialogOpenChange(open: boolean): void {
    setDeleteDialogOpen(open);
    if (!open) {
      setConfirmationText("");
    }
  }

  function confirmDelete(): void {
    onDelete(confirmationText);
    setDeleteDialogOpen(false);
    setConfirmationText("");
  }

  return (
    <section className="grid gap-3">
      <SectionHeading title="Danger zone" />
      <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="size-4" />
              Delete company
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Removes the company row, company-scoped PostgreSQL data, and file assets.
            </p>
          </div>
          <Dialog open={deleteDialogOpen} onOpenChange={handleDeleteDialogOpenChange}>
            <DialogTrigger asChild>
              <Button type="button" variant="destructive" size="sm" disabled={busy}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-destructive" />
                  Delete company permanently
                </DialogTitle>
                <DialogDescription>
                  Type DELETE to remove {company.displayName}. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <p className="font-medium text-destructive">{company.displayName}</p>
              </div>
              <Input
                aria-label={`Confirm delete ${company.companyId}`}
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.currentTarget.value)}
                placeholder="DELETE"
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => handleDeleteDialogOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || confirmationText !== "DELETE"}
                  onClick={confirmDelete}
                >
                  <Trash2 className="size-4" />
                  I understand, delete company
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </section>
  );
}

function visibleCompanyRows(companies: CompanyLifecycleRecordDto[], query: string): CompanyLifecycleRecordDto[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return companies;
  }
  return companies.filter((company) => (
    company.displayName.toLowerCase().includes(normalized) ||
    company.companyId.toLowerCase().includes(normalized)
  ));
}

function selectedCompanyFor(
  companies: CompanyLifecycleRecordDto[],
  selectedCompanyId: string | undefined,
  currentCompanyId: string | undefined,
): CompanyLifecycleRecordDto | undefined {
  return companies.find((company) => company.companyId === selectedCompanyId)
    ?? companies.find((company) => company.companyId === currentCompanyId)
    ?? companies[0];
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString();
}
