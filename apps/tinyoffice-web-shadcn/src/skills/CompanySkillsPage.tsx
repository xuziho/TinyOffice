import { useEffect, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import { Save } from "lucide-react";

import { getCompanySkill, getCompanySkills, saveCompanySkill } from "@/api/skillsClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductState } from "@/components/product/ProductState";
import { SelectionList, SelectionRow, SelectionRowTitle } from "@/components/product/SelectionList";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "@/config/unsavedChangesContext";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { useTranslation } from "react-i18next";

export function CompanySkillsPage({ currentSession }: { currentSession?: TinyOfficeCurrentSession }): ReactElement {
  const { t } = useTranslation();
  const companyId = currentSession?.companyId ?? currentSession?.currentCompanyId ?? "";
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const listQuery = useQuery({ queryKey: chatQueryKeys.companySkills(companyId), enabled: Boolean(companyId), queryFn: () => getCompanySkills({ companyId }) });
  const skills = listQuery.data?.skills ?? [];
  const activeId = listQuery.data?.skills.some((skill) => skill.skillId === selected) ? selected : listQuery.data?.skills[0]?.skillId ?? "";
  const skillQuery = useQuery({ queryKey: chatQueryKeys.companySkill(companyId, activeId), enabled: Boolean(companyId && activeId), queryFn: () => getCompanySkill({ companyId, skillId: activeId }) });
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
      await queryClient.invalidateQueries({ queryKey: chatQueryKeys.companySkills(companyId) });
    },
  });

  return (
    <main className="h-full overflow-hidden bg-background">
      {listQuery.isLoading ? <ProductState className="m-5" description={t("admin.loadingCompanySkills")} /> : listQuery.error ? <ProductState className="m-5" tone="error" description={listQuery.error instanceof Error ? listQuery.error.message : t("admin.companySkillsLoadFailed")} /> : skills.length === 0 ? (
        <div className="grid place-items-center overflow-auto p-6"><ProductState title={t("admin.noCompanySkills")} description={t("admin.noCompanySkillsDescription")} /></div>
      ) : <section className="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
        <aside className="overflow-auto border-r bg-muted/20 p-3">
          <p className="mb-3 text-xs text-muted-foreground">{t("admin.skillCreationHelp")}</p>
          <SelectionList>
            {skills.map((skill) => <SelectionRow key={skill.skillId} selected={skill.skillId === activeId} className="px-3 py-2.5" onClick={() => setSelected(skill.skillId)}><SelectionRowTitle className="truncate">{skill.name}</SelectionRowTitle></SelectionRow>)}
          </SelectionList>
        </aside>
        <div className="min-w-0 overflow-auto p-5">
          {skillQuery.data ? <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{skillQuery.data.name}</h2><Badge variant="secondary">{t("admin.companyWide")}</Badge></div><p className="text-sm text-muted-foreground">{skillQuery.data.relativePath}</p></div><Button size="sm" disabled={content === baseline || saveMutation.isPending} onClick={() => saveMutation.mutate()}><Save />{t("admin.saveReload")}</Button></div>
            <Textarea className="min-h-[620px] font-mono text-xs leading-5" value={content} onChange={(event) => setContent(event.currentTarget.value)} />
            {saveMutation.error ? <p className="text-sm text-destructive">{saveMutation.error instanceof Error ? saveMutation.error.message : t("admin.saveFailed")}</p> : null}
          </div> : <ProductState compact description={t("admin.selectCompanySkill")} />}
        </div>
      </section>}
    </main>
  );
}
