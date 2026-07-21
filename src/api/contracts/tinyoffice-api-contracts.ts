import type {
  ChatChannelMemberDto,
  ChatContainerDto,
  ChatEntryDto,
  ChatOpenTargetDto,
  ChatRuntimeLinkDto,
} from "../../collaboration/contracts/chat-entry-contract.js";
import type {
  CompanyDirectoryDto,
  CompanyDirectoryMemberEntryDto,
} from "../../collaboration/api/company-directory-api-routes.js";
import type {
  ConversationDto,
  ConversationKind,
  ConversationMessageRealtimeEvent,
  ConversationPage,
  ConversationParticipantKind,
  MarkConversationReadResult,
  MessageDto,
  MessagePage,
  SendMessageResult,
} from "../../collaboration/contracts/conversation-message-contract.js";
import type {
  ChatActivityObservedEvent,
  ChatActivityPersistedEvent,
  ChatRuntimeStatus,
  ChatRuntimeStatusChangedEvent,
  TinyOfficeRealtimeEvent,
  TinyOfficeRealtimeEventPayload,
} from "../../collaboration/contracts/tinyoffice-realtime-contract.js";
import type {
  CompaniesAdminViewModel,
  DeleteCompanyResult,
  OwnedCreateCompanyResult,
} from "../../runtime/company-config/companies-admin.js";
import type {
  AvailablePiModel,
  EmployeeAdminRecord,
  EmployeePrivateSkillFile,
  EmployeePrivateSkillsState,
  EmployeeRuntimeConfig,
  EmployeeThinkingLevel,
  EmployeesAdminState,
} from "../../runtime/company-config/employees-admin.js";
import type { PresenceMode } from "../../collaboration/runtime/presence-mode.js";
import type { EmployeeResourcePolicy } from "../../runtime/company-config/resource-policy.js";
import type { RecruitEmployeeResult } from "../../runtime/company-config/recruit-employee.js";
import type {
  EmployeeRuntimeSummaryCard,
  EmployeeRuntimeSummaryCurrentItem,
  EmployeeRuntimeSummaryIssue,
  EmployeeRuntimeSummaryStatusKind,
  EmployeeRuntimeSummaryViewModel,
} from "../../runtime/employee-status/employee-runtime-summary.js";
import type {
  PromptBlocksConfig,
  PromptPolicyBlockViewModel,
  PromptPolicyTemplateId,
  PromptPolicyTemplateViewModel,
  PromptPolicyViewModel,
} from "../../runtime/company-config/prompt-blocks-admin.js";
import type {
  ToolGuardPolicy,
  ToolSafetyCapabilityGroup,
  ToolSafetyDecision,
  ToolSafetyDecisionPreview,
  ToolSafetyOperation,
  ToolSafetyViewModel,
} from "../../runtime/company-config/tool-guard-admin.js";
import type {
  SessionExplorerViewModel,
} from "../../runtime/pi/session-explorer-view-model.js";
import type {
  SessionExplorerActionSummary,
  SessionExplorerConversationTurn,
  SessionExplorerPromptInputPackage,
  SessionExplorerSessionDetail,
  SessionExplorerSessionSummary,
  SessionExplorerUsageTotals,
} from "../../runtime/pi/session-explorer-types.js";
import type { ProcessTraceEvent } from "../../runtime/contracts/process-trace-event.js";
import type {
  TasksAction,
  TasksRunDetail,
  TasksTaskDetail,
  TasksViewModel,
} from "../../work/tasks-view-model.js";

