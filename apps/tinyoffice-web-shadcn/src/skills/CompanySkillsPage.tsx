import { useEffect, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import { Save } from "lucide-react";

import { getCompanySkill, getCompanySkills, saveCompanySkill } from "@/api/skillsClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectionList, SelectionRow, SelectionRowTitle } from "@/components/product/SelectionList";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "@/config/unsavedChangesContext";

export function CompanySkillsPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const listQuery = useQuery({ queryKey: ["company-skills", companyId], enabled: Boolean(companyId), queryFn: () => getCompanySkills({ companyId }) });
  const activeId = listQuery.data?.skills.some((skill) => skill.skillId === selected) ? selected : listQuery.data?.skills[0]?.skillId ?? "";
  const skillQuery = useQuery({ queryKey: ["company-skill", companyId, activeId], enabled: Boolean(companyId && activeId), queryFn: () => getCompanySkill({ companyId, skillId: activeId }) });
  useUnsavedChanges(`company-skill:${companyId}`, Boolean(activeId && content !== baseline));
  useEffect(() => {
    if (!skillQuery.data) return;
    setContent(skillQuery.data.content);
    setBaseline(skillQuery.data.content);
  }, [skillQuery.data]);
  const saveMutation = useMutation({
    mutationFn: () => saveCompanySkill({ companyId, skillId: activeId, content }),
    onSuccess: async (file) => {
      setContent(file.content);
      setBaseline(file.content);
      queryClient.setQueryData(["company-skill", companyId, activeId], file);
      await queryClient.invalidateQueries({ queryKey: ["company-skills", companyId] });
    },
  });

  return (
    <main className="grid h-svh grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background">
      <header className="tiny-room-header flex items-center justify-between border-b">
        <div><div className="tiny-room-title">Company Skills</div><div className="tiny-room-subtitle">Shared workflow knowledge for the current company</div></div>
        <Badge variant="secondary">Company-wide</Badge>
      </header>
      <section className="grid min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
        <aside className="overflow-auto border-r bg-muted/20 p-3">
          <p className="mb-3 text-xs text-muted-foreground">New Skills start in Chat after confirmation. This page edits Skills that already exist.</p>
          <SelectionList>
            {(listQuery.data?.skills ?? []).map((skill) => <SelectionRow key={skill.skillId} selected={skill.skillId === activeId} className="px-3 py-2.5" onClick={() => setSelected(skill.skillId)}><SelectionRowTitle className="truncate">{skill.name}</SelectionRowTitle></SelectionRow>)}
            {!listQuery.isLoading && !(listQuery.data?.skills.length) ? <p className="rounded-md border p-3 text-sm text-muted-foreground">No Company Skills yet. Ask an employee in Chat to create a reusable company method.</p> : null}
          </SelectionList>
        </aside>
        <div className="min-w-0 overflow-auto p-5">
          {skillQuery.data ? <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">{skillQuery.data.name}</h2><p className="text-sm text-muted-foreground">{skillQuery.data.relativePath}</p></div><Button size="sm" disabled={content === baseline || saveMutation.isPending} onClick={() => saveMutation.mutate()}><Save />Save and reload</Button></div>
            <Textarea className="min-h-[620px] font-mono text-xs leading-5" value={content} onChange={(event) => setContent(event.currentTarget.value)} />
            {saveMutation.error ? <p className="text-sm text-destructive">{saveMutation.error instanceof Error ? saveMutation.error.message : "Save failed."}</p> : null}
          </div> : <div className="rounded-md border p-4 text-sm text-muted-foreground">Select a Company Skill to inspect it.</div>}
        </div>
      </section>
    </main>
  );
}
