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

export type TinyOfficeMemberViewerIdentity = {
  kind: "member";
  memberId: string;
  displayName?: string;
  role?: string;
};

export type TinyOfficeViewerIdentity = TinyOfficeMemberViewerIdentity;

export type TinyOfficeContextParams = {
  companyId?: string;
  memberId?: string;
  conversationId?: string;
  viewer?: TinyOfficeViewerIdentity;
};

export type RuntimeUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
};

export type {
  TinyOfficeDoctorAction,
  TinyOfficeDoctorCheck,
  TinyOfficeDoctorNextStep,
  TinyOfficeDoctorReport,
  TinyOfficeDoctorSection,
  TinyOfficeDoctorStatus,
} from "../../runtime/doctor/tinyoffice-doctor.js";

export type TinyOfficeRuntimeModelDto = {
  provider: string;
  id: string;
  name: string;
  description?: string;
  input?: string[];
  supportsImageInput?: boolean;
};

export type EmployeeThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type EmployeeRuntimeConfig = {
  version: 1;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel: EmployeeThinkingLevel;
};

export type EmployeeResourcePolicy = {
  version: 1;
  filesystem: {
    ownWorkspace: "allow" | "approval" | "deny";
    otherEmployeeWorkspace: "allow" | "approval" | "deny";
    repo: "allow" | "approval" | "deny";
    secrets: "allow" | "approval" | "deny";
  };
};

export type EmployeeProfile = {
  employeeId: string;
  avatarSeed: string;
  displayName?: string;
  role: string;
  presenceMode: "resident" | "auto_exit_idle";
  sceneProfile?: string;
};

export type EmployeeInstructionFile = {
  location: "employee_home";
  name: string;
  path: string;
  relativePath: string;
  exists: boolean;
  content: string;
  editable: boolean;
};

export type EmployeeLocalAssets = {
  homePath: string;
  workspacePath: string;
  skillPaths: string[];
  instructionFiles: EmployeeInstructionFile[];
};

export type EmployeeAdminRecord = {
  employeeId: string;
  enabled?: boolean;
  profile: EmployeeProfile;
  resourcePolicy: EmployeeResourcePolicy;
  runtime: EmployeeRuntimeConfig;
  localAssets?: EmployeeLocalAssets;
};

export type EmployeesAdminState = {
  employees: EmployeeAdminRecord[];
  availableModels: TinyOfficeRuntimeModelDto[];
  presenceModes: Array<"resident" | "auto_exit_idle">;
  thinkingLevels: EmployeeThinkingLevel[];
};

export type SaveMemberRuntimeRequest = {
  companyId: string;
  employee: EmployeeAdminRecord;
};

export type MemberRuntimeReloadResult = {
  memberId?: string;
  memberIds?: string[];
  reloadedCount: number;
  sessionKeys: string[];
};

export type EmployeePrivateSkillListItem = {
  skillId: string;
  name: string;
  path: string;
  relativePath: string;
  exists: boolean;
};

export type EmployeePrivateSkillsState = {
  schema: "employee-private-skills";
  version: 1;
  companyId: string;
  memberId: string;
  skillsRootPath: string;
  skills: EmployeePrivateSkillListItem[];
};

export type EmployeePrivateSkillFile = EmployeePrivateSkillListItem & {
  schema: "employee-private-skill";
  version: 1;
  companyId: string;
  memberId: string;
  content: string;
  editable: boolean;
};

export type EmployeePrivateSkillSaveRequest = {
  companyId: string;
  memberId: string;
  skillId: string;
  content: string;
};

export type CompanySkillListItem = {
  skillId: string;
  name: string;
  path: string;
  relativePath: string;
  exists: boolean;
};

export type CompanySkillsState = {
  schema: "company-skills";
  version: 1;
  companyId: string;
  skillsRootPath: string;
  skills: CompanySkillListItem[];
};

export type CompanySkillFile = CompanySkillListItem & {
  schema: "company-skill";
  version: 1;
  companyId: string;
  content: string;
  editable: true;
};

export type CapabilityRegistryViewModel = {
  schema: "tinyoffice-capability-registry-view";
  version: 1;
  capabilities: Array<{
    id: string;
    category: string;
    title: string;
    description: string;
    effect: string;
    allowedScenes: string[];
    confirmationPolicy: { required: boolean; mode: string; description?: string };
    useWhen: string;
    inputSchema: unknown;
    outputSchema: unknown;
    notes: string[];
  }>;
};

export type CompanyBrandingState = {
  schema: "tinyoffice-company-branding";
  version: 1;
  companyId: string;
  logoUrl?: string;
};

export type UiLocalePreference = "system" | "en" | "zh-CN";
export type UiThemePreference = "sakura" | "ocean" | "forest" | "violet" | "neutral";
export type UserProfileState = { schema: "tinyoffice-user-profile"; version: 5; id: string; displayName: string; avatarSeed: string; uiLocale: UiLocalePreference; uiTheme: UiThemePreference; initialized: boolean };

