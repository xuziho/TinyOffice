import { loadCompanyDirectoryApiSnapshot } from "../../collaboration/api/company-directory-api-routes.js";
import { publishToRegisteredTinyOfficeRealtimePublishers } from "../../collaboration/contracts/tinyoffice-realtime-publisher-registry.js";
import { projectCompanyMemberDirectoryEntries } from "../../api/tinyoffice-api/member-directory-view.js";
import { ChannelService, type ChannelMemberInput } from "../../collaboration/channel/channel-service.js";
import { PostgresChannelRepository } from "../../collaboration/channel/postgres-channel-repository.js";
import type { PresenceMode } from "../../collaboration/runtime/presence-mode.js";
import {
  EMPLOYEE_THINKING_LEVELS,
  loadPiModelState,
} from "../company-config/employees-admin.js";
import type { EmployeeRuntimeConfig, EmployeeThinkingLevel } from "../company-config/employees-admin.js";
import { normalizeCompanyId } from "../company-config/company-paths.js";
import { recruitEmployee } from "../company-config/recruit-employee.js";
import { normalizeResourcePolicy, type EmployeeResourcePolicy } from "../company-config/resource-policy.js";
import { WorkService, type CreateWorkInput } from "../../work/work-service.js";
import { WorkCancellationService } from "../../work/work-cancellation-service.js";
import type { WorkTaskStatus, WorkTriggerKind } from "../../work/domain.js";
import { getCapabilityEntry, type CapabilityEntry, type CapabilityScene } from "./capability-registry.js";
import {
  describeWorkTaskForCapability,
  listWorkTasksForCapability,
  type WorkCapabilityListScope,
} from "./work-capability-projection.js";
import {
  describeSkillForCapability,
  listSkillsForCapability,
  mutateSkillForCapability,
} from "./skill-capability-service.js";
import { McpRuntimeGateway } from "../../mcp/mcp-runtime-gateway.js";
import { McpAdminService } from "../../mcp/mcp-admin-service.js";

export interface TinyOfficeCapabilityCallToolInput {
  repoRoot: string;
  companyId?: string;
  capabilityId: unknown;
  input?: unknown;
  confirmation?: unknown;
  actorMemberId?: string;
  runtimeEmployeeId?: string;
  channelTopicId?: string;
  workRunId?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
  sessionKey?: string;
  signal?: AbortSignal;
}

export interface TinyOfficeCapabilityCallToolResult {
  status: "allowed";
  capabilityId: string;
  result: unknown;
}

interface NormalizedCapabilityCall {
  companyId?: string;
  body: Record<string, unknown>;
  entry: CapabilityEntry;
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredCapabilityActorMemberId(input: TinyOfficeCapabilityCallToolInput): string {
  return requiredString(input.actorMemberId || input.runtimeEmployeeId, "actorMemberId");
}

function normalizeTriggerKind(value: unknown): WorkTriggerKind {
  const kind = requiredString(value, "trigger.kind");
  if (kind !== "immediate" && kind !== "scheduled_once" && kind !== "recurring") {
    throw new Error("trigger.kind must be immediate, scheduled_once, or recurring.");
  }
  return kind;
}

function optionalPositiveNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return value;
}

function workTrigger(value: unknown): CreateWorkInput["trigger"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("trigger must be a JSON object.");
  }
  const trigger = value as Record<string, unknown>;
  const kind = normalizeTriggerKind(trigger.kind);
  const scheduledFor = optionalString(trigger.scheduledFor);
  const intervalMs = optionalPositiveNumber(trigger.intervalMs, "trigger.intervalMs");
  if (kind === "scheduled_once" && !scheduledFor) {
    throw new Error("trigger.scheduledFor is required for scheduled_once Work.");
  }
  if (kind === "recurring" && (!scheduledFor || !intervalMs)) {
    throw new Error("trigger.scheduledFor and trigger.intervalMs are required for recurring Work.");
  }
  return {
    kind,
    ...(scheduledFor ? { scheduledFor } : {}),
    ...(optionalString(trigger.timezone) ? { timezone: optionalString(trigger.timezone) } : {}),
    ...(intervalMs ? { intervalMs } : {}),
    ...(optionalString(trigger.cron) ? { cron: optionalString(trigger.cron) } : {}),
  };
}

