import type { ChatDispatchApiSink, ChatProjectionApiService, ChatCreateEntryApiService, ChatRoomMessageApiService } from "../../collaboration/api/chat-projection-api-routes.js";
import type { ChatAttachmentRecord, PublicChatAttachment } from "../../collaboration/attachments/attachment-contracts.js";
import type { ChatParticipantIdentitySelector } from "../../collaboration/chat/chat-projection-service.js";
import type { CompanyDirectoryApiSource, CompanyDirectoryDto } from "../../collaboration/api/company-directory-api-routes.js";
import type { ConversationApiMessageService } from "../../collaboration/api/conversation-api-service.js";
import type { ChannelService } from "../../collaboration/channel/channel-service.js";
import type { TinyOfficeRealtimePublisher } from "../../collaboration/contracts/tinyoffice-realtime-contract.js";
import type { TinyOfficeAuthOptions, TinyOfficeCurrentUserSession } from "../../auth/tinyoffice-session.js";
import type { CompaniesAdminViewModel, CompanyMemberDirectoryResponse, DeleteCompanyResult, EmployeeRuntimeSummaryViewModel, OwnedCreateCompanyResult, RecruitEmployeeRequest, RecruitEmployeeResult, RuntimeModelsResponse, SessionExplorerViewModel, TasksViewModel } from "../contracts/tinyoffice-api-contracts.js";
import type { ExecuteTasksRunActionInput, TasksRunActionResult } from "../../work/tasks-run-actions.js";
import type { CreateWorkInput, CreateWorkResult, WorkTaskLifecycleInput } from "../../work/work-service.js";
import type { WorkTaskDetail } from "../../work/domain.js";
import type { CompanyRuntimeDeletionGuard } from "../../runtime/company-config/companies-admin.js";
import type {
  EmployeePrivateSkillFile,
  EmployeePrivateSkillsState,
  EmployeesAdminState,
} from "../../runtime/company-config/employees-admin.js";
import type { PromptPolicyViewModel } from "../../runtime/company-config/prompt-blocks-admin.js";
import type { ApprovalContextKind, ApprovalGrant, ApprovalStatus } from "../../governance/domain/approval.js";
import type { ToolSafetyDecisionPreview, ToolSafetyOperation, ToolSafetyViewModel } from "../../runtime/company-config/tool-guard-admin.js";
import type { ProcessTraceEvent } from "../../runtime/contracts/process-trace-event.js";
import type { TinyOfficeDoctorReport } from "../../runtime/doctor/tinyoffice-doctor.js";
import type { IntakeEventReceipt } from "../../intake/intake-event-service.js";
import type { RuntimeSessionRepositoryLike } from "../../runtime/storage/runtime-session-repository.js";
import type { TinyOfficeBackupService } from "../../runtime/backup/tinyoffice-backup-service.js";
import type { TinyOfficeUpdateJob, TinyOfficeUpdateStatus } from "../contracts/tinyoffice-frontend-api-contracts.js";