export type TinyOfficeUpdateManifest = {
  schema: "tinyoffice-update-manifest";
  version: 1;
  channel: "stable";
  publishedAt: string;
  pi: {
    packageName: "@earendil-works/pi-coding-agent";
    approvedVersion: string;
    minimumNodeVersion: string;
    models: string[];
  };
};

export type TinyOfficeReleaseChannelManifest = {
  schema: "tinyoffice-release-channel";
  version: 1;
  channel: "stable";
  publishedAt: string;
  release: {
    releaseId: string;
    tinyOfficeVersion: string;
    gitCommit: string;
    minimumNodeVersion: string;
    artifact: {
      fileName: string;
      url: string;
      sha256: string;
    };
    notes: string[];
  };
};

export type TinyOfficeReleaseIdentity = {
  releaseId: string;
  tinyOfficeVersion: string;
  gitCommit: string;
};

export type TinyOfficeUpdateStatus = {
  schema: "tinyoffice-update-status";
  version: 2;
  checkedAt: string;
  channel: "stable";
  release: {
    installed: TinyOfficeReleaseIdentity;
    approved?: TinyOfficeReleaseChannelManifest["release"];
    state: "development" | "up_to_date" | "ready_to_install" | "blocked" | "check_failed";
  };
  runtime: {
    nodeVersion: string;
    minimumNodeVersion: string;
    compatible: boolean;
  };
  pi: {
    packageName: "@earendil-works/pi-coding-agent";
    installedVersion: string;
    npmLatestVersion?: string;
    approvedVersion: string;
    state: "up_to_date" | "upstream_available" | "ready_to_install" | "blocked" | "check_failed";
    installedModels: string[];
    approvedModels: string[];
    addedModels: string[];
    removedModels: string[];
  };
  installation: {
    enabled: boolean;
    reason: string;
    requiresBackup: true;
    requiresRestart: true;
  };
  sources: {
    npmRegistry: string;
    approvalManifest: string;
    approvalManifestSource: "remote" | "local";
    releaseManifest: string;
    releaseManifestSource: "remote" | "unavailable";
    warnings: string[];
  };
  job?: TinyOfficeUpdateJob;
};

export type TinyOfficeUpdateJob = {
  schema: "tinyoffice-update-job";
  version: 2;
  jobId: string;
  targetReleaseId: string;
  status: "accepted" | "downloading" | "verifying" | "installing" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  error?: string;
  evidence?: string[];
};

export type EmployeeRuntimeSummaryStatusKind =
  | "needs_approval"
  | "blocked"
  | "working"
  | "idle";

export type EmployeeRuntimeSummaryCurrentItem = {
  kind: string;
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  summary?: string;
  href?: string;
};

export type EmployeeRuntimeSummaryIssue = {
  kind: "blocked-work-run";
  title: string;
  summary: string;
  status: string;
  updatedAt: string;
  target: {
    kind: "work-run" | "work-task" | "session";
    id: string;
    label?: string;
  };
  relatedTarget?: {
    kind: "work-run" | "work-task" | "session";
    id: string;
    label?: string;
  };
};

export type EmployeeRuntimeSummaryCard = {
  employeeId: string;
  displayName: string;
  role: string;
  status: {
    kind: EmployeeRuntimeSummaryStatusKind;
    label: string;
    reason: string;
    updatedAt?: string;
  };
  counts: {
    pendingApprovalCount: number;
    blockedWorkRunCount: number;
    activeWorkRunCount: number;
    activeTaskCount: number;
    recentFailureCount: number;
  };
  current: EmployeeRuntimeSummaryCurrentItem[];
  issues: EmployeeRuntimeSummaryIssue[];
};

export type EmployeeRuntimeSummaryViewModel = {
  contract: {
    name: "employee-runtime-summary";
    version: 1;
    productBoundary: "chat-employee-context-runtime-summary";
  };
  routes: {
    summaryJsonPath: string;
  };
  generatedAt: string;
  employees: EmployeeRuntimeSummaryCard[];
};

export type PromptBlockScene = "dm_thread" | "channel_thread" | "intake_event" | "work_run_execution";
export type PromptPolicyTemplateId = "base-system-prompt" | "runtime-prompt-template";

export type PromptBlocksConfig = {
  version: 1;
  always: string[];
  scenes: Record<PromptBlockScene, string[]>;
};

export type AvailablePromptBlock = {
  path: string;
  title: string;
  sha256: string;
  preview: string;
  content: string;
};

export type PromptPolicyTemplateViewModel = {
  id: PromptPolicyTemplateId;
  label: string;
  description: string;
  content: string;
  defaultContent: string;
  variableHints: string[];
};

export type PromptPolicyBlockUsage = {
  scene: PromptBlockScene;
  label: string;
  source: "runtime_default" | "configured_scene" | "always";
};

export type PromptPolicyBlockViewModel = AvailablePromptBlock & {
  loadedBy: PromptPolicyBlockUsage[];
};

