import { COMPANY_DIRECTORY_CONTRACT_VERSION, COMPANY_DIRECTORY_SCHEMA } from "../../collaboration/api/company-directory-api-routes.js";
import type { ConversationApiMessageService } from "../../collaboration/api/conversation-api-service.js";
import type { ChatCreateEntryApiService, ChatProjectionApiService, ChatRoomMessageApiService } from "../../collaboration/api/chat-projection-api-routes.js";
import type { ChannelService } from "../../collaboration/channel/channel-service.js";
import type { CompanyDirectoryDto } from "../../collaboration/api/company-directory-api-routes.js";
import type { CompanyMemberDirectoryResponse } from "../contracts/tinyoffice-api-contracts.js";
import type { ToolSafetyViewModel } from "../../runtime/company-config/tool-guard-admin.js";
import type { AccessApiService, ChatAttachmentApiService, CompanyLifecycleApiService, CompanyMemberDirectoryApiService, DoctorApiService, EmployeeRuntimeSummaryApiService, IntakeEventApiService, MemberRuntimeApiService, ProcessTraceApiService, PromptPolicyApiService, RecruitmentApiService, RuntimeModelsApiService, SessionExplorerApiService, TasksRunActionApiService, TasksViewModelApiService, TinyOfficeApiOptions, WorkCreationApiService } from "./contracts.js";
import { projectCompanyMemberDirectoryEntries } from "./member-directory-view.js";

export async function resolveMessageService(options: TinyOfficeApiOptions, companyId: string): Promise<ConversationApiMessageService> {
  return typeof options.messageService === "function"
    ? await options.messageService(companyId)
    : options.messageService;
}

export async function resolveChatProjectionService(options: TinyOfficeApiOptions, companyId: string): Promise<ChatProjectionApiService> {
  return typeof options.chatProjectionService === "function"
    ? await options.chatProjectionService(companyId)
    : options.chatProjectionService;
}

export async function resolveChatCreateEntryService(options: TinyOfficeApiOptions, companyId: string): Promise<ChatCreateEntryApiService> {
  if (!options.chatCreateEntryService) {
    throw new Error("chat create-entry service is not configured");
  }
  return typeof options.chatCreateEntryService === "function"
    ? await options.chatCreateEntryService(companyId)
    : options.chatCreateEntryService;
}

export async function resolveChatRoomMessageService(options: TinyOfficeApiOptions, companyId: string): Promise<ChatRoomMessageApiService> {
  if (!options.chatRoomMessageService) {
    throw new Error("chat room message service is not configured");
  }
  return typeof options.chatRoomMessageService === "function"
    ? await options.chatRoomMessageService(companyId)
    : options.chatRoomMessageService;
}

export async function resolveChannelService(options: TinyOfficeApiOptions, companyId: string): Promise<ChannelService> {
  if (!options.channelService) {
    throw new Error("Channel service is not configured");
  }
  return typeof options.channelService === "function"
    ? await options.channelService(companyId)
    : options.channelService;
}

export async function resolveAttachmentService(options: TinyOfficeApiOptions, companyId: string): Promise<ChatAttachmentApiService> {
  if (!options.attachmentService) {
    throw new Error("Chat attachment service is not configured");
  }
  return typeof options.attachmentService === "function"
    ? await options.attachmentService(companyId)
    : options.attachmentService;
}

export async function resolveProcessTraceService(options: TinyOfficeApiOptions, companyId: string): Promise<ProcessTraceApiService> {
  if (!options.processTraceService) {
    throw new Error("process trace service is not configured");
  }
  return typeof options.processTraceService === "function"
    ? await options.processTraceService(companyId)
    : options.processTraceService;
}

export async function resolveDirectory(options: TinyOfficeApiOptions, companyId: string): Promise<CompanyDirectoryDto> {
  if (!options.directorySource) {
    throw new Error("company directory source is not configured");
  }
  const directory = typeof options.directorySource === "function"
    ? await options.directorySource(companyId)
    : await options.directorySource.loadCompanyDirectory(companyId);
  if (!Array.isArray(directory.directoryMembers)) {
    throw new Error("directoryMembers is required for company directory product API");
  }
  return {
    schema: COMPANY_DIRECTORY_SCHEMA,
    version: COMPANY_DIRECTORY_CONTRACT_VERSION,
    companyId,
    directoryMembers: directory.directoryMembers,
  };
}

export function resolveCompanyLifecycleService(options: TinyOfficeApiOptions): CompanyLifecycleApiService {
  if (!options.companyLifecycleService) {
    throw new Error("Company lifecycle service is not configured");
  }
  return options.companyLifecycleService;
}

export async function resolveTasksViewModelService(options: TinyOfficeApiOptions, companyId: string): Promise<TasksViewModelApiService> {
  if (!options.tasksViewModelService) {
    throw new Error("Tasks view-model service is not configured");
  }
  return typeof options.tasksViewModelService === "function"
    ? await options.tasksViewModelService(companyId)
    : options.tasksViewModelService;
}