export type {
  ChatChannelMemberDto,
  ChatContainerDto,
  ChatEntryDto,
  ChatOpenTargetDto,
  ChatActivityObservedEvent,
  ChatActivityPersistedEvent,
  ChatRuntimeLinkDto,
  ChatRuntimeStatus,
  ChatRuntimeStatusChangedEvent,
  CompaniesAdminViewModel,
  CompanyDirectoryDto,
  CompanyDirectoryMemberEntryDto,
  ConversationDto,
  ConversationMessageRealtimeEvent,
  ConversationPage,
  DeleteCompanyResult,
  EmployeeAdminRecord,
  EmployeeResourcePolicy,
  EmployeeRuntimeConfig,
  EmployeeRuntimeSummaryCard,
  EmployeeRuntimeSummaryCurrentItem,
  EmployeeRuntimeSummaryIssue,
  EmployeeRuntimeSummaryStatusKind,
  EmployeeRuntimeSummaryViewModel,
  EmployeesAdminState,
  AvailablePiModel,
  EmployeeThinkingLevel,
  MarkConversationReadResult,
  MessageDto,
  MessagePage,
  OwnedCreateCompanyResult,
  PromptBlocksConfig,
  PromptPolicyBlockViewModel,
  PromptPolicyTemplateId,
  PromptPolicyTemplateViewModel,
  PromptPolicyViewModel,
  ProcessTraceEvent,
  RecruitEmployeeResult,
  SendMessageResult,
  SessionExplorerActionSummary,
  SessionExplorerConversationTurn,
  SessionExplorerPromptInputPackage,
  SessionExplorerSessionDetail,
  SessionExplorerSessionSummary,
  SessionExplorerUsageTotals,
  SessionExplorerViewModel,
  TasksAction,
  TasksRunDetail,
  TasksTaskDetail,
  TasksViewModel,
  TinyOfficeRealtimeEvent,
  TinyOfficeRealtimeEventPayload,
  ToolGuardPolicy,
  ToolSafetyCapabilityGroup,
  ToolSafetyDecision,
  ToolSafetyDecisionPreview,
  ToolSafetyOperation,
  ToolSafetyViewModel,
};

export type TinyOfficeContextParams = {
  companyId?: string;
  employeeId?: string;
  memberId?: string;
  conversationId?: string;
  viewer?: TinyOfficeViewerIdentity;
};

export type TinyOfficeCurrentSession = {
  schema: "tinyoffice-current-session";
  version: 2;
  user: {
    id: string;
    displayName?: string;
  };
  currentCompanyId?: string;
  companyId?: string;
  member?: {
    memberId: string;
    displayName?: string;
    role?: string;
  };
  needsProfileInitialization: boolean;
  needsCompanyInitialization: boolean;
};

export type TinyOfficeEmployeeViewerIdentity = {
  kind: "employee";
  employeeId: string;
};

export type TinyOfficeMemberViewerIdentity = {
  kind: "member";
  memberId: string;
  displayName?: string;
  role?: string;
};

export type TinyOfficeViewerIdentity =
  | TinyOfficeEmployeeViewerIdentity
  | TinyOfficeMemberViewerIdentity;

export type CreateConversationRequest = {
  companyId: string;
  title: string;
  conversationKind: ConversationKind;
  participants: Array<{
    participantKind: ConversationParticipantKind;
    memberId: string;
    displayName: string;
    role?: string;
  }>;
};

export type SendConversationMessageRequest = {
  companyId: string;
  conversationId: string;
  actorMemberId?: string;
  body: string;
  attachmentIds?: string[];
};

export type ChatProjectionPage = {
  containers: ChatContainerDto[];
  entries: ChatEntryDto[];
  archivedEntries: ChatEntryDto[];
  nextCursor?: string;
};

export type CreateChatEntryRequest = {
  companyId: string;
  containerId: string;
  actorMemberId?: string;
  actorDisplayName?: string;
  title?: string;
  memberDisplayNames?: Record<string, string>;
  firstMessage: {
    body: string;
    mentionedMemberIds?: string[];
  };
};

export type CreateChatEntryResponse = {
  schema: "chat-create-entry-result";
  version: 1;
  companyId: string;
  container: ChatContainerDto;
  entry: ChatEntryDto;
  openTarget: ChatOpenTargetDto;
  firstMessageId: string;
};

