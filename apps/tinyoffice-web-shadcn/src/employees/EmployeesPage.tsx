import {
  createEmployee,
  getEmployeePrivateSkill,
  getEmployeePrivateSkills,
  getEmployees,
  reloadEmployeeRuntimeIfAvailable,
  saveEmployee,
  setEmployeeEnabled,
  saveEmployeePrivateSkill,
} from "../api/employeesClient";
import { Button } from "../components/ui/button";
import { EmployeeAvatar } from "../components/product/EmployeeAvatar";
import { AvatarSeedEditor } from "../components/product/AvatarSeedEditor";
import { SelectionList, SelectionRow, SelectionRowDescription, SelectionRowTitle } from "../components/product/SelectionList";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { SaveStateBadge } from "../config/SaveStateBadge";
import { useUnsavedChanges, useUnsavedChangesNavigation } from "../config/unsavedChangesContext";
import { chatQueryKeys } from "../chat/chatQueryKeys";
import { hydrateSkillEditor, type SkillEditorState } from "./skillEditorModel";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import type {
  EmployeeAdminRecord,
  EmployeeInstructionFile,
  EmployeePrivateSkillFile,
  EmployeeRuntimeConfig,
  EmployeeThinkingLevel,
  EmployeesAdminState,
  CompanyDirectoryDto,
  TinyOfficeCurrentSession,
} from "tinyoffice/frontend-api-contracts";

type EmployeeDraft = {
  avatarSeed: string;
  displayName: string;
  role: string;
  presenceMode: "resident" | "auto_exit_idle";
  sceneProfile: string;
  modelProvider: string;
  modelId: string;
  thinkingLevel: EmployeeThinkingLevel;
  agentsContent: string;
};

const employeeTabTriggerClassName = [
  "px-3 py-2 text-sm font-semibold text-[var(--tiny-muted)]",
  "hover:text-foreground",
].join(" ");

