import type { CompanySkillFile, CompanySkillsState } from "tinyoffice/frontend-api-contracts";
import { companySkillPath, companySkillsPath } from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export function getCompanySkills(input: { companyId?: string }): Promise<CompanySkillsState> {
  const companyId = required(input.companyId, "companyId");
  return requestJson<CompanySkillsState>(companySkillsPath(companyId));
}

export function getCompanySkill(input: { companyId?: string; skillId?: string }): Promise<CompanySkillFile> {
  const companyId = required(input.companyId, "companyId");
  const skillId = required(input.skillId, "skillId");
  return requestJson<CompanySkillFile>(companySkillPath(companyId, skillId));
}

export function saveCompanySkill(input: { companyId?: string; skillId?: string; content: string }): Promise<CompanySkillFile> {
  const companyId = required(input.companyId, "companyId");
  const skillId = required(input.skillId, "skillId");
  return requestJson<CompanySkillFile>(companySkillPath(companyId, skillId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: input.content }),
  });
}