export type CreateChatChannelRequest = {
  companyId: string;
  title: string;
  summary?: string;
  actorMemberId?: string;
  actorDisplayName?: string;
  members?: Array<{
    memberId: string;
    displayName: string;
    hasRuntimeProfile?: boolean;
  }>;
};

export type AddChatChannelMembersRequest = {
  companyId: string;
  chatChannelId: string;
  actorMemberId?: string;
  members: NonNullable<CreateChatChannelRequest["members"]>;
};

export type ChatChannelMemberSelectorRequest = {
  memberId: string;
};

export type RemoveChatChannelMemberRequest = {
  companyId: string;
  chatChannelId: string;
  actorMemberId?: string;
  member: ChatChannelMemberSelectorRequest;
};

export type ChatChannelResponse = {
  schema: "chat-channel";
  version: 1;
  companyId: string;
  chatChannelId: string;
  title: string;
  summary?: string;
  members: ChatChannelMemberDto[];
  createdAt: string;
  updatedAt: string;
};

export type SendChatRoomMessageRequest = {
  companyId: string;
  roomId: string;
  actorMemberId?: string;
  body: string;
  attachmentIds?: string[];
  mentionedMemberIds?: string[];
};

export type MarkChatRoomReadRequest = {
  companyId: string;
  roomId: string;
  viewerMemberId?: string;
  lastReadMessageId?: string;
};

export type SaveMemberRuntimeRequest = {
  companyId: string;
  employee: EmployeeAdminRecord;
};

export type CompanyMemberDirectoryEntry = {
  participantKind: "company_member";
  memberId: string;
  avatarSeed: string;
  displayName: string;
  role?: string;
  summary?: string;
  hasRuntimeProfile: boolean;
};

export type CompanyMemberDirectoryResponse = {
  schema: "company-member-directory";
  version: 1;
  companyId: string;
  members: CompanyMemberDirectoryEntry[];
};

export type RuntimeModelsResponse = {
  schema: "tinyoffice-runtime-models";
  version: 1;
  availableModels: AvailablePiModel[];
  thinkingLevels: EmployeeThinkingLevel[];
};

export type RecruitEmployeeRequest = {
  companyId: string;
  employeeId?: string;
  displayName: string;
  role: string;
  summary: string;
  presenceMode?: PresenceMode;
  runtime: EmployeeRuntimeConfig;
  resourcePolicy?: EmployeeResourcePolicy;
  instructionContent?: string;
};

export type CreateCompanyRequest = {
  companyId?: string;
  displayName: string;
  hrEmployeeDisplayName: string;
  hrRuntime?: {
    version: 1;
    modelProvider?: string;
    modelId?: string;
    thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  };
  systemAiRuntime?: {
    version: 1;
    modelProvider?: string;
    modelId?: string;
  };
};

export type DeleteCompanyRequest = {
  companyId: string;
  confirmationText: string;
};

export type SavePromptPolicyTemplateRequest = {
  companyId: string;
  templateId: PromptPolicyTemplateId;
  content: string;
};

export type SavePromptPolicyBlockRequest = {
  companyId: string;
  path: string;
  title?: string;
  content: string;
};

export type SavePromptPolicyConfigRequest = {
  companyId: string;
  config: PromptBlocksConfig;
};

export type SaveAccessPolicyRequest = {
  companyId: string;
  policy: ToolGuardPolicy;
};

export type PreviewAccessDecisionRequest = {
  companyId: string;
  policy: ToolGuardPolicy;
  operation: ToolSafetyOperation;
  targetPath?: string;
  command?: string;
  cwd?: string;
};

export type MemberRuntimeReloadResult = {
  memberId?: string;
  memberIds?: string[];
  reloadedCount: number;
  sessionKeys: string[];
};

export type EmployeePrivateSkillSaveRequest = {
  companyId: string;
  memberId: string;
  skillId: string;
  content: string;
};

export type {
  EmployeePrivateSkillFile,
  EmployeePrivateSkillsState,
};

export type TinyOfficeRealtimeSubscription = {
  close(): void;
};