function rejectAiChannelMemberDerivedField(member: Record<string, unknown>, fieldName: string, index: number): void {
  if (member[fieldName] !== undefined) {
    throw new Error(`members[${index}].${fieldName} is system-derived; pass only memberId.`);
  }
}

function channelMemberSelectors(value: unknown): Array<Pick<ChannelMemberInput, "memberId">> {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("members must be an array.");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`members[${index}] must be a JSON object.`);
    }
    const member = item as Record<string, unknown>;
    const memberId = optionalString(member.memberId);
    if (optionalString(member.employeeId)) {
      throw new Error(`members[${index}].memberId is required; employeeId is not accepted.`);
    }
    if (!memberId) {
      throw new Error(`members[${index}] requires memberId.`);
    }
    rejectAiChannelMemberDerivedField(member, "displayName", index);
    rejectAiChannelMemberDerivedField(member, "hasRuntimeProfile", index);
    return { memberId };
  });
}

function channelDirectoryMemberBySelector(
  members: ReturnType<typeof projectCompanyMemberDirectoryEntries>,
  selector: Pick<ChannelMemberInput, "memberId">,
): ChannelMemberInput {
  const memberId = requiredString(selector.memberId, "memberId");
  const member = members.find((candidate) =>
    candidate.memberId === memberId
  );
  if (!member) {
    throw new Error(`Channel company member not found in company member directory: ${memberId}`);
  }
  return {
    memberId: requiredString(member.memberId, "memberId"),
    displayName: member.displayName,
    hasRuntimeProfile: member.hasRuntimeProfile,
  };
}

async function channelMembersFromDirectory(input: {
  repoRoot: string;
  companyId: string;
  selectors: Array<Pick<ChannelMemberInput, "memberId">>;
}): Promise<ChannelMemberInput[]> {
  const directory = await loadCompanyDirectoryApiSnapshot(input.repoRoot, { companyId: input.companyId });
  const members = projectCompanyMemberDirectoryEntries(directory.directoryMembers);
  return input.selectors.map((selector) => channelDirectoryMemberBySelector(members, selector));
}

function optionalPresenceMode(value: unknown): PresenceMode | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === "resident" || value === "auto_exit_idle") {
    return value;
  }
  throw new Error("presenceMode must be resident or auto_exit_idle.");
}

function runtimeConfig(value: unknown): EmployeeRuntimeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("runtime must be a JSON object.");
  }
  const candidate = value as Partial<EmployeeRuntimeConfig>;
  if (candidate.version !== undefined && candidate.version !== 1) {
    throw new Error("runtime.version must be 1.");
  }
  if (typeof candidate.modelProvider !== "string" || !candidate.modelProvider.trim()) {
    throw new Error("runtime.modelProvider is required.");
  }
  if (typeof candidate.modelId !== "string" || !candidate.modelId.trim()) {
    throw new Error("runtime.modelId is required.");
  }
  const thinkingLevels = new Set<EmployeeThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
  if (!thinkingLevels.has(candidate.thinkingLevel as EmployeeThinkingLevel)) {
    throw new Error("runtime.thinkingLevel is invalid.");
  }
  return {
    version: 1,
    modelProvider: candidate.modelProvider.trim(),
    modelId: candidate.modelId.trim(),
    thinkingLevel: candidate.thinkingLevel as EmployeeThinkingLevel,
  };
}

function optionalResourcePolicy(value: unknown): EmployeeResourcePolicy | undefined {
  return value === undefined || value === null ? undefined : normalizeResourcePolicy(value);
}

