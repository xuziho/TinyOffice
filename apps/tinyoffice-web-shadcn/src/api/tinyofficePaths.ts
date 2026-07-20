import { required } from "./tinyofficeRequest";

export function currentSessionPath(): string {
  return "/api/tinyoffice/session/current";
}

export function currentCompanySessionPath(): string {
  return "/api/tinyoffice/session/current-company";
}

export function companiesPath(): string {
  return "/api/companies";
}

export function companyLifecyclePath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}`;
}

export function companySystemAiPath(companyId: string): string {
  return `${companyLifecyclePath(companyId)}/system-ai`;
}

export function companyChatPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/chat`;
}

export function chatChannelsPath(companyId: string): string {
  return `${companyChatPath(companyId)}/channels`;
}

export function chatChannelPath(companyId: string, chatChannelId: string): string {
  return `${chatChannelsPath(companyId)}/${encodeURIComponent(required(chatChannelId, "chatChannelId"))}`;
}

export function chatEntriesPath(companyId: string): string {
  return `${companyChatPath(companyId)}/entries`;
}

export function companyDirectoryPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/directory`;
}

export function companyEmployeesPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/employees`;
}

export function companyEmployeeRuntimeSummaryPath(companyId: string): string {
  return `${companyEmployeesPath(companyId)}/runtime-summary`;
}

export function companyMemberRuntimePath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/member-runtime`;
}

export function memberRuntimeMemberPath(companyId: string, memberId: string): string {
  return `${companyMemberRuntimePath(companyId)}/members/${encodeURIComponent(required(memberId, "memberId"))}`;
}

export function employeePrivateSkillsPath(companyId: string, memberId: string): string {
  return `${memberRuntimeMemberPath(companyId, memberId)}/skills`;
}

export function employeePrivateSkillPath(companyId: string, memberId: string, skillId: string): string {
  return `${employeePrivateSkillsPath(companyId, memberId)}/${encodeURIComponent(required(skillId, "skillId"))}`;
}

export function companySessionsPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/sessions/view-model`;
}

export function companyTasksPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/tasks/view-model`;
}

export function companyPromptPolicyPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/prompt-policy`;
}

export function companyAccessPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/access`;
}

export function companyDoctorPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/doctor`;
}

export function companySkillsPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/skills`;
}

export function companySkillPath(companyId: string, skillId: string): string {
  return `${companySkillsPath(companyId)}/${encodeURIComponent(required(skillId, "skillId"))}`;
}

export function companyCapabilitiesPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/capabilities`;
}

export function companyMcpPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/mcp`;
}

export function companyBrandingPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/branding`;
}

export function promptPolicyTemplatePath(companyId: string, templateId: string): string {
  return `${companyPromptPolicyPath(companyId)}/templates/${encodeURIComponent(required(templateId, "templateId"))}`;
}

export function promptPolicyBlockPath(companyId: string, blockPath: string): string {
  return `${companyPromptPolicyPath(companyId)}/blocks/${encodeURIComponent(required(blockPath, "blockPath"))}`;
}

export function companyWorkPath(companyId: string): string {
  return `/api/companies/${encodeURIComponent(required(companyId, "companyId"))}/work`;
}

export function companyWorkTaskActionPath(companyId: string, workTaskId: string, action: string): string {
  return `${companyWorkPath(companyId)}/${encodeURIComponent(required(workTaskId, "workTaskId"))}/${encodeURIComponent(required(action, "action"))}`;
}

export function chatRoomPath(companyId: string, roomId: string): string {
  return `${companyChatPath(companyId)}/rooms/${encodeURIComponent(required(roomId, "roomId"))}`;
}