export interface TinyOfficeApiOptions {
  repoRoot?: string;
  backupService?: TinyOfficeBackupService;
  updateService?: UpdateApiService;
  runtimeSessionRepository?: RuntimeSessionRepositoryLike | ((companyId: string) => Promise<RuntimeSessionRepositoryLike>);
  companyLifecycleService?: CompanyLifecycleApiService;
  tasksViewModelService?: TasksViewModelApiService | ((companyId: string) => Promise<TasksViewModelApiService>);
  tasksRunActionService?: TasksRunActionApiService | ((companyId: string) => Promise<TasksRunActionApiService>);
  workCreationService?: WorkCreationApiService | ((companyId: string) => Promise<WorkCreationApiService>);
  sessionExplorerService?: SessionExplorerApiService | ((companyId: string) => Promise<SessionExplorerApiService>);
  employeeRuntimeSummaryService?: EmployeeRuntimeSummaryApiService | ((companyId: string) => Promise<EmployeeRuntimeSummaryApiService>);
  messageService: ConversationApiMessageService | ((companyId: string) => Promise<ConversationApiMessageService>);
  directorySource?: CompanyDirectoryApiSource | ((companyId: string) => Promise<CompanyDirectoryDto>);
  memberDirectoryService?: CompanyMemberDirectoryApiService | ((companyId: string) => Promise<CompanyMemberDirectoryApiService>);
  memberRuntimeService?: MemberRuntimeApiService | ((companyId: string) => Promise<MemberRuntimeApiService>);
  runtimeModelsService?: RuntimeModelsApiService;
  recruitmentService?: RecruitmentApiService | ((companyId: string) => Promise<RecruitmentApiService>);
  promptPolicyService?: PromptPolicyApiService | ((companyId: string) => Promise<PromptPolicyApiService>);
  accessService?: AccessApiService | ((companyId: string) => Promise<AccessApiService>);
  doctorService?: DoctorApiService | ((companyId: string) => Promise<DoctorApiService>);
  intakeEventService?: IntakeEventApiService | ((companyId: string) => Promise<IntakeEventApiService>);
  chatProjectionService: ChatProjectionApiService | ((companyId: string) => Promise<ChatProjectionApiService>);
  chatCreateEntryService?: ChatCreateEntryApiService | ((companyId: string) => Promise<ChatCreateEntryApiService>);
  chatRoomMessageService?: ChatRoomMessageApiService | ((companyId: string) => Promise<ChatRoomMessageApiService>);
  chatRunControlService?: ChatRunControlApiService | ((companyId: string) => Promise<ChatRunControlApiService>);
  attachmentService?: ChatAttachmentApiService | ((companyId: string) => Promise<ChatAttachmentApiService>);
  channelService?: ChannelService | ((companyId: string) => Promise<ChannelService>);
  processTraceService?: ProcessTraceApiService | ((companyId: string) => Promise<ProcessTraceApiService>);
  realtimePublisher?: TinyOfficeRealtimePublisher;
  chatDispatchSink?: ChatDispatchApiSink;
  auth?: TinyOfficeAuthOptions;
}