export type PromptPolicyBlockRef = AvailablePromptBlock & {
  mount: "always" | PromptBlockScene;
};

export type PromptPolicySceneViewModel = {
  id: PromptBlockScene;
  label: string;
  purpose: string;
  alwaysBlocks: PromptPolicyBlockRef[];
  sceneBlocks: PromptPolicyBlockRef[];
  effectiveBlockPaths: string[];
  effectivePrompt: string;
};

export type PromptPolicyDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  scene?: PromptBlockScene;
};

export type PromptPolicyViewModel = {
  contract: {
    name: "prompt-policy";
    version: 1;
    boundary: "scene-runtime-contract";
  };
  routes: {
    htmlPath: string;
    viewModelJsonPath: string;
    saveBlockPath: string;
    resetBlockPath: string;
    saveTemplatePath: string;
    resetTemplatePath: string;
  };
  config: PromptBlocksConfig;
  templates: PromptPolicyTemplateViewModel[];
  scenes: PromptPolicySceneViewModel[];
  availableBlocks: PromptPolicyBlockViewModel[];
  diagnostics: {
    errors: PromptPolicyDiagnostic[];
    warnings: PromptPolicyDiagnostic[];
    unmountedBlocks: AvailablePromptBlock[];
  };
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

export type ToolGuardPolicy = {
  version: 1;
  cwdBoundaryReadMode: "allow" | "ask" | "deny";
  cwdBoundaryWriteMode: "allow" | "ask" | "deny";
  sensitivePathPatterns: string[];
  blockedReadPathPatterns: string[];
  protectedWritePathPatterns: string[];
  askReadPathPatterns: string[];
  askWritePathPatterns: string[];
  externalWriteAllowPaths: string[];
  bashDenyPatterns: string[];
  bashAskPatterns: string[];
  bashAllowPatterns: string[];
  denyBashByDefault: boolean;
};

export type ToolSafetyOperation = "read" | "write" | "bash";
export type ToolSafetyDecision = "allow" | "ask" | "deny";
export type ToolSafetyReadPolicyKey = "sensitivePathPatterns" | "blockedReadPathPatterns" | "askReadPathPatterns";
export type ToolSafetyWritePolicyKey = "protectedWritePathPatterns" | "askWritePathPatterns";

export type ToolSafetyResourcePattern = {
  pattern: string;
  readRule: ToolSafetyDecision;
  readPolicyKey?: ToolSafetyReadPolicyKey;
  writeRule: Exclude<ToolSafetyDecision, "deny">;
  writePolicyKey?: ToolSafetyWritePolicyKey;
};

export type ToolSafetyCapabilityGroup = {
  id:
    | "environment-config"
    | "secrets-credentials"
    | "deployment-runtime-config"
    | "generated-dependency-dirs"
    | "dangerous-commands";
  label: string;
  summary: string;
  kind: "resource" | "command";
  examples: string[];
  patterns: string[];
  resourcePatterns?: ToolSafetyResourcePattern[];
  readRule?: ToolSafetyDecision;
  writeRule?: Exclude<ToolSafetyDecision, "deny">;
  commandRule?: ToolSafetyDecision;
  defaultDenyBash?: boolean;
  commandPatterns?: {
    deny: string[];
    ask: string[];
    allow: string[];
  };
  readAskPolicyKey?: "sensitivePathPatterns" | "askReadPathPatterns";
  writeAskPolicyKey?: "protectedWritePathPatterns" | "askWritePathPatterns";
  policyKeys: Array<keyof ToolGuardPolicy>;
};

export type ToolSafetyDecisionPreview = {
  operation: ToolSafetyOperation;
  target: string;
  decision: ToolSafetyDecision;
  matchedPolicy: string;
  reason: string;
};

export type ToolSafetyViewModel = {
  contract: {
    name: "access";
    version: 1;
    boundary: "runtime-access-policy";
  };
  routes: {
    htmlPath: string;
    viewModelJsonPath: string;
    savePolicyPath: string;
    previewPath: string;
  };
  policy: ToolGuardPolicy;
  policyPath: string;
  capabilityGroups: ToolSafetyCapabilityGroup[];
  previewExamples: Array<{
    label: string;
    input: {
      operation: ToolSafetyOperation;
      targetPath?: string;
      command?: string;
    };
    result: ToolSafetyDecisionPreview;
  }>;
  advancedEditor: {
    policyJson: string;
  };
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

export type AccessRequestDecision = "allow_once" | "allow_in_context" | "reject";

export type AccessRequestForegroundTarget = {
  kind: "chat-room";
  roomId: string;
  surface: "channel" | "direct";
};

export type AccessRequestDto = {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired" | "canceled";
  requestedByMemberId: string;
  requestedApproverMemberId?: string;
  requestedAction: string;
  requestedResource?: string;
  reason: string;
  contextKind: "dm_thread" | "channel_topic" | "work_run" | "intake_event";
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
};

export type AccessRequestsViewModel = {
  schema: "tinyoffice.access-requests";
  version: 1;
  companyId: string;
  requests: AccessRequestDto[];
};

export type ResolveAccessRequestRequest = {
  companyId: string;
  approvalId: string;
  decision: AccessRequestDecision;
  note?: string;
  resolvedByMemberId?: string;
};

export type ResolveAccessRequestResult = {
  request: AccessRequestDto;
  grant?: {
    id: string;
    approvalId: string;
    memberId: string;
    action: string;
    resource?: string;
    scope: "one_time" | "session" | "work_run";
    contextKind: AccessRequestDto["contextKind"];
    contextId: string;
    expiresAt?: string;
    consumedAt?: string;
    createdAt: string;
  };
};

export type CompanyLifecycleRecordDto = {
  companyId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
};

export type CompaniesAdminViewModel = {
  contract?: {
    name: "company-lifecycle";
    version: 1;
    boundary: "company-lifecycle";
  };
  routes?: {
    htmlPath: string;
    companiesJsonPath: string;
    createCompanyPath: string;
    deleteCompanyPath: string;
  };
  companies: CompanyLifecycleRecordDto[];
  availableModels?: TinyOfficeRuntimeModelDto[];
  systemAiSettings?: CompanySystemAiSettingDto[];
};

export type CompanySystemAiCapabilityDto = "chat_title_generation" | "chat_topic_summary";

export type CompanySystemAiSettingDto = {
  companyId: string;
  capability: CompanySystemAiCapabilityDto;
  label: string;
  enabled: boolean;
  configured: boolean;
  modelProvider?: string;
  modelId?: string;
  modelRef?: string;
  modelDisplay?: string;
};

export type SaveCompanySystemAiSettingsRequest = {
  companyId: string;
  chatTitleGeneration?: {
    modelProvider?: string;
    modelId?: string;
  };
  chatTopicSummary?: {
    modelProvider?: string;
    modelId?: string;
  };
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

export type UpdateCompanyProfileRequest = {
  companyId: string;
  displayName: string;
};

export type OwnedCreateCompanyResult = {
  company: CompanyLifecycleRecordDto;
  owner?: {
    memberId: string;
    displayName?: string;
    role?: string;
  };
  hr: {
    hrEmployeeId: string;
    hrEmployeeDisplayName: string;
  };
  viewModel: CompaniesAdminViewModel;
};

export type DeleteCompanyRequest = {
  companyId: string;
  confirmationText: string;
};

export type DeleteCompanyResult = {
  companyId: string;
  deletedAssetPath: string;
  viewModel: CompaniesAdminViewModel;
};

export type SwitchCurrentCompanyRequest = {
  companyId: string;
};

export type CompanyDirectoryMemberSelectorDto = {
  kind: "member";
  memberId: string;
};

export type CompanyDirectoryRuntimeCapabilityDto = {
  presenceMode: "resident" | "auto_exit_idle";
  model: {
    provider?: string;
    id?: string;
    thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    input?: string[];
    supportsImageInput?: boolean;
  };
};

export type CompanyDirectoryMemberEntryDto = {
  schema: "company-directory-member-entry";
  version: 1;
  companyId: string;
  memberId: string;
  avatarSeed: string;
  selector: CompanyDirectoryMemberSelectorDto;
  employeeId?: string;
  displayName: string;
  role?: string;
  summary?: string;
  hasRuntimeProfile: boolean;
  runtimeCapability?: CompanyDirectoryRuntimeCapabilityDto;
};

export type CompanyDirectoryDto = {
  schema: "company-directory";
  version: 1;
  companyId: string;
  directoryMembers: CompanyDirectoryMemberEntryDto[];
};

export type ChatChannelMemberDto = {
  schema: "chat-channel-member";
  version: 1;
  companyId: string;
  chatChannelId: string;
  memberId: string;
  avatarSeed?: string;
  displayName: string;
  role?: string;
  hasRuntimeProfile: boolean;
  joinedAt: string;
};

export type ChatRuntimeLinkDto = {
  schema: "chat-runtime-link";
  version: 1;
  companyId: string;
  linkId: string;
  targetKind: "session" | "work_run" | "process_trace" | "session_event" | "attachment";
  targetId: string;
  label?: string;
  sourceMessageId?: string;
  createdAt: string;
};

export type ChatContainerDto = {
  schema: "chat-container";
  version: 1;
  companyId: string;
  containerId: string;
  chatChannelId?: string;
  kind: "channel" | "member_dm";
  title: string;
  summary?: string;
  unreadCount: number;
  mentionCount: number;
  entryCount: number;
  runtimeLinks: ChatRuntimeLinkDto[];
  members?: ChatChannelMemberDto[];
};

export type ChatOpenTargetDto = {
  kind: "topic_room" | "dm_session_entry_room";
  roomId: string;
};

export type ChatEntryDto = {
  schema: "chat-entry";
  version: 1;
  companyId: string;
  entryId: string;
  kind: "channel_topic" | "dm_session_entry";
  parentContainerId: string;
  title: string;
  titleStatus: "placeholder" | "generated" | "manual" | "failed";
  titleSourceMessageId?: string;
  summary?: string;
  unreadCount: number;
  mentionCount: number;
  openTarget: ChatOpenTargetDto;
  runtimeLinks: ChatRuntimeLinkDto[];
  updatedAt: string;
};

export type ChatProjectionPage = {
  containers: ChatContainerDto[];
  entries: ChatEntryDto[];
  archivedEntries?: ChatEntryDto[];
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
    attachmentIds?: string[];
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

export type ChatChannelResponse = {
  companyId: string;
  chatChannelId: string;
  title: string;
  summary?: string;
  members: ChatChannelMemberDto[];
  createdAt: string;
  updatedAt: string;
};

export type ChatChannelMemberInput = {
  memberId: string;
  displayName: string;
  hasRuntimeProfile?: boolean;
};

export type UpdateChatChannelDetailsRequest = {
  companyId: string;
  chatChannelId: string;
  actorMemberId?: string;
  title: string;
  summary?: string;
};

export type CreateChatChannelRequest = {
  companyId: string;
  actorMemberId?: string;
  actorDisplayName?: string;
  title: string;
  summary?: string;
  members: ChatChannelMemberInput[];
};

export type AddChatChannelMembersRequest = {
  companyId: string;
  chatChannelId: string;
  actorMemberId?: string;
  members: ChatChannelMemberInput[];
};

export type RemoveChatChannelMemberRequest = {
  companyId: string;
  chatChannelId: string;
  actorMemberId?: string;
  member: {
    memberId: string;
  };
};

export type DissolveChatChannelRequest = {
  companyId: string;
  chatChannelId: string;
  actorMemberId?: string;
  confirmation: "DELETE";
};

export type DissolveChatChannelResponse = {
  companyId: string;
  chatChannelId: string;
  dissolved: true;
};

export type ConversationParticipantDto = {
  schema: "conversation-participant";
  version: 1;
  companyId: string;
  conversationId: string;
  participantId: string;
  participantKind: "company_member" | "system";
  memberId: string;
  displayName: string;
  role?: string;
  joinedAt: string;
  leftAt?: string;
};

export type ConversationAttachmentDto = {
  schema: "conversation-attachment";
  version: 1;
  companyId: string;
  conversationId: string;
  messageId: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
  downloadUrl?: string;
  previewUrl?: string;
  storageKey?: string;
  contentSha256?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ChatAttachmentDto = {
  schema: "chat-attachment";
  version: 1;
  companyId: string;
  attachmentId: string;
  ownerMemberId: string;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
  storageKey: string;
  contentSha256: string;
  previewUrl: string;
  downloadUrl: string;
  createdAt: string;
};

export type ChatAttachmentUploadResponse = {
  attachment: ChatAttachmentDto;
};

export type ConversationRuntimeLinkDto = {
  schema: "conversation-runtime-link";
  version: 1;
  companyId: string;
  conversationId: string;
  linkId: string;
  targetKind: "session" | "work_run" | "process_trace" | "session_event";
  targetId: string;
  label?: string;
  messageId?: string;
  sourceMessageId?: string;
  createdAt: string;
};

export type MessageMentionDto = {
  schema: "message-mention";
  version: 1;
  companyId: string;
  conversationId: string;
  messageId: string;
  participantId: string;
  memberId: string;
  createdAt: string;
};

export type MessageSenderDto = {
  participantId: string;
  participantKind: "company_member" | "system";
  memberId: string;
  displayName: string;
};

export type MessageDto = {
  schema: "message";
  version: 1;
  companyId: string;
  conversationId: string;
  messageId: string;
  sender: MessageSenderDto;
  body: string;
  mentions: MessageMentionDto[];
  attachments: ConversationAttachmentDto[];
  runtimeLinks: ConversationRuntimeLinkDto[];
  runtimeUsage?: RuntimeUsageTotals;
  createdAt: string;
  updatedAt?: string;
  deliveryState: "pending" | "sent" | "failed" | "deleted";
};

export type MessagePage = {
  messages: MessageDto[];
  nextCursor?: string;
};

export type SessionExplorerEvidenceLinkKind =
  | "session"
  | "work_run"
  | "process_trace";

export type SessionExplorerEvidenceLink = {
  kind: SessionExplorerEvidenceLinkKind;
  label: string;
  targetId: string;
  href?: string;
};

export type SessionExplorerChatReturnTarget = {
  surface: "direct" | "channel";
  conversationId: string;
};

export type SessionExplorerSessionSummary = {
  employeeId: string;
  displayName: string;
  role: string;
  sessionId: string;
  sessionDirPath: string;
  cwd?: string;
  sessionKey?: string;
  sceneType?: string;
  requesterUsername?: string;
  startedAt?: string;
  lastActivityAt?: string;
  transcriptFileCount: number;
  eventCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  tokenInputTotal: number;
  tokenOutputTotal: number;
  tokenCacheTotal: number;
  modelProvider?: string;
  modelId?: string;
  lastUserMessagePreview?: string;
  lastAssistantMessagePreview?: string;
  chatReturnTarget?: SessionExplorerChatReturnTarget;
  evidenceLinks: SessionExplorerEvidenceLink[];
};

export type SessionExplorerMessageEvent = {
  index: number;
  timestamp?: string;
  eventType: string;
  role?: string;
  text: string;
  fileName: string;
};

export type SessionExplorerUsageTotals = RuntimeUsageTotals;

export type SessionExplorerSessionOverview = {
  status: string;
  surface: string;
  turns: number;
  messages: {
    user: number;
    employee: number;
  };
  modelCalls: number;
  tools: number;
  usage: SessionExplorerUsageTotals;
  startedAt?: string;
  lastActivityAt?: string;
  requester?: string;
  model?: string;
  cwd?: string;
};

export type SessionExplorerConversationTurn = {
  index: number;
  turnId: string;
  startedAt?: string;
  completedAt?: string;
  modelCallId?: string;
  userMessage?: {
    timestamp?: string;
    text: string;
  };
  employeeReply?: {
    timestamp?: string;
    text: string;
  };
  usage: SessionExplorerUsageTotals;
  toolCalls: Array<{
    name: string;
    summary: string;
  }>;
};

export type SessionExplorerPromptInputPackage = {
  turnId?: string;
  modelCallId?: string;
  createdAt?: string;
  employeeId: string;
  sessionKey?: string;
  sceneType?: string;
  systemPrompt: string;
  runtimePrompt: string;
  runtimeContext: string;
  contextBlocks: Array<{
    role: string;
    source: string;
    label: string;
    text: string;
  }>;
  triggerMessage: string;
  userMessage: string;
  promptBlocks: Array<{
    id: string;
    sha256?: string;
    content?: string;
  }>;
  employeeInstructions: Array<{
    path: string;
    sha256?: string;
    content?: string;
  }>;
  tools: string[];
  skills: string[];
  cacheEvidence: {
    fullInputSha256?: string;
    stablePrefixSha256?: string;
    estimatedStablePrefixChars?: number;
  };
};

export type RuntimeActivityKind =
  | "run_started"
  | "thinking"
  | "provider_retry"
  | "handoff"
  | "tool_call"
  | "tool_result"
  | "run_completed"
  | "failure";

export type RuntimeActivityPrimary = {
  toolName?: string;
  arguments?: unknown;
  targetMemberId?: string;
  replyMessageId?: string;
};

export type RuntimeActivityRawEvent = {
  id: string;
  timestamp: string;
  kind: string;
  sessionKey: string;
  workTaskId?: string;
  workRunId?: string;
  channelId?: string;
  channelTopicId?: string;
  employeeId?: string;
  title: string;
  summary?: string;
  preview?: string;
  status?: "running" | "succeeded" | "failed" | "canceled" | "skipped";
  metadata?: Record<string, unknown>;
};

export type RuntimeActivityRawDetails = {
  eventIds: string[];
  events: RuntimeActivityRawEvent[];
};

export type RuntimeActivityItem = {
  id: string;
  kind: RuntimeActivityKind;
  title: string;
  details?: string;
  status?: "running" | "succeeded" | "failed" | "canceled" | "skipped";
  timestamp?: string;
  primary?: RuntimeActivityPrimary;
  raw: RuntimeActivityRawDetails;
};

export type RuntimeActivity = {
  items: RuntimeActivityItem[];
};

export type ChatRoomActivityPage = RuntimeActivity;

export type SessionExplorerRuntimeActivityItem = RuntimeActivityItem;

export type SessionExplorerRuntimeTurn = {
  index: number;
  turnId: string;
  startedAt?: string;
  completedAt?: string;
  modelCallId?: string;
  usage: SessionExplorerUsageTotals;
  triggerMessage?: {
    label: string;
    timestamp?: string;
    text: string;
    source?: string;
  };
  inputPackage?: SessionExplorerPromptInputPackage;
  activity: {
    items: SessionExplorerRuntimeActivityItem[];
  };
  outputMessage?: {
    label: string;
    timestamp?: string;
    text: string;
    source?: string;
  };
};

export type SessionExplorerWorkDone = {
  toolCalls: Array<{
    name: string;
    summary: string;
    timestamp?: string;
  }>;
  toolResults: Array<{
    name: string;
    summary: string;
    timestamp?: string;
  }>;
  actions: string[];
  artifacts: string[];
};

export type SessionExplorerUsage = {
  total: SessionExplorerUsageTotals;
  byTurn: Array<{
    turnId: string;
    modelCallId?: string;
    usage: SessionExplorerUsageTotals;
  }>;
};

export type SessionExplorerRawEvidence = {
  sessionEventCount: number;
  processTraceEventCount: number;
  collaborationActionEventCount: number;
  rawEventCount: number;
  sources: string[];
  diagnostics: string[];
};

export type SessionExplorerTranscriptDirection =
  | "sent_to_ai"
  | "received_from_ai"
  | "tool_call"
  | "tool_result"
  | "collaboration_action"
  | "runtime"
  | "debug";

export type SessionExplorerAiCallTranscriptEntry = {
  index: number;
  timestamp?: string;
  direction: SessionExplorerTranscriptDirection;
  label: string;
  eventType: string;
  role?: string;
  text: string;
  source: "session_events" | "process_trace_events" | "collaboration_action_events";
  complete: boolean;
};

export type SessionExplorerAiCallTranscriptTurn = {
  index: number;
  title: string;
  startedAt?: string;
  entries: SessionExplorerAiCallTranscriptEntry[];
};

export type SessionExplorerAiCallTranscript = {
  turns: SessionExplorerAiCallTranscriptTurn[];
  rawEventCount: number;
};

export type SessionExplorerActionSummary = {
  items: string[];
  sourceEventCount: number;
};

export type SessionExplorerSessionDetail = {
  summary: SessionExplorerSessionSummary;
  overview: SessionExplorerSessionOverview;
  runtimeTurns: SessionExplorerRuntimeTurn[];
  conversationTurns: SessionExplorerConversationTurn[];
  promptInputPackages: SessionExplorerPromptInputPackage[];
  workDone: SessionExplorerWorkDone;
  usage: SessionExplorerUsage;
  rawEvidence: SessionExplorerRawEvidence;
  transcriptFiles: string[];
  events: SessionExplorerMessageEvent[];
  aiCallTranscript: SessionExplorerAiCallTranscript;
  runtimeInspection: Record<string, unknown>;
  actionSummary: SessionExplorerActionSummary;
};

export type SessionExplorerListMode = "flat" | "employee_grouped";

export type SessionExplorerDetailSectionId =
  | "session-overview"
  | "runtime-turns"
  | "evidence-package";

export type SessionExplorerDetailSection = {
  id: SessionExplorerDetailSectionId;
  title: string;
  defaultOpen: boolean;
  factLayer: boolean;
};

export type SessionExplorerEmployeeFilterOption = {
  employeeId: string;
  displayName: string;
  count: number;
};

export type SessionExplorerViewModel = {
  contract: {
    name: "session-explorer";
    version: 1;
    runtimeBoundary: "runtime-session-inspector";
  };
  routes: {
    indexJsonPath: string;
    detailJsonPath: string;
    viewModelJsonPath: string;
  };
  refresh: {
    strategy: "runtime-events";
    snapshotUses: Array<"initial-load" | "manual-refresh" | "reconnect-reconciliation">;
    eventSources: Array<"session" | "employee" | "process_trace">;
    expectsRunningSessions: boolean;
    expectsIncrementalDetailEvents: boolean;
  };
  filters: {
    query: string;
    employeeIdFilter: string;
  };
  index: {
    generatedAt: string;
    employeeCount: number;
    sessionCount: number;
    sessions: SessionExplorerSessionSummary[];
  };
  selectedSession: {
    employeeId: string;
    sessionId: string;
  } | null;
  list: {
    mode: SessionExplorerListMode;
    sessions: SessionExplorerSessionSummary[];
    queryMatchedSessionCount: number;
    employeeFilters: SessionExplorerEmployeeFilterOption[];
    selectedKey?: string;
  };
  sections: SessionExplorerDetailSection[];
  detail?: SessionExplorerSessionDetail & {
    sections: SessionExplorerDetailSection[];
  };
};

export type TasksViewMode = "tasks";
export type TasksRunStatus = "queued" | "in_progress" | "blocked" | "failed" | "done" | "canceled";
export type TasksTaskStatus = "active" | "completed" | "canceled" | "archived";
export type TasksScheduleStatus = "enabled" | "paused" | "completed" | "canceled";
export type TasksStatusFilter = "all" | TasksTaskStatus;
export type TasksSortMode = "recent" | "severity" | "status" | "owner";

export type TasksSourceLink = {
  kind: "conversation-message" | "conversation" | "chat-entry" | "intake-event" | "manual-source";
  href: string;
  label: string;
  sourceId?: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
};

export type TasksEvidenceLink = {
  kind: "work-run" | "session" | "process-trace";
  href: string;
  label: string;
  targetId: string;
  workRunId?: string;
  sessionId?: string;
  processTraceId?: string;
};

export type TasksAction = {
  id: "retry-dispatch" | "retry-run" | "cancel-run";
  label: string;
  method: "post";
  path: string;
  enabled: boolean;
  reason?: string;
};

export type TasksTimelineEntry = {
  kind: "event" | "trace" | "lease";
  timestamp: string;
  title: string;
  summary?: string;
  status?: string;
  targetId?: string;
  href?: string;
};

export type TasksRunDetailSection = {
  id: "execution" | "objective" | "outcome" | "activity";
  title: string;
  summary: string;
  items: Array<[label: string, value: string]>;
};

export type TasksUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  sourceSessionId: string;
};

export type TasksTaskListItem = {
  id: string;
  title: string;
  status: TasksTaskStatus;
  ownerMemberId: string;
  ownerDisplayName?: string;
  ownerAvatarSeed?: string;
  requesterMemberId?: string;
  sourceKind: "chat_request" | "intake_event" | "manual";
  updatedAt: string;
  acceptanceCriteria: string;
  revision: number;
  nextStep: string;
  sourceLink?: TasksSourceLink;
  schedule: TasksTaskScheduleSummary;
  executionCount: number;
  latestExecution?: TasksRunListItem;
};

export type TasksTaskScheduleSummary = {
  kind: "none" | "immediate" | "scheduled_once" | "recurring";
  status?: TasksScheduleStatus;
  nextRunAt?: string;
  lastRunAt?: string;
  timezone?: string;
  ruleSummary?: string;
  runCount: number;
  maxRuns?: number;
};

export type TasksScheduleListItem = {
  id: string;
  workTaskId: string;
  title: string;
  status: TasksScheduleStatus;
  ownerMemberId?: string;
  kind: "immediate" | "scheduled_once" | "recurring";
  nextRunAt?: string;
  lastRunAt?: string;
  updatedAt: string;
  runCount: number;
  maxRuns?: number;
  timezone?: string;
  nextStep: string;
  task?: TasksTaskListItem;
};

export type TasksRunListItem = {
  id: string;
  workTaskId: string;
  title: string;
  status: TasksRunStatus;
  assigneeMemberId: string;
  taskRevision: number;
  sourceKind: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  nextStep: string;
  needsParticipantInput: boolean;
  actions: TasksAction[];
  sourceLink?: TasksSourceLink;
};

export type TasksTaskDetail = TasksTaskListItem & {
  description?: string;
  canceledReason?: string;
  scheduleRecord?: TasksScheduleListItem;
  executions: TasksRunListItem[];
  revisions: Array<{
    revision: number;
    title: string;
    description?: string;
    acceptanceCriteria: string;
    changedByMemberId: string;
    reason: string;
    sourceWorkRunId?: string;
    createdAt: string;
  }>;
};

export type TasksScheduleDetail = TasksScheduleListItem & {
  pausedReason?: string;
  canceledReason?: string;
  scheduleRule?: Record<string, unknown>;
};

export type TasksRunDetail = TasksRunListItem & {
  task?: TasksTaskListItem;
  schedule?: TasksScheduleListItem;
  blockedReason?: string;
  failedReason?: string;
  canceledReason?: string;
  resultSummary?: string;
  actions: TasksAction[];
  participantInput: {
    required: boolean;
    reason?: string;
  };
  evidenceLinks: TasksEvidenceLink[];
  usageSummary?: TasksUsageSummary;
  timeline: TasksTimelineEntry[];
  detailSections: TasksRunDetailSection[];
};

export type TasksViewModel = {
  contract: {
    name: "tasks";
    version: 3;
    productBoundary: "task-aggregate";
  };
  routes: {
    htmlPath: string;
    viewModelJsonPath: string;
  };
  refresh: {
    indexIntervalMs: number;
    detailIntervalMs: number;
  };
  filters: {
    view: TasksViewMode;
    status: TasksStatusFilter;
    sort: TasksSortMode;
    owner?: string;
    selectedWorkTaskId?: string;
  };
  statusOptions: Array<{
    id: TasksStatusFilter;
    label: string;
    count: number;
  }>;
  sortOptions: Array<{
    id: TasksSortMode;
    label: string;
  }>;
  summary: {
    runningRunCount: number;
    blockedRunCount: number;
    dispatchFailedCount: number;
    activeTaskCount: number;
    enabledScheduleCount: number;
    participantInputCount: number;
  };
  tasks: TasksTaskListItem[];
  selected:
    | { kind: "task"; task: TasksTaskDetail }
    | { kind: undefined };
  recentOperatingEvents: Array<{
    id: string;
    timestamp: string;
    level: string;
    message: string;
    metadata?: Record<string, unknown>;
  }>;
};

export type TasksRunActionResult = {
  accepted: true;
  actionId: TasksAction["id"];
  workRunId: string;
  status: TasksRunStatus;
  message: string;
};

export type McpServerView = {
  serverId: string;
  displayName: string;
  transport: "stdio" | "streamable_http";
  command?: string;
  args: string[];
  url?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type McpConnectionView = {
  connectionId: string;
  serverId: string;
  displayName: string;
  envRefs: Record<string, string>;
  headerRefs: Record<string, string>;
  resolvedEnvironment: Record<string, boolean>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type McpAssignmentView = {
  companyId: string;
  assignmentId: string;
  connectionId: string;
  scopeKind: "company" | "employee";
  memberId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type McpAdminView = {
  schema: "tinyoffice-mcp-admin";
  version: 1;
  companyId: string;
  servers: McpServerView[];
  connections: McpConnectionView[];
  assignments: McpAssignmentView[];
};