function normalizeCapabilityCompany(input: {
  contextCompanyId?: string;
  body: Record<string, unknown>;
}): string | undefined {
  const normalizedContextCompanyId = input.contextCompanyId
    ? normalizeCompanyId(input.contextCompanyId)
    : undefined;
  const bodyCompanyId = typeof input.body.companyId === "string"
    ? normalizeCompanyId(input.body.companyId)
    : undefined;
  const companyId = bodyCompanyId || normalizedContextCompanyId;
  if (normalizedContextCompanyId && bodyCompanyId && bodyCompanyId !== normalizedContextCompanyId) {
    throw new Error("tinyoffice_capability_call companyId mismatch.");
  }
  return companyId;
}

function memberProfileForCapability(
  member: Awaited<ReturnType<typeof loadCompanyDirectoryApiSnapshot>>["directoryMembers"][number],
) {
  return {
    participantKind: "company_member",
    memberId: member.memberId,
    displayName: member.displayName,
    ...(member.role ? { role: member.role } : {}),
    ...(member.summary ? { summary: member.summary } : {}),
    hasRuntimeProfile: member.hasRuntimeProfile,
    ...(member.runtimeCapability ? {
      runtime: {
        presenceMode: member.runtimeCapability.presenceMode,
        supportsImageInput: member.runtimeCapability.model.supportsImageInput ?? false,
        input: member.runtimeCapability.model.input ?? [],
      },
    } : {}),
  };
}

async function loadDirectoryMemberProfile(input: {
  repoRoot: string;
  companyId: string;
  memberId: string;
}) {
  const directory = await loadCompanyDirectoryApiSnapshot(input.repoRoot, { companyId: input.companyId });
  const member = directory.directoryMembers.find((candidate) => candidate.memberId === input.memberId);
  if (!member) {
    throw new Error(`member.profile.describe member not found: ${input.memberId}`);
  }
  return memberProfileForCapability(member);
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }
  return value;
}

function optionalLimit(value: unknown, fieldName: string, fallback: number, max: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return Math.min(value, max);
}

function optionalWorkListScope(value: unknown): WorkCapabilityListScope {
  if (value === undefined || value === null || value === "") {
    return "mine";
  }
  if (value === "mine" || value === "company") {
    return value;
  }
  throw new Error("scope must be mine or company.");
}

function optionalWorkTaskStatus(value: unknown): WorkTaskStatus | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "active" || value === "completed" || value === "canceled" || value === "archived") {
    return value;
  }
  throw new Error("status must be active, completed, canceled, or archived.");
}

function confirmationObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function assertCapabilityConfirmation(entry: CapabilityEntry, confirmation: unknown): void {
  if (!entry.confirmationPolicy.required) {
    return;
  }
  const candidate = confirmationObject(confirmation);
  if (candidate.accepted !== true) {
    throw new Error(`tinyoffice_capability_call ${entry.id} requires operator confirmation.`);
  }
  if (
    entry.confirmationPolicy.mode === "typed" &&
    requiredString(candidate.typedText, "confirmation.typedText") !== entry.confirmationPolicy.typedText
  ) {
    throw new Error(`tinyoffice_capability_call ${entry.id} confirmation must be ${entry.confirmationPolicy.typedText}.`);
  }
}

function normalizeCapabilityCall(input: TinyOfficeCapabilityCallToolInput): NormalizedCapabilityCall {
  const capabilityId = requiredString(input.capabilityId, "capabilityId");
  const entry = getCapabilityEntry(capabilityId);
  if (!entry) {
    throw new Error(`tinyoffice_capability_call ${capabilityId} is not registered in the capability registry.`);
  }
  assertCapabilityConfirmation(entry, input.confirmation);
  const body = objectBody(input.input);
  const companyId = normalizeCapabilityCompany({
    contextCompanyId: input.companyId,
    body,
  });
  return {
    ...(companyId ? { companyId } : {}),
    body: {
      ...body,
      ...(companyId ? { companyId } : {}),
    },
    entry,
  };
}