export interface ChatAttachmentApiService {
  uploadChatImageAttachment(companyId: string, input: {
    ownerMemberId: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<PublicChatAttachment>;
  getChatAttachment(companyId: string, attachmentId: string): Promise<ChatAttachmentRecord | undefined>;
  listChatAttachmentReferenceConversationIds(companyId: string, attachmentId: string): Promise<string[]>;
  readChatAttachment(record: ChatAttachmentRecord): Promise<Uint8Array>;
  discardChatAttachment?(companyId: string, input: {
    attachmentId: string;
    ownerMemberId: string;
  }): Promise<void>;
}

export type CreateCompanyInput = {
  companyId?: unknown;
  displayName?: unknown;
  ownerMemberId?: unknown;
  ownerDisplayName?: unknown;
  hrEmployeeDisplayName?: unknown;
  hrRuntime?: unknown;
  systemAiRuntime?: unknown;
};

export type DeleteCompanyInput = {
  companyId: string;
  confirmation?: {
    intent?: unknown;
  };
};

export type SaveCompanySystemAiSettingsInput = {
  companyId: string;
  settings?: {
    chatTitleGeneration?: {
      modelProvider?: unknown;
      modelId?: unknown;
    };
    chatTopicSummary?: {
      modelProvider?: unknown;
      modelId?: unknown;
    };
  };
};

export type SwitchCurrentCompanyInput = {
  companyId?: unknown;
};

export interface CompanyLifecycleApiService {
  loadCompanies(): Promise<CompaniesAdminViewModel>;
  createCompany(input: CreateCompanyInput): Promise<OwnedCreateCompanyResult>;
  deleteCompany(input: DeleteCompanyInput, runtime?: CompanyRuntimeDeletionGuard): Promise<DeleteCompanyResult>;
  saveSystemAiSettings?(input: SaveCompanySystemAiSettingsInput): Promise<CompaniesAdminViewModel>;
  switchCurrentCompany(session: TinyOfficeCurrentUserSession, input: SwitchCurrentCompanyInput): Promise<TinyOfficeCurrentUserSession>;
  resolveCurrentUserSession?(session: TinyOfficeCurrentUserSession): Promise<TinyOfficeCurrentUserSession>;
  deletionGuard?: CompanyRuntimeDeletionGuard;
}

export interface TasksViewModelApiService {
  loadTasksViewModel(companyId: string, input: { requestUrl: URL }): Promise<TasksViewModel>;
}

export interface TasksRunActionApiService {
  executeTasksRunAction(companyId: string, input: ExecuteTasksRunActionInput): Promise<TasksRunActionResult>;
}

export interface WorkCreationApiService {
  createWork(companyId: string, input: CreateWorkInput): Promise<CreateWorkResult>;
  cancelWorkTask(companyId: string, input: WorkTaskLifecycleInput): Promise<WorkTaskDetail>;
  archiveWorkTask(companyId: string, input: WorkTaskLifecycleInput): Promise<WorkTaskDetail>;
  restoreWorkTask(companyId: string, input: WorkTaskLifecycleInput): Promise<WorkTaskDetail>;
}

export interface IntakeEventApiService {
  ingestIntakeEvent(companyId: string, input: unknown): Promise<IntakeEventReceipt>;
}

export interface SessionExplorerApiService {
  loadSessionExplorerViewModel(companyId: string, input: {
    requestUrl: URL;
    employeeId?: string;
    sessionId?: string;
    query?: string;
    employeeIdFilter?: string;
  }): Promise<SessionExplorerViewModel>;
}

export interface EmployeeRuntimeSummaryApiService {
  loadEmployeeRuntimeSummary(companyId: string, input: {
    requestUrl: URL;
    employeeId?: string;
  }): Promise<EmployeeRuntimeSummaryViewModel>;
}

export type MemberRuntimeSaveInput = {
  memberId: string;
  profile: unknown;
  resourcePolicy: unknown;
  runtime: unknown;
  instructionFiles?: unknown;
};

export type MemberRuntimeReloadResult = {
  memberId?: string;
  memberIds?: string[];
  reloadedCount: number;
  sessionKeys: string[];
};

export type EmployeePrivateSkillSaveInput = {
  memberId: string;
  skillId: string;
  content: string;
};

export interface MemberRuntimeApiService {
  loadMemberRuntime(companyId: string): Promise<EmployeesAdminState>;
  saveMemberRuntimeMember(companyId: string, input: MemberRuntimeSaveInput): Promise<EmployeesAdminState>;
  setMemberRuntimeEnabled?(companyId: string, memberId: string, enabled: boolean, actorMemberId: string): Promise<EmployeesAdminState>;
  reloadMemberRuntime?(companyId: string, memberId: string): Promise<MemberRuntimeReloadResult>;
  reloadAllMemberRuntimes?(companyId: string): Promise<MemberRuntimeReloadResult>;
  listEmployeePrivateSkills?(companyId: string, memberId: string): Promise<EmployeePrivateSkillsState>;
  readEmployeePrivateSkill?(companyId: string, memberId: string, skillId: string): Promise<EmployeePrivateSkillFile>;
  saveEmployeePrivateSkill?(companyId: string, input: EmployeePrivateSkillSaveInput): Promise<EmployeePrivateSkillFile>;
  listCompanySkills?(companyId: string): Promise<import("../contracts/tinyoffice-frontend-api-contracts.js").CompanySkillsState>;
  readCompanySkill?(companyId: string, skillId: string): Promise<import("../contracts/tinyoffice-frontend-api-contracts.js").CompanySkillFile>;
  saveCompanySkill?(companyId: string, input: { skillId: string; content: string }): Promise<import("../contracts/tinyoffice-frontend-api-contracts.js").CompanySkillFile>;
}

export interface RecruitmentApiService {
  recruitEmployee(companyId: string, input: RecruitEmployeeRequest): Promise<RecruitEmployeeResult>;
}

export interface CompanyMemberDirectoryApiService {
  loadCompanyMemberDirectory(companyId: string): Promise<CompanyMemberDirectoryResponse>;
}

export type ChatRunCancelResult = {
  companyId: string;
  runId: string;
  status: "cancel_requested" | "canceled" | "not_found";
  canceledCount: number;
};

export interface ChatRunControlApiService {
  cancelChatRun(companyId: string, input: {
    runId: string;
    actor: ChatParticipantIdentitySelector;
    reason?: string;
  }): Promise<ChatRunCancelResult>;
}

export interface RuntimeModelsApiService {
  loadRuntimeModels(): Promise<RuntimeModelsResponse>;
}

export type PromptPolicyTemplateSaveInput = {
  templateId: string;
  content: string;
};

export type PromptPolicyBlockSaveInput = {
  blockPath: string;
  title?: string;
  content: string;
};

export interface PromptPolicyApiService {
  loadPromptPolicy(companyId: string): Promise<PromptPolicyViewModel>;
  savePromptPolicyTemplateContent(companyId: string, input: PromptPolicyTemplateSaveInput): Promise<PromptPolicyViewModel>;
  resetPromptPolicyTemplateToDefault(companyId: string, templateId: string): Promise<PromptPolicyViewModel>;
  savePromptPolicyBlockContent(companyId: string, input: PromptPolicyBlockSaveInput): Promise<PromptPolicyViewModel>;
  resetPromptPolicyBlockToDefault(companyId: string, blockPath: string): Promise<PromptPolicyViewModel>;
  savePromptPolicyConfig?(companyId: string, config: unknown): Promise<PromptPolicyViewModel>;
}

export type AccessPreviewInput = {
  policy: unknown;
  operation: ToolSafetyOperation;
  targetPath?: unknown;
  command?: unknown;
  cwd?: unknown;
};

export type AccessRequestDecision = "allow_once" | "allow_in_context" | "reject";

export type AccessRequestForegroundTarget = {
  kind: "chat-room";
  roomId: string;
  surface: "channel" | "direct";
};

export interface AccessRequestDto {
  id: string;
  status: ApprovalStatus;
  requestedByMemberId: string;
  requestedApproverMemberId?: string;
  requestedAction: string;
  requestedResource?: string;
  reason: string;
  contextKind: ApprovalContextKind;
  contextId: string;
  foregroundTarget?: AccessRequestForegroundTarget;
  sessionKey: string;
  requestedInputSnapshot?: unknown;
  decisionNote?: string;
  resolvedByMemberId?: string;
  createdAt: string;
  updatedAt?: string;
  resolvedAt?: string;
  actions: AccessRequestDecision[];
}

export interface AccessRequestsViewModel {
  schema: "tinyoffice.access-requests";
  version: 1;
  companyId: string;
  requests: AccessRequestDto[];
}

export type ResolveAccessRequestInput = {
  decision: AccessRequestDecision;
  note?: string;
  resolvedByMemberId?: string;
};

export interface ResolveAccessRequestResult {
  request: AccessRequestDto;
  grant?: ApprovalGrant;
}

export type AccessToolCallAction = "read" | "write" | "bash";

export interface AccessToolCallDecisionInput {
  companyId?: string;
  memberId: string;
  action: AccessToolCallAction;
  resource?: string;
  reason: string;
  contextKind: ApprovalContextKind;
  contextId: string;
  sessionKey: string;
  requestedInputSnapshot?: unknown;
}

export type AccessToolCallDecisionResult =
  | { decision: "allow" }
  | { decision: "block"; reason: string; request: AccessRequestDto };

export interface AccessApiService {
  loadAccess(companyId: string): Promise<ToolSafetyViewModel>;
  saveAccessPolicy(companyId: string, policy: unknown): Promise<ToolSafetyViewModel>;
  previewAccessDecision(companyId: string, input: AccessPreviewInput): Promise<ToolSafetyDecisionPreview>;
  listAccessRequests?(companyId: string): Promise<AccessRequestsViewModel>;
  resolveAccessRequest?(companyId: string, approvalId: string, input: ResolveAccessRequestInput): Promise<ResolveAccessRequestResult>;
  decideAccessToolCall?(companyId: string, input: AccessToolCallDecisionInput): Promise<AccessToolCallDecisionResult>;
}

export interface DoctorApiService {
  loadDoctorReport(companyId: string): Promise<TinyOfficeDoctorReport>;
}

export interface UpdateApiService {
  loadStatus(): Promise<TinyOfficeUpdateStatus>;
  startApprovedUpdate(): Promise<TinyOfficeUpdateJob>;
}

export interface ProcessTraceApiService {
  listProcessTraceEvents(companyId: string, input: {
    conversationId?: string;
    messageId?: string;
    sourceMessageId?: string;
    processTraceId?: string;
    sessionKey?: string;
    limit?: number;
  }): Promise<ProcessTraceEvent[]>;
}