export function EmployeesPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const { requestTransition } = useUnsavedChangesNavigation();
  const queryClient = useQueryClient();
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const employeesQuery = useQuery({
    queryKey: chatQueryKeys.employees(companyId),
    enabled: Boolean(companyId),
    queryFn: () => getEmployees({ companyId }),
  });
  const model = employeesQuery.data;
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeView, setEmployeeView] = useState<"active" | "inactive">("active");
  const visibleEmployees = useMemo(() => (model?.employees ?? []).filter((employee) =>
    employeeView === "active" ? employee.enabled !== false : employee.enabled === false
  ), [employeeView, model?.employees]);
  const activeEmployeeCount = (model?.employees ?? []).filter((employee) => employee.enabled !== false).length;
  const inactiveEmployeeCount = (model?.employees ?? []).filter((employee) => employee.enabled === false).length;
  const selectedEmployee = selectedEmployeeFor(model, selectedEmployeeId);
  const [draft, setDraft] = useState<EmployeeDraft | undefined>(() => selectedEmployee ? draftFromEmployee(selectedEmployee) : undefined);
  const previousEmployeeId = useRef(selectedEmployee?.employeeId);
  const dirty = Boolean(selectedEmployee && draft && !employeeDraftEqual(draft, draftFromEmployee(selectedEmployee)));
  useUnsavedChanges(`employee-config:${companyId}`, dirty);

  useEffect(() => {
    if (!visibleEmployees.some((employee) => employee.employeeId === selectedEmployeeId)) {
      setSelectedEmployeeId(visibleEmployees[0]?.employeeId ?? "");
    }
  }, [selectedEmployeeId, visibleEmployees]);

  useEffect(() => {
    const employeeChanged = previousEmployeeId.current !== selectedEmployee?.employeeId;
    if (employeeChanged || !dirty) {
      previousEmployeeId.current = selectedEmployee?.employeeId;
      setDraft(selectedEmployee ? draftFromEmployee(selectedEmployee) : undefined);
    }
  }, [dirty, selectedEmployee]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedEmployee || !draft) {
        throw new Error("Select an employee before saving.");
      }
      return saveEmployee({ companyId, employee: employeeFromDraft(selectedEmployee, draft) });
    },
    onSuccess: async (state) => {
      if (selectedEmployee) {
        await reloadEmployeeRuntimeIfAvailable({ companyId, memberId: selectedEmployee.employeeId });
        const savedEmployee = state.employees.find((employee) => employee.employeeId === selectedEmployee.employeeId);
        if (savedEmployee) {
          setDraft(draftFromEmployee(savedEmployee));
        }
      }
      queryClient.setQueryData(chatQueryKeys.employees(companyId), state);
      const savedEmployee = selectedEmployee
        ? state.employees.find((employee) => employee.employeeId === selectedEmployee.employeeId)
        : undefined;
      if (savedEmployee) {
        queryClient.setQueryData<CompanyDirectoryDto>(chatQueryKeys.directory(companyId), (directory) => directory ? {
          ...directory,
          directoryMembers: directory.directoryMembers.map((member) => member.memberId === savedEmployee.employeeId ? {
            ...member,
            avatarSeed: savedEmployee.profile.avatarSeed,
            displayName: savedEmployee.profile.displayName ?? member.displayName,
            role: savedEmployee.profile.role,
          } : member),
        } : directory);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.employeesScope(companyId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.directory(companyId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.projectionScope(companyId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.tasksScope(companyId) }),
      ]);
    },
  });
  const lifecycleMutation = useMutation({
    mutationFn: (enabled: boolean) => {
      if (!selectedEmployee) throw new Error("Select an employee first.");
      return setEmployeeEnabled({ companyId, memberId: selectedEmployee.employeeId, enabled });
    },
    onSuccess: async (state, enabled) => {
      queryClient.setQueryData(chatQueryKeys.employees(companyId), state);
      const next = state.employees.find((employee) =>
        enabled ? employee.enabled === false : employee.enabled !== false
      );
      setSelectedEmployeeId(next?.employeeId ?? "");
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.employeesScope(companyId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.directory(companyId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.projectionScope(companyId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.employeeRuntimeSummary(companyId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.tasksScope(companyId) }),
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.accessRequests(companyId) }),
      ]);
    },
  });

  return (
    <div className="h-full w-full overflow-hidden">
      <section className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] overflow-hidden">
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-[var(--tiny-line-soft)] bg-[var(--tiny-sidebar)]">
          <div className="grid gap-2 border-b border-[var(--tiny-line-faint)] px-3 py-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="tiny-section-label">Runtime-capable employees</div>
              <CreateEmployeeDialog
                companyId={companyId}
                model={model}
                runtimeDefaults={selectedEmployee?.runtime}
                disabled={!companyId}
                onCreated={async () => {
                  await queryClient.invalidateQueries({ queryKey: chatQueryKeys.employeesScope(companyId) });
                }}
              />
            </div>
            <div className="tiny-segmented-control grid grid-cols-2" aria-label="Employee lifecycle view">
              <Button className="tiny-segmented-trigger" data-active={employeeView === "active" || undefined} type="button" size="sm" variant="ghost" onClick={() => requestTransition(() => setEmployeeView("active"))}>
                Active {activeEmployeeCount}
              </Button>
              <Button className="tiny-segmented-trigger" data-active={employeeView === "inactive" || undefined} type="button" size="sm" variant="ghost" onClick={() => requestTransition(() => setEmployeeView("inactive"))}>
                Inactive {inactiveEmployeeCount}
              </Button>
            </div>
          </div>
          <ScrollArea className="min-h-0">
            <SelectionList className="p-2">
              {visibleEmployees.map((employee) => (
                <SelectionRow
                  key={employee.employeeId}
                  selected={employee.employeeId === selectedEmployee?.employeeId}
                  className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2 px-2 py-2.5"
                  onClick={() => requestTransition(() => setSelectedEmployeeId(employee.employeeId))}
                >
                  <EmployeeAvatar memberId={employee.employeeId} avatarSeed={employee.profile.avatarSeed} displayName={employeeLabel(employee)} className="size-8" />
                  <span className="min-w-0">
                    <SelectionRowTitle className="block truncate text-sm">{employeeLabel(employee)}</SelectionRowTitle>
                    <SelectionRowDescription className="block truncate text-xs">{employee.profile.role}</SelectionRowDescription>
                  </span>
                </SelectionRow>
              ))}
              {employeesQuery.isLoading ? <PanelNote>Loading employees...</PanelNote> : null}
              {employeesQuery.error ? <PanelNote>{errorText(employeesQuery.error, "Failed to load Employees.")}</PanelNote> : null}
              {!employeesQuery.isLoading && visibleEmployees.length === 0 ? (
                <PanelNote>{employeeView === "active" ? "No active employees." : "No inactive employees."}</PanelNote>
              ) : null}
            </SelectionList>
          </ScrollArea>
        </aside>
        <ScrollArea className="min-h-0 min-w-0">
          <div className="grid gap-4 px-5 py-4">
            {selectedEmployee && draft ? (
              <EmployeeEditor
                companyId={companyId}
                model={model}
                employee={selectedEmployee}
                draft={draft}
                saving={saveMutation.isPending}
                dirty={dirty}
                saveError={errorText(saveMutation.error, "")}
                onDraftChange={setDraft}
                onSave={() => saveMutation.mutate()}
                changingLifecycle={lifecycleMutation.isPending}
                onSetEnabled={(enabled) => lifecycleMutation.mutateAsync(enabled).then(() => undefined)}
              />
            ) : (
              <PanelNote>Select an employee to edit runtime configuration.</PanelNote>
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}

function EmployeeEditor({
  companyId,
  model,
  employee,
  draft,
  saving,
  dirty,
  saveError,
  onDraftChange,
  onSave,
  changingLifecycle,
  onSetEnabled,
}: {
  companyId: string;
  model?: EmployeesAdminState;
  employee: EmployeeAdminRecord;
  draft: EmployeeDraft;
  saving: boolean;
  dirty: boolean;
  saveError?: string;
  onDraftChange(draft: EmployeeDraft): void;
  onSave(): void;
  changingLifecycle: boolean;
  onSetEnabled(enabled: boolean): Promise<void>;
}): ReactElement {
  const instructionFile = editableAgentsFile(employee);
  return (
    <div className="grid min-w-0 gap-4">
      <section className="grid gap-3 border-b border-[var(--tiny-line-soft)] pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <UserRound className="size-5 text-[var(--tiny-muted)]" />
              <h1 className="truncate text-xl font-semibold">{employeeLabel(employee)}</h1>
              <Badge variant={employee.enabled === false ? "outline" : "secondary"}>
                {employee.enabled === false ? "Disabled" : "Enabled"}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <EmployeeLifecycleAction employee={employee} pending={changingLifecycle} onSetEnabled={onSetEnabled} />
            <Button type="button" size="sm" disabled={saving || !dirty} onClick={onSave}>
              <Save className="mr-2 size-4" />
              Save changes
            </Button>
            <SaveStateBadge dirty={dirty} saving={saving} />
          </div>
        </div>
        {saveError ? <div className="text-sm text-destructive">{saveError}</div> : null}
      </section>
      <Tabs defaultValue="profile" className="flex min-w-0 flex-col">
        <TabsList variant="line" className="tiny-content-tabs w-fit max-w-full overflow-x-auto">
          <TabsTrigger value="profile" className={employeeTabTriggerClassName}>Profile</TabsTrigger>
          <TabsTrigger value="runtime" className={employeeTabTriggerClassName}>Runtime</TabsTrigger>
          <TabsTrigger value="agents" className={employeeTabTriggerClassName}>AGENTS.md</TabsTrigger>
          <TabsTrigger value="skills" className={employeeTabTriggerClassName}>Skills</TabsTrigger>
          <TabsTrigger value="assets" className={employeeTabTriggerClassName}>Assets</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="grid gap-3 pt-3">
          <AvatarSeedEditor memberId={employee.employeeId} displayName={draft.displayName || "Unnamed employee"} avatarSeed={draft.avatarSeed} disabled={saving} onChange={(avatarSeed) => onDraftChange({ ...draft, avatarSeed })} />
          <FieldGrid>
            <LabelledField label="Display name">
              <Input value={draft.displayName} onChange={(event) => onDraftChange({ ...draft, displayName: event.currentTarget.value })} />
            </LabelledField>
            <LabelledField label="Role">
              <Input value={draft.role} onChange={(event) => onDraftChange({ ...draft, role: event.currentTarget.value })} />
            </LabelledField>
            <LabelledField label="Presence">
              <Select value={draft.presenceMode} onValueChange={(value) => onDraftChange({ ...draft, presenceMode: value as EmployeeDraft["presenceMode"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(model?.presenceModes ?? ["resident", "auto_exit_idle"]).map((mode) => <SelectItem key={mode} value={mode}>{mode}</SelectItem>)}
                </SelectContent>
              </Select>
            </LabelledField>
          </FieldGrid>
          <LabelledField label="Responsibilities">
            <Textarea
              className="min-h-28"
              value={draft.sceneProfile}
              onChange={(event) => onDraftChange({ ...draft, sceneProfile: event.currentTarget.value })}
            />
          </LabelledField>
        </TabsContent>
        <TabsContent value="runtime" className="grid gap-3 pt-3">
          <div className="grid divide-y border-y text-sm md:grid-cols-3 md:divide-x md:divide-y-0">
            <RuntimeValue label="Provider" value={draft.modelProvider || "Not set"} />
            <RuntimeValue label="Model" value={draft.modelId || "Not set"} />
            <RuntimeValue label="Thinking" value={draft.thinkingLevel} />
          </div>
          <FieldGrid>
            <LabelledField label="Runtime model">
              <Select value={modelRefFromDraft(draft)} onValueChange={(value) => onDraftChange({ ...draft, ...draftModelFromRef(value) })}>
                <SelectTrigger><SelectValue placeholder="Runtime model" /></SelectTrigger>
                <SelectContent>
                  {runtimeModelOptions(model, draft).map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </LabelledField>
            <LabelledField label="Thinking">
              <Select value={draft.thinkingLevel} onValueChange={(value) => onDraftChange({ ...draft, thinkingLevel: value as EmployeeThinkingLevel })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(model?.thinkingLevels ?? ["off", "minimal", "low", "medium", "high", "xhigh"]).map((level) => <SelectItem key={level} value={level}>{level}</SelectItem>)}
                </SelectContent>
              </Select>
            </LabelledField>
          </FieldGrid>
        </TabsContent>
        <TabsContent value="agents" className="grid gap-3 pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-[var(--tiny-muted)]">
            <span className="min-w-0 truncate">{instructionFile?.relativePath ?? "AGENTS.md"}</span>
            {instructionFile?.exists === false ? <Badge variant="outline">No AGENTS.md yet.</Badge> : null}
          </div>
          <Textarea
            className="min-h-[320px] font-mono text-xs leading-5"
            value={draft.agentsContent}
            placeholder={instructionFile?.exists === false ? "Write employee-specific instructions here. Saving will create AGENTS.md." : undefined}
            onChange={(event) => onDraftChange({ ...draft, agentsContent: event.currentTarget.value })}
          />
        </TabsContent>
        <TabsContent value="skills" className="pt-3">
          <EmployeeSkillsPanel companyId={companyId} employee={employee} />
        </TabsContent>
        <TabsContent value="assets" className="grid gap-2 pt-3 text-sm">
          <PathRow label="Home" value={employee.localAssets?.homePath} />
          <PathRow label="Workspace" value={employee.localAssets?.workspacePath} />
          <PathRow label="Company skills" value={companySkillsPath(employee)} />
          <PathRow label="Employee skills" value={employeeSkillsPath(employee)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmployeeLifecycleAction({ employee, pending, onSetEnabled }: {
  employee: EmployeeAdminRecord;
  pending: boolean;
  onSetEnabled(enabled: boolean): Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const enabled = employee.enabled !== false;
  const [error, setError] = useState<string>();
  async function confirm(): Promise<void> {
    setError(undefined);
    try {
      await onSetEnabled(!enabled);
      setOpen(false);
    } catch (caught) {
      setError(errorText(caught, "Failed to change employee lifecycle."));
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={enabled ? "destructive" : "outline"} disabled={pending}>{enabled ? "Deactivate" : "Reactivate"}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{enabled ? "Deactivate employee?" : "Reactivate employee?"}</DialogTitle>
          <DialogDescription>
            {enabled
              ? "New Chat and Task execution will stop. Existing messages, tasks, sessions, and history stay available."
              : "This employee will be able to receive new Chat turns and Task runs again."}
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="button" variant={enabled ? "destructive" : "default"} onClick={() => void confirm()} disabled={pending}>
            {pending ? "Saving..." : enabled ? "Deactivate" : "Reactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeSkillsPanel({ companyId, employee }: { companyId: string; employee: EmployeeAdminRecord }): ReactElement {
  const { requestTransition } = useUnsavedChangesNavigation();
  const queryClient = useQueryClient();
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const skillsQuery = useQuery({
    queryKey: chatQueryKeys.employeePrivateSkills(companyId, employee.employeeId),
    enabled: Boolean(companyId && employee.employeeId),
    queryFn: () => getEmployeePrivateSkills({ companyId, memberId: employee.employeeId }),
  });
  const selectedSkillExists = skillsQuery.data?.skills.some((skill) => skill.skillId === selectedSkillId);
  const activeSkillId = selectedSkillExists ? selectedSkillId : skillsQuery.data?.skills[0]?.skillId || "";
  const skillQuery = useQuery({
    queryKey: chatQueryKeys.employeePrivateSkill(companyId, employee.employeeId, activeSkillId),
    enabled: Boolean(companyId && employee.employeeId && activeSkillId),
    queryFn: () => getEmployeePrivateSkill({ companyId, memberId: employee.employeeId, skillId: activeSkillId }),
  });
  const skillIdentity = `${companyId}:${employee.employeeId}:${activeSkillId}`;
  const [editor, setEditor] = useState<SkillEditorState>({ identity: "", content: "", baseline: "" });
  const content = editor.identity === skillIdentity ? editor.content : "";
  const hasPrivateSkills = Boolean(skillsQuery.data?.skills.length);
  const skillDirty = Boolean(skillQuery.data && editor.identity === skillIdentity && editor.content !== editor.baseline);
  useUnsavedChanges(`employee-skill:${companyId}:${employee.employeeId}`, skillDirty);

  useEffect(() => {
    const file = skillQuery.data;
    if (!file) return;
    setEditor((current) => hydrateSkillEditor(current, skillIdentity, file.content));
  }, [skillIdentity, skillQuery.data]);

  const saveSkillMutation = useMutation({
    mutationFn: async () => {
      const skill = requireSkill(skillQuery.data);
      return saveEmployeePrivateSkill({ companyId, memberId: employee.employeeId, skillId: skill.skillId, content });
    },
    onSuccess: async (file) => {
      await reloadEmployeeRuntimeIfAvailable({ companyId, memberId: employee.employeeId });
      queryClient.setQueryData(chatQueryKeys.employeePrivateSkill(companyId, employee.employeeId, file.skillId), file);
      setEditor({ identity: `${companyId}:${employee.employeeId}:${file.skillId}`, content: file.content, baseline: file.content });
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.employeePrivateSkills(companyId, employee.employeeId) });
    },
  });

  if (!skillsQuery.isLoading && !hasPrivateSkills) {
    return <PanelNote>No private skill file exists for this employee.</PanelNote>;
  }

  return (
    <div className="grid gap-3">
      <div className="text-sm text-[var(--tiny-muted)]">
        Employee-private skills are edited here after they already exist. New skills still start from Chat and the company skill-creator workflow.
      </div>
      <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="grid content-start gap-1">
          {(skillsQuery.data?.skills ?? []).map((skill) => (
            <SelectionRow
              key={skill.skillId}
              selected={skill.skillId === activeSkillId}
              className="min-w-0 truncate px-3 py-2.5 text-sm"
              onClick={() => requestTransition(() => setSelectedSkillId(skill.skillId))}
            >
              {skill.name}
            </SelectionRow>
              ))}
              {skillsQuery.isLoading ? <PanelNote>Loading skills...</PanelNote> : null}
            </div>
        <div className="grid min-w-0 gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-sm text-[var(--tiny-muted)]">{skillQuery.data?.relativePath ?? "SKILL.md"}</div>
            <Button type="button" size="sm" disabled={!skillQuery.data || !skillDirty || saveSkillMutation.isPending} onClick={() => saveSkillMutation.mutate()}>
              <Save className="mr-2 size-4" />
              Save skill
            </Button>
            <SaveStateBadge dirty={skillDirty} saving={saveSkillMutation.isPending} />
          </div>
          <Textarea
            className="min-h-[320px] font-mono text-xs leading-5"
            value={content}
            onChange={(event) => {
              const nextContent = event.currentTarget.value;
              setEditor((current) => ({
                identity: skillIdentity,
                content: nextContent,
                baseline: current.identity === skillIdentity ? current.baseline : skillQuery.data?.content ?? "",
              }));
            }}
          />
          {saveSkillMutation.error ? <div className="text-sm text-destructive">{errorText(saveSkillMutation.error, "Failed to save skill.")}</div> : null}
        </div>
      </div>
    </div>
  );
}

function CreateEmployeeDialog({
  companyId,
  model,
  runtimeDefaults,
  disabled,
  onCreated,
}: {
  companyId: string;
  model?: EmployeesAdminState;
  runtimeDefaults?: EmployeeRuntimeConfig;
  disabled: boolean;
  onCreated(): Promise<void>;
}): ReactElement {
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");
  const [summary, setSummary] = useState("");
  const [runtimeModelRef, setRuntimeModelRef] = useState(() => defaultRuntimeModelRef(model, runtimeDefaults));
  useEffect(() => {
    setRuntimeModelRef((current) => current || defaultRuntimeModelRef(model, runtimeDefaults));
  }, [model, runtimeDefaults]);
  const runtime = runtimeFromRef(runtimeModelRef, runtimeDefaults);
  const mutation = useMutation({
    mutationFn: () => createEmployee({
      companyId,
      displayName,
      role,
      summary,
      runtime,
      instructionContent: summary.trim() ? `You are ${displayName.trim()}.\n\n${summary.trim()}\n` : undefined,
    }),
    onSuccess: async () => {
      setDisplayName("");
      setRole("");
      setSummary("");
      await onCreated();
    },
  });
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="h-8 px-2" disabled={disabled}>
          <Plus className="mr-2 size-4" />
          New employee
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New employee</DialogTitle>
          <DialogDescription>Create a runtime-capable employee in the current company.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input value={displayName} placeholder="Display name" onChange={(event) => setDisplayName(event.currentTarget.value)} />
          <div className="rounded-md border border-[var(--tiny-line-soft)] px-3 py-2 text-xs text-[var(--tiny-muted)]">
            Employee ID will be generated as <span className="font-mono text-foreground">{previewEmployeeId(displayName)}</span>.
          </div>
          <Input value={role} placeholder="Role" onChange={(event) => setRole(event.currentTarget.value)} />
          <Select value={runtimeModelRef} onValueChange={setRuntimeModelRef}>
            <SelectTrigger><SelectValue placeholder="Runtime model" /></SelectTrigger>
            <SelectContent>
              {runtimeModelOptions(model, runtime ? draftFromRuntime(runtime) : undefined).map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea value={summary} placeholder="Responsibilities" onChange={(event) => setSummary(event.currentTarget.value)} />
          {mutation.error ? <div className="text-sm text-destructive">{errorText(mutation.error, "Failed to create employee.")}</div> : null}
        </div>
        <DialogFooter>
          <Button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldGrid({ children }: { children: ReactNode }): ReactElement {
  return <div className="grid gap-3 md:grid-cols-3">{children}</div>;
}

function LabelledField({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      <span className="text-xs font-semibold text-[var(--tiny-muted)]">{label}</span>
      {children}
    </label>
  );
}

function PathRow({ label, value }: { label: string; value?: string }): ReactElement {
  return (
    <div className="grid gap-1 rounded-md border border-[var(--tiny-line-soft)] px-3 py-2 md:grid-cols-[120px_minmax(0,1fr)]">
      <div className="text-xs font-semibold text-[var(--tiny-muted)]">{label}</div>
      <div className="min-w-0 truncate font-mono text-xs" title={value}>{value ?? "Not available"}</div>
    </div>
  );
}

function RuntimeValue({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold text-[var(--tiny-muted)]">{label}</div>
      <div className="truncate font-mono text-xs" title={value}>{value}</div>
    </div>
  );
}

function PanelNote({ children }: { children: ReactNode }): ReactElement {
  return <div className="rounded-md border border-[var(--tiny-line-soft)] bg-[var(--tiny-surface)] px-3 py-2 text-sm text-[var(--tiny-muted)]">{children}</div>;
}

function selectedEmployeeFor(model: EmployeesAdminState | undefined, selectedEmployeeId: string): EmployeeAdminRecord | undefined {
  return model?.employees.find((employee) => employee.employeeId === selectedEmployeeId) ?? model?.employees[0];
}

function draftFromEmployee(employee: EmployeeAdminRecord): EmployeeDraft {
  const agents = editableAgentsFile(employee);
  return {
    avatarSeed: employee.profile.avatarSeed,
    displayName: employee.profile.displayName ?? "",
    role: employee.profile.role,
    presenceMode: employee.profile.presenceMode,
    sceneProfile: employee.profile.sceneProfile ?? "",
    modelProvider: employee.runtime.modelProvider ?? "",
    modelId: employee.runtime.modelId ?? "",
    thinkingLevel: employee.runtime.thinkingLevel,
    agentsContent: agents?.content ?? "",
  };
}

function employeeDraftEqual(left: EmployeeDraft, right: EmployeeDraft): boolean {
  return left.displayName === right.displayName
    && left.avatarSeed === right.avatarSeed
    && left.role === right.role
    && left.presenceMode === right.presenceMode
    && left.sceneProfile === right.sceneProfile
    && left.modelProvider === right.modelProvider
    && left.modelId === right.modelId
    && left.thinkingLevel === right.thinkingLevel
    && left.agentsContent === right.agentsContent;
}

function employeeFromDraft(employee: EmployeeAdminRecord, draft: EmployeeDraft): EmployeeAdminRecord {
  const agents = editableAgentsFile(employee);
  return {
    ...employee,
    profile: {
      ...employee.profile,
      avatarSeed: draft.avatarSeed,
      displayName: draft.displayName,
      role: draft.role,
      presenceMode: draft.presenceMode,
      ...(draft.sceneProfile.trim() ? { sceneProfile: draft.sceneProfile } : {}),
    },
    runtime: {
      ...employee.runtime,
      modelProvider: draft.modelProvider,
      modelId: draft.modelId,
      thinkingLevel: draft.thinkingLevel,
    },
    localAssets: {
      ...employee.localAssets,
      homePath: employee.localAssets?.homePath ?? "",
      workspacePath: employee.localAssets?.workspacePath ?? "",
      skillPaths: employee.localAssets?.skillPaths ?? [],
      instructionFiles: (employee.localAssets?.instructionFiles ?? []).map((file) =>
        agents && file.path === agents.path ? { ...file, content: draft.agentsContent } : file,
      ),
    },
  };
}

function editableAgentsFile(employee: EmployeeAdminRecord): EmployeeInstructionFile | undefined {
  return employee.localAssets?.instructionFiles.find((file) => file.editable && file.name === "AGENTS.md")
    ?? employee.localAssets?.instructionFiles.find((file) => file.editable);
}

function companySkillsPath(employee: EmployeeAdminRecord): string | undefined {
  return employee.localAssets?.skillPaths.find((skillPath) => !isEmployeeSkillPath(employee, skillPath));
}

function employeeSkillsPath(employee: EmployeeAdminRecord): string | undefined {
  return employee.localAssets?.skillPaths.find((skillPath) => isEmployeeSkillPath(employee, skillPath));
}

function isEmployeeSkillPath(employee: EmployeeAdminRecord, skillPath: string): boolean {
  return skillPath === `${employee.localAssets?.homePath}\\skills`
    || skillPath === `${employee.localAssets?.homePath}/skills`
    || skillPath.includes(`employees\\${employee.employeeId}\\skills`)
    || skillPath.includes(`employees/${employee.employeeId}/skills`);
}

function employeeLabel(employee: EmployeeAdminRecord): string {
  return employee.profile.displayName?.trim() || "Unnamed employee";
}

type RuntimeModelOption = {
  value: string;
  label: string;
};

function runtimeModelOptions(model: EmployeesAdminState | undefined, draft?: Pick<EmployeeDraft, "modelProvider" | "modelId">): RuntimeModelOption[] {
  const options = new Map<string, RuntimeModelOption>();
  for (const item of model?.availableModels ?? []) {
    const value = modelRef(item.provider, item.id);
    options.set(value, {
      value,
      label: `${item.name || item.id} · ${value}`,
    });
  }
  const selected = draft ? modelRefFromDraft(draft) : "";
  if (selected && !options.has(selected)) {
    options.set(selected, {
      value: selected,
      label: `${selected} · unavailable`,
    });
  }
  return Array.from(options.values());
}

function modelRefFromDraft(draft: Pick<EmployeeDraft, "modelProvider" | "modelId">): string {
  return draft.modelProvider && draft.modelId ? modelRef(draft.modelProvider, draft.modelId) : "";
}

function modelRefFromRuntime(runtime: EmployeeRuntimeConfig | undefined): string {
  return runtime?.modelProvider && runtime.modelId ? modelRef(runtime.modelProvider, runtime.modelId) : "";
}

function defaultRuntimeModelRef(model: EmployeesAdminState | undefined, runtime: EmployeeRuntimeConfig | undefined): string {
  const configured = modelRefFromRuntime(runtime);
  const firstAvailable = model?.availableModels[0];
  return configured || (firstAvailable ? modelRef(firstAvailable.provider, firstAvailable.id) : "");
}

function modelRef(provider: string, id: string): string {
  return `${provider}/${id}`;
}

function draftModelFromRef(value: string): Pick<EmployeeDraft, "modelProvider" | "modelId"> {
  const [provider, ...idParts] = value.split("/");
  return {
    modelProvider: provider ?? "",
    modelId: idParts.join("/"),
  };
}

function runtimeFromRef(value: string, defaults: EmployeeRuntimeConfig | undefined): EmployeeRuntimeConfig | undefined {
  const model = draftModelFromRef(value);
  if (!model.modelProvider || !model.modelId) {
    return defaults;
  }
  return {
    version: 1,
    modelProvider: model.modelProvider,
    modelId: model.modelId,
    thinkingLevel: defaults?.thinkingLevel ?? "minimal",
  };
}

function draftFromRuntime(runtime: EmployeeRuntimeConfig): Pick<EmployeeDraft, "modelProvider" | "modelId"> {
  return {
    modelProvider: runtime.modelProvider ?? "",
    modelId: runtime.modelId ?? "",
  };
}

function previewEmployeeId(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "employee";
}

function requireSkill(skill: EmployeePrivateSkillFile | undefined): EmployeePrivateSkillFile {
  if (!skill) {
    throw new Error("Select a skill before saving.");
  }
  return skill;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