function runtimeSceneFromInput(input: TinyOfficeCapabilityCallToolInput): CapabilityScene | undefined {
  if (optionalString(input.workRunId)) {
    return "work_run";
  }
  if (optionalString(input.channelTopicId)) {
    return "chat_channel";
  }
  if (
    optionalString(input.conversationId) ||
    optionalString(input.threadId) ||
    optionalString(input.roomId) ||
    optionalString(input.messageId) ||
    optionalString(input.chatEntryId)
  ) {
    return "chat_dm";
  }
  return undefined;
}

function assertAllowedRuntimeScene(input: TinyOfficeCapabilityCallToolInput, entry: CapabilityEntry): void {
  const scene = runtimeSceneFromInput(input);
  if (scene && !entry.allowedScenes.includes(scene)) {
    throw new Error(`tinyoffice_capability_call ${entry.id} is not allowed in ${scene} scene.`);
  }
}

export async function executeTinyOfficeCapabilityCallTool(
  input: TinyOfficeCapabilityCallToolInput,
): Promise<TinyOfficeCapabilityCallToolResult> {
  const request = normalizeCapabilityCall(input);
  assertAllowedRuntimeScene(input, request.entry);
  let result: unknown;

  if (request.entry.id === "company.member.directory.list") {
    if (!request.companyId) {
      throw new Error("company.member.directory.list requires companyId.");
    }
    const directory = await loadCompanyDirectoryApiSnapshot(input.repoRoot, { companyId: request.companyId });
    result = {
      schema: "company-member-directory",
      version: 1,
      companyId: request.companyId,
      members: projectCompanyMemberDirectoryEntries(directory.directoryMembers),
    };
  } else if (request.entry.id === "runtime.models.list") {
    const modelState = await loadPiModelState();
    result = {
      schema: "tinyoffice-runtime-models",
      version: 1,
      availableModels: modelState.availableModels,
      thinkingLevels: EMPLOYEE_THINKING_LEVELS,
    };
  } else if (request.entry.id === "intake.integration.describe") {
    if (!request.companyId) {
      throw new Error("intake.integration.describe requires companyId.");
    }
    result = {
      schema: "tinyoffice-intake-integration-contract",
      version: 1,
      companyId: request.companyId,
      method: "POST",
      endpointPath: `/api/companies/${encodeURIComponent(request.companyId)}/intake/events`,
      contentType: "application/json",
      targetSelectionCapabilityId: "company.member.directory.list",
      requestContract: {
        required: ["schemaVersion", "source", "sourceEventId", "category", "routing", "summary", "payload"],
        routing: { required: ["targetMemberId"] },
        priorityValues: ["low", "normal", "high", "urgent"],
        example: {
          schemaVersion: "2026-07-09",
          source: "external-system",
          sourceEventId: "stable-source-event-id",
          category: "external.signal",
          routing: { targetMemberId: "member-id-from-directory" },
          priority: "normal",
          summary: "What happened and why it matters.",
          payload: { key: "source-specific data" },
        },
      },
      idempotency: {
        keyFields: ["category", "source", "sourceEventId"],
        retryRule: "Reuse the same key fields when retrying the same external event.",
      },
      acceptedResponse: {
        status: 202,
        receiptFields: ["eventId", "status", "duplicate", "result"],
      },
      implementationGuidance: [
        "Resolve the target employee through company.member.directory.list; do not guess member ids.",
        "Treat non-2xx responses as failed delivery and preserve the idempotency fields on retry.",
        "Do not automatically turn every external event into a Task; the target employee triages it through the Intake scene.",
      ],
    };
  } else if (request.entry.id === "mcp.tools.list") {
    if (!request.companyId) throw new Error("mcp.tools.list requires companyId.");
    const memberId = requiredString(input.runtimeEmployeeId, "runtimeEmployeeId");
    const discovery = await new McpRuntimeGateway(input.repoRoot).discoverAssignedTools({
      companyId: request.companyId,
      memberId,
      signal: input.signal,
    });
    result = {
      schema: "tinyoffice-mcp-tool-catalog",
      version: 1,
      companyId: request.companyId,
      memberId,
      ...discovery,
    };
  } else if (request.entry.id === "mcp.tool.call") {
    if (!request.companyId) throw new Error("mcp.tool.call requires companyId.");
    const memberId = requiredString(input.runtimeEmployeeId, "runtimeEmployeeId");
    const connectionId = requiredString(request.body.connectionId, "connectionId");
    const toolName = requiredString(request.body.toolName, "toolName");
    const argumentsValue = objectBody(request.body.arguments);
    result = {
      schema: "tinyoffice-mcp-tool-result",
      version: 1,
      companyId: request.companyId,
      memberId,
      connectionId,
      toolName,
      result: await new McpRuntimeGateway(input.repoRoot).callAssignedTool({
        companyId: request.companyId,
        memberId,
        connectionId,
        toolName,
        arguments: argumentsValue,
        sessionKey: input.sessionKey,
        signal: input.signal,
      }),
    };
  } else if (request.entry.id === "mcp.admin.describe") {
    if (!request.companyId) throw new Error("mcp.admin.describe requires companyId.");
    result = await new McpAdminService(input.repoRoot).loadState(request.companyId);
  } else if (request.entry.id === "mcp.admin.configure") {
    if (!request.companyId) throw new Error("mcp.admin.configure requires companyId.");
    const operation = requiredString(request.body.operation, "operation");
    const configuration = objectBody(request.body.configuration);
    const service = new McpAdminService(input.repoRoot);
    if (operation === "save_server") await service.saveServer(configuration);
    else if (operation === "save_connection") await service.saveConnection(configuration);
    else if (operation === "save_assignment") await service.saveAssignment(request.companyId, configuration);
    else throw new Error("mcp.admin.configure operation must be save_server, save_connection, or save_assignment.");
    result = {
      schema: "tinyoffice-mcp-configuration-result", version: 1,
      companyId: request.companyId, operation, state: await service.loadState(request.companyId),
    };
  } else if (request.entry.id === "skill.list") {
    if (!request.companyId) throw new Error("skill.list requires companyId.");
    result = await listSkillsForCapability({ repoRoot: input.repoRoot, companyId: request.companyId, scope: request.body.scope });
  } else if (request.entry.id === "skill.describe") {
    if (!request.companyId) throw new Error("skill.describe requires companyId.");
    result = await describeSkillForCapability({ repoRoot: input.repoRoot, companyId: request.companyId, scope: request.body.scope, skillName: request.body.skillName });
  } else if (request.entry.id === "skill.create" || request.entry.id === "skill.update") {
    if (!request.companyId) throw new Error(`${request.entry.id} requires companyId.`);
    result = await mutateSkillForCapability({
      repoRoot: input.repoRoot,
      companyId: request.companyId,
      reloadKey: requiredString(input.sessionKey || input.conversationId || input.roomId, "sessionKey"),
      scope: request.body.scope,
      skillName: request.body.skillName,
      files: request.body.files,
      mode: request.entry.id === "skill.create" ? "create" : "update",
    });
  } else if (request.entry.id === "member.profile.describe") {
    if (!request.companyId) {
      throw new Error("member.profile.describe requires companyId.");
    }
    result = {
      schema: "tinyoffice-member-profile",
      version: 1,
      companyId: request.companyId,
      member: await loadDirectoryMemberProfile({
        repoRoot: input.repoRoot,
        companyId: request.companyId,
        memberId: requiredString(request.body.memberId, "memberId"),
      }),
    };
  } else if (request.entry.id === "employee.recruit") {
    if (!request.companyId) {
      throw new Error("employee.recruit requires companyId.");
    }
    const { companyId: _companyId, ...employeeInput } = request.body;
    result = await recruitEmployee({
      repoRoot: input.repoRoot,
      companyId: request.companyId,
      employeeId: typeof employeeInput.employeeId === "string" ? employeeInput.employeeId : undefined,
      displayName: requiredString(employeeInput.displayName, "displayName"),
      role: requiredString(employeeInput.role, "role"),
      summary: requiredString(employeeInput.summary, "summary"),
      presenceMode: optionalPresenceMode(employeeInput.presenceMode),
      runtime: runtimeConfig(employeeInput.runtime),
      resourcePolicy: optionalResourcePolicy(employeeInput.resourcePolicy),
      instructionContent: typeof employeeInput.instructionContent === "string"
        ? employeeInput.instructionContent
        : undefined,
    });
    publishToRegisteredTinyOfficeRealtimePublishers({
      type: "company.directory.changed",
      companyId: request.companyId,
    });
  } else if (request.entry.id === "chat.channel.create") {
    if (!request.companyId) {
      throw new Error("chat.channel.create requires companyId.");
    }
    const actorMemberId = optionalString(input.actorMemberId);
    if (!actorMemberId) {
      throw new Error("chat.channel.create requires actorMemberId from runtime context.");
    }
    const actor = (await channelMembersFromDirectory({
      repoRoot: input.repoRoot,
      companyId: request.companyId,
      selectors: [{ memberId: actorMemberId }],
    }))[0];
    if (!actor) {
      throw new Error(`Channel company member not found in company member directory: ${actorMemberId}`);
    }
    const members = await channelMembersFromDirectory({
      repoRoot: input.repoRoot,
      companyId: request.companyId,
      selectors: channelMemberSelectors(request.body.members),
    });
    const repository = await PostgresChannelRepository.open(input.repoRoot, { companyId: request.companyId });
    try {
      const channelService = new ChannelService(repository);
      result = await channelService.createChannel({
        companyId: request.companyId,
        title: requiredString(request.body.title, "title"),
        summary: optionalString(request.body.summary),
        actor: {
          memberId: actorMemberId,
          displayName: actor.displayName,
        },
        members,
      });
    } finally {
      repository.close();
    }
  } else if (request.entry.id === "work.create") {
    if (!request.companyId) {
      throw new Error("work.create requires companyId.");
    }
    const actorMemberId = optionalString(input.actorMemberId);
    if (!actorMemberId) {
      throw new Error("work.create requires actorMemberId from runtime context.");
    }
    const conversationId = optionalString(input.conversationId) || optionalString(input.threadId);
    if (!conversationId) {
      throw new Error("work.create requires conversationId or threadId from runtime context.");
    }
    const trigger = workTrigger(request.body.trigger);
    const workService = new WorkService({
      repoRoot: input.repoRoot,
      companyId: request.companyId,
    });
    result = await workService.createWork({
      title: requiredString(request.body.title, "title"),
      description: optionalString(request.body.description),
      createdByMemberId: actorMemberId,
      ownerMemberId: requiredString(request.body.ownerMemberId, "ownerMemberId"),
      sourceKind: "chat_request",
      sourceId: conversationId,
      sourceChannelTopicId: optionalString(input.channelTopicId),
      requesterId: actorMemberId,
      acceptanceCriteria: requiredString(request.body.acceptanceCriteria, "acceptanceCriteria"),
      trigger,
      maxRuns: optionalPositiveNumber(request.body.maxRuns, "maxRuns"),
      metadata: {
        sourceKind: "chat_request",
        ...(optionalString(input.runtimeEmployeeId) ? { runtimeEmployeeId: optionalString(input.runtimeEmployeeId) } : {}),
        ...(optionalString(input.channelTopicId) ? { channelTopicId: optionalString(input.channelTopicId) } : {}),
        ...(optionalString(input.workRunId) ? { workRunId: optionalString(input.workRunId) } : {}),
        ...(optionalString(input.threadId) ? { threadId: optionalString(input.threadId) } : {}),
        ...(optionalString(input.roomId) ? { roomId: optionalString(input.roomId) } : {}),
        ...(optionalString(input.conversationId) ? { conversationId: optionalString(input.conversationId) } : {}),
        ...(optionalString(input.messageId) ? { messageId: optionalString(input.messageId) } : {}),
        ...(optionalString(input.chatEntryId) ? { chatEntryId: optionalString(input.chatEntryId) } : {}),
      },
    });
  } else if (request.entry.id === "work.list") {
    if (!request.companyId) {
      throw new Error("work.list requires companyId.");
    }
    const workService = new WorkService({
      repoRoot: input.repoRoot,
      companyId: request.companyId,
    });
    const tasks = await workService.listWorkTasks({
      ...(optionalWorkTaskStatus(request.body.status) ? { status: optionalWorkTaskStatus(request.body.status) } : {}),
    });
    const details = (await Promise.all(tasks.map((task) => workService.getWorkTaskDetail(task.id))))
      .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));
    const scope = optionalWorkListScope(request.body.scope);
    const contextSourceIds = [
      optionalString(input.conversationId),
      optionalString(input.threadId),
      optionalString(input.roomId),
      optionalString(input.chatEntryId),
      optionalString(input.channelTopicId),
    ].filter((value): value is string => Boolean(value));
    result = {
      schema: "tinyoffice-work-list",
      version: 1,
      companyId: request.companyId,
      scope,
      tasks: listWorkTasksForCapability(details, {
        scope,
        currentMemberId: optionalString(input.runtimeEmployeeId),
        ownerMemberId: optionalString(request.body.ownerMemberId),
        status: optionalWorkTaskStatus(request.body.status),
        attentionOnly: optionalBoolean(request.body.attentionOnly, "attentionOnly") ?? false,
        limit: optionalLimit(request.body.limit, "limit", 20, 50),
        contextSourceIds,
      }),
    };
  } else if (request.entry.id === "work.describe") {
    if (!request.companyId) {
      throw new Error("work.describe requires companyId.");
    }
    const workService = new WorkService({
      repoRoot: input.repoRoot,
      companyId: request.companyId,
    });
    const workTaskId = requiredString(request.body.workTaskId, "workTaskId");
    const detail = await workService.getWorkTaskDetail(workTaskId);
    if (!detail) {
      throw new Error(`work.describe WorkTask not found: ${workTaskId}`);
    }
    const latestRun = [...detail.runs].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt)
    )[0];
    const includeEvents = optionalBoolean(request.body.includeEvents, "includeEvents") ?? false;
    const latestRunEvents = includeEvents && latestRun
      ? (await workService.getWorkRunDetail(latestRun.id))?.events
      : undefined;
    result = {
      schema: "tinyoffice-work-detail",
      version: 1,
      companyId: request.companyId,
      ...describeWorkTaskForCapability({
        detail,
        latestRunEvents,
      }),
    };
  } else if (request.entry.id === "work.cancel") {
    if (!request.companyId) {
      throw new Error("work.cancel requires companyId.");
    }
    const actorMemberId = requiredCapabilityActorMemberId(input);
    const workService = new WorkService({ repoRoot: input.repoRoot, companyId: request.companyId });
    const cancellationService = new WorkCancellationService({
      repoRoot: input.repoRoot,
      companyId: request.companyId,
      workService,
    });
    const detail = await cancellationService.cancelWorkTask({
      workTaskId: requiredString(request.body.workTaskId, "workTaskId"),
      actorMemberId,
      reason: requiredString(request.body.reason, "reason"),
    });
    result = { companyId: request.companyId, ...detail };
  } else if (request.entry.id === "work.revise") {
    if (!request.companyId) {
      throw new Error("work.revise requires companyId.");
    }
    const workService = new WorkService({ repoRoot: input.repoRoot, companyId: request.companyId });
    result = {
      companyId: request.companyId,
      ...(await workService.reviseWorkTask({
        workTaskId: requiredString(request.body.workTaskId, "workTaskId"),
        actorMemberId: requiredCapabilityActorMemberId(input),
        reason: requiredString(request.body.reason, "reason"),
        ...(request.body.title !== undefined ? { title: requiredString(request.body.title, "title") } : {}),
        ...(request.body.description !== undefined ? { description: requiredString(request.body.description, "description") } : {}),
        ...(request.body.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: requiredString(request.body.acceptanceCriteria, "acceptanceCriteria") }
          : {}),
        sourceWorkRunId: optionalString(input.workRunId),
      })),
    };
  } else if (request.entry.id === "work.retry") {
    if (!request.companyId) {
      throw new Error("work.retry requires companyId.");
    }
    const workService = new WorkService({ repoRoot: input.repoRoot, companyId: request.companyId });
    result = {
      companyId: request.companyId,
      run: await workService.retryWorkRun({
        workRunId: requiredString(request.body.workRunId, "workRunId"),
        actorMemberId: requiredCapabilityActorMemberId(input),
      }),
    };
  } else if (request.entry.id === "work.archive") {
    if (!request.companyId) {
      throw new Error("work.archive requires companyId.");
    }
    const workService = new WorkService({ repoRoot: input.repoRoot, companyId: request.companyId });
    const detail = await workService.archiveWorkTask({
      workTaskId: requiredString(request.body.workTaskId, "workTaskId"),
      actorMemberId: requiredCapabilityActorMemberId(input),
      reason: optionalString(request.body.reason),
    });
    result = { companyId: request.companyId, ...detail };
  } else if (request.entry.id === "work.restore") {
    if (!request.companyId) {
      throw new Error("work.restore requires companyId.");
    }
    const workService = new WorkService({ repoRoot: input.repoRoot, companyId: request.companyId });
    const detail = await workService.restoreWorkTask({
      workTaskId: requiredString(request.body.workTaskId, "workTaskId"),
      actorMemberId: requiredCapabilityActorMemberId(input),
    });
    result = { companyId: request.companyId, ...detail };
  } else if (request.entry.id === "schedule.pause" || request.entry.id === "schedule.resume") {
    if (!request.companyId) {
      throw new Error(`${request.entry.id} requires companyId.`);
    }
    const workService = new WorkService({ repoRoot: input.repoRoot, companyId: request.companyId });
    result = {
      companyId: request.companyId,
      schedule: await workService.moveWorkSchedule({
        workScheduleId: requiredString(request.body.workScheduleId, "workScheduleId"),
        actorMemberId: requiredCapabilityActorMemberId(input),
        status: request.entry.id === "schedule.pause" ? "paused" : "enabled",
        reason: request.entry.id === "schedule.pause" ? requiredString(request.body.reason, "reason") : undefined,
      }),
    };
  } else if (request.entry.id === "schedule.cancel") {
    if (!request.companyId) {
      throw new Error("schedule.cancel requires companyId.");
    }
    const actorMemberId = requiredCapabilityActorMemberId(input);
    const workScheduleId = requiredString(request.body.workScheduleId, "workScheduleId");
    const reason = requiredString(request.body.reason, "reason");
    const workService = new WorkService({ repoRoot: input.repoRoot, companyId: request.companyId });
    const schedule = (await workService.listWorkSchedules()).find((candidate) => candidate.id === workScheduleId);
    if (!schedule) {
      throw new Error(`WorkSchedule not found: ${workScheduleId}`);
    }
    const cancellationService = new WorkCancellationService({
      repoRoot: input.repoRoot,
      companyId: request.companyId,
      workService,
    });
    const detail = await cancellationService.cancelWorkTask({
      workTaskId: schedule.workTaskId,
      actorMemberId,
      reason,
    });
    result = {
      companyId: request.companyId,
      schedule: detail.schedules.find((candidate) => candidate.id === workScheduleId),
      task: detail.task,
      runs: detail.runs,
    };
  } else {
    throw new Error(`tinyoffice_capability_call ${request.entry.id} has no executor.`);
  }

  return {
    status: "allowed",
    capabilityId: request.entry.id,
    result,
  };
}
