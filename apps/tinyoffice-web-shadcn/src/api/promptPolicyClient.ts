import type {
  PromptPolicyViewModel,
  SavePromptPolicyBlockRequest,
  SavePromptPolicyTemplateRequest,
} from "tinyoffice/frontend-api-contracts";
import {
  companyPromptPolicyPath,
  promptPolicyBlockPath,
  promptPolicyTemplatePath,
} from "./tinyofficePaths";
import { requestJson, required } from "./tinyofficeRequest";

export async function getPromptPolicy(input: { companyId?: string }): Promise<PromptPolicyViewModel> {
  return requestJson<PromptPolicyViewModel>(companyPromptPolicyPath(required(input.companyId, "companyId")));
}

export async function savePromptPolicyTemplate(input: SavePromptPolicyTemplateRequest): Promise<PromptPolicyViewModel> {
  const companyId = required(input.companyId, "companyId");
  const templateId = required(input.templateId, "templateId");
  return requestJson<PromptPolicyViewModel>(promptPolicyTemplatePath(companyId, templateId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      templateId,
      content: input.content,
    }),
  });
}

export async function resetPromptPolicyTemplate(input: Omit<SavePromptPolicyTemplateRequest, "content">): Promise<PromptPolicyViewModel> {
  const companyId = required(input.companyId, "companyId");
  const templateId = required(input.templateId, "templateId");
  return requestJson<PromptPolicyViewModel>(`${promptPolicyTemplatePath(companyId, templateId)}/reset`, {
    method: "POST",
  });
}

export async function savePromptPolicyBlock(input: SavePromptPolicyBlockRequest): Promise<PromptPolicyViewModel> {
  const companyId = required(input.companyId, "companyId");
  const path = required(input.path, "path");
  return requestJson<PromptPolicyViewModel>(promptPolicyBlockPath(companyId, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId,
      path,
      ...(input.title ? { title: input.title } : {}),
      content: input.content,
    }),
  });
}

export async function resetPromptPolicyBlock(input: Pick<SavePromptPolicyBlockRequest, "companyId" | "path">): Promise<PromptPolicyViewModel> {
  const companyId = required(input.companyId, "companyId");
  const path = required(input.path, "path");
  return requestJson<PromptPolicyViewModel>(`${promptPolicyBlockPath(companyId, path)}/reset`, {
    method: "POST",
  });
}