export async function resolveTasksRunActionService(options: TinyOfficeApiOptions, companyId: string): Promise<TasksRunActionApiService> {
  if (!options.tasksRunActionService) {
    throw new Error("Tasks Run action service is not configured");
  }
  return typeof options.tasksRunActionService === "function"
    ? await options.tasksRunActionService(companyId)
    : options.tasksRunActionService;
}

export async function resolveWorkCreationService(options: TinyOfficeApiOptions, companyId: string): Promise<WorkCreationApiService> {
  if (!options.workCreationService) {
    throw new Error("Work creation service is not configured");
  }
  return typeof options.workCreationService === "function"
    ? await options.workCreationService(companyId)
    : options.workCreationService;
}

export async function resolveSessionExplorerService(options: TinyOfficeApiOptions, companyId: string): Promise<SessionExplorerApiService> {
  if (!options.sessionExplorerService) {
    throw new Error("Session Explorer service is not configured");
  }
  return typeof options.sessionExplorerService === "function"
    ? await options.sessionExplorerService(companyId)
    : options.sessionExplorerService;
}

export async function resolveEmployeeRuntimeSummaryService(options: TinyOfficeApiOptions, companyId: string): Promise<EmployeeRuntimeSummaryApiService> {
  if (!options.employeeRuntimeSummaryService) {
    throw new Error("employee runtime summary service is not configured");
  }
  return typeof options.employeeRuntimeSummaryService === "function"
    ? await options.employeeRuntimeSummaryService(companyId)
    : options.employeeRuntimeSummaryService;
}

export async function resolveMemberRuntimeService(options: TinyOfficeApiOptions, companyId: string): Promise<MemberRuntimeApiService> {
  if (!options.memberRuntimeService) {
    throw new Error("member runtime service is not configured");
  }
  return typeof options.memberRuntimeService === "function"
    ? await options.memberRuntimeService(companyId)
    : options.memberRuntimeService;
}

export async function resolveCompanyMemberDirectory(
  options: TinyOfficeApiOptions,
  companyId: string,
): Promise<CompanyMemberDirectoryResponse> {
  if (options.memberDirectoryService) {
    const service = await resolveMemberDirectoryService(options, companyId);
    return service.loadCompanyMemberDirectory(companyId);
  }
  const directory = await resolveDirectory(options, companyId);
  return {
    schema: "company-member-directory",
    version: 1,
    companyId,
    members: projectCompanyMemberDirectoryEntries(directory.directoryMembers),
  };
}

export async function resolveMemberDirectoryService(
  options: TinyOfficeApiOptions,
  companyId: string,
): Promise<CompanyMemberDirectoryApiService> {
  if (!options.memberDirectoryService) {
    throw new Error("company member directory service is not configured");
  }
  return typeof options.memberDirectoryService === "function"
    ? await options.memberDirectoryService(companyId)
    : options.memberDirectoryService;
}

export function resolveRuntimeModelsService(options: TinyOfficeApiOptions): RuntimeModelsApiService {
  if (!options.runtimeModelsService) {
    throw new Error("runtime models service is not configured");
  }
  return options.runtimeModelsService;
}

export async function resolveRecruitmentService(options: TinyOfficeApiOptions, companyId: string): Promise<RecruitmentApiService> {
  if (!options.recruitmentService) {
    throw new Error("recruitment service is not configured");
  }
  return typeof options.recruitmentService === "function"
    ? await options.recruitmentService(companyId)
    : options.recruitmentService;
}

export async function resolvePromptPolicyService(options: TinyOfficeApiOptions, companyId: string): Promise<PromptPolicyApiService> {
  if (!options.promptPolicyService) {
    throw new Error("prompt policy service is not configured");
  }
  return typeof options.promptPolicyService === "function"
    ? await options.promptPolicyService(companyId)
    : options.promptPolicyService;
}

export async function resolveAccessService(options: TinyOfficeApiOptions, companyId: string): Promise<AccessApiService> {
  if (!options.accessService) {
    throw new Error("Access service is not configured");
  }
  return typeof options.accessService === "function"
    ? await options.accessService(companyId)
    : options.accessService;
}

export async function resolveDoctorService(options: TinyOfficeApiOptions, companyId: string): Promise<DoctorApiService> {
  if (!options.doctorService) {
    throw new Error("Doctor service is not configured");
  }
  return typeof options.doctorService === "function"
    ? await options.doctorService(companyId)
    : options.doctorService;
}

export async function resolveIntakeEventService(options: TinyOfficeApiOptions, companyId: string): Promise<IntakeEventApiService> {
  if (!options.intakeEventService) {
    throw new Error("Intake event service is not configured");
  }
  return typeof options.intakeEventService === "function"
    ? await options.intakeEventService(companyId)
    : options.intakeEventService;
}

export function accessApiViewModel(companyId: string, viewModel: ToolSafetyViewModel): ToolSafetyViewModel {
  const accessPath = `/api/companies/${encodeURIComponent(companyId)}/access`;
  return {
    ...viewModel,
    routes: {
      htmlPath: "/config/access",
      viewModelJsonPath: accessPath,
      savePolicyPath: accessPath,
      previewPath: `${accessPath}/preview`,
    },
  };
}
