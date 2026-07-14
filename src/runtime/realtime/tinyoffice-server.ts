import http from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  ChatDispatchApiSink,
} from "../../collaboration/api/chat-projection-api-routes.js";
import {
  createPostgresCompanyDirectoryApiSource,
  loadCompanyDirectoryApiSnapshot,
} from "../../collaboration/api/company-directory-api-routes.js";
import { createTinyOfficeApi } from "../../api/tinyoffice-api.js";
import { publishChatMessageCreated } from "../../api/tinyoffice-api/chat-helpers.js";
import { handleTinyOfficeApiRequest } from "../../server/tinyoffice-api-server.js";
import { ChatCreateEntryService } from "../../collaboration/chat/chat-create-entry-service.js";
import { ChatProjectionService } from "../../collaboration/chat/chat-projection-service.js";
import { ChannelService } from "../../collaboration/channel/channel-service.js";
import { PostgresChannelRepository } from "../../collaboration/channel/postgres-channel-repository.js";
import { LocalChatAttachmentStore } from "../../collaboration/attachments/local-attachment-store.js";
import { publicChatAttachment } from "../../collaboration/attachments/attachment-contracts.js";
import type { ChatAttachmentRecord, PublicChatAttachment } from "../../collaboration/attachments/attachment-contracts.js";
import { PostgresChatAttachmentRepository } from "../../collaboration/attachments/postgres-attachment-repository.js";
import { MessageService } from "../../collaboration/message/message-service.js";
import { PostgresMessageRepository } from "../../collaboration/message/postgres-message-repository.js";
import {
  ChatTitleGenerationRealtimeObserver,
  SystemAiChatTitleGenerationService,
} from "../../system-ai/chat-title-generation.js";
import {
  SystemAiChatTopicSummaryGenerationService,
} from "../../system-ai/chat-topic-summary-generation.js";
import {
  PostgresSystemAiAuditRepository,
  PostgresSystemAiProviderConfigRepository,
} from "../../system-ai/postgres-system-ai-repository.js";
import { PiChatTitleGenerationProvider } from "../../system-ai/pi-chat-title-generation-provider.js";
import { PiChatTopicSummaryGenerationProvider } from "../../system-ai/pi-chat-topic-summary-generation-provider.js";
import { SystemAiProviderConfigService } from "../../system-ai/provider-config.js";
import {
  createCompanyWithoutCarrier,
  deleteCompany,
  loadCompaniesAdminViewModel,
  saveCompanySystemAiSettings,
} from "../company-config/companies-admin.js";
import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "../company-config/postgres-runtime-connection.js";
import {
  EMPLOYEE_THINKING_LEVELS,
  listEmployeePrivateSkills,
  loadEmployeesAdminState,
  loadPiModelState,
  readEmployeePrivateSkill,
  saveEmployeeAdminRecord,
  saveEmployeePrivateSkill,
} from "../company-config/employees-admin.js";
import { setMemberRuntimeLifecycle } from "../company-config/member-runtime-lifecycle-service.js";
import { loadUserPreferredCompanyId, saveUserPreferredCompanyId } from "../company-config/user-profile.js";
import { recruitEmployee } from "../company-config/recruit-employee.js";
import {
  loadPromptPolicyViewModel,
  resetPromptPolicyBlockToDefault,
  resetPromptPolicyTemplateToDefault,
  savePromptPolicyBlockContent,
  savePromptPolicyConfig,
  savePromptPolicyTemplateContent,
} from "../company-config/prompt-blocks-admin.js";
import {
  loadToolSafetyViewModel,
  previewToolSafetyDecision,
  saveToolSafetyPolicy,
} from "../company-config/tool-guard-admin.js";
import { createTinyOfficeDoctorService } from "../doctor/tinyoffice-doctor-service.js";
import { TinyOfficeBackupService } from "../backup/tinyoffice-backup-service.js";
import { TinyOfficeUpdateService } from "../update/tinyoffice-update-service.js";
import { AccessRequestService } from "../company-config/access-request-service.js";
import { createDbCompanyGovernanceServices } from "../../governance/services/company-governance-services.js";
import { loadCompanyMemberDirectory } from "../members/company-member-directory.js";
import { describeSkillForCapability, listSkillsForCapability, mutateSkillForCapability } from "../capabilities/skill-capability-service.js";
import { loadTasksViewModel } from "../../work/tasks-loader.js";
import { WorkServiceTasksRunActionService } from "../../work/tasks-run-actions.js";
import { WorkCancellationService } from "../../work/work-cancellation-service.js";
import { WorkService, type WorkServiceObserver } from "../../work/work-service.js";
import { CompanyControlPlane } from "../../work/company-control-plane.js";
import { DbIntakeEventStore, IntakeEventService, type IntakeEventReceipt } from "../../intake/index.js";
import { WorkExecutionService } from "../../work/work-execution-service.js";
import { WorkBlockedRecoveryConversationService } from "../../work/work-blocked-recovery-conversation-service.js";
import {
  WorkBlockedRecoveryRequestRepository,
  cancelOpenWorkBlockedRecoveryRequests,
} from "../../work/work-blocked-recovery-request.js";
import { loadDatabaseSessionExplorerViewModel } from "../pi/session-explorer-loader.js";
import {
  buildEmployeeRuntimeSummaryViewModel,
} from "../employee-status/employee-runtime-summary.js";
import { loadEmployeeStatusViewModel } from "../employee-status/employee-status-loader.js";
import { loadEmployeeHomes } from "../registry/employee-home.js";
import type { EmployeeHome } from "../registry/employee-home.js";
import type { NaturalLanguageResponseInput } from "../provider/natural-language-responder.js";
import {
  abortNaturalLanguageEmployeeSessions,
  generateNaturalLanguageEmployeeReply,
} from "../provider/natural-language-responder-runtime.js";
import { INTAKE_EVENT_ACTIVE_TOOL_NAMES } from "../provider/runtime-tool-contracts.js";
import type { TinyOfficeCurrentUserSession } from "../../auth/tinyoffice-session.js";
import { createTinyOfficeOwnerAuth } from "../../auth/better-auth-owner.js";
import type { ChatAttachmentApiService } from "../../api/tinyoffice-api/contracts.js";
import { createTinyOfficeChatRuntimeDispatchSink } from "../chat/tinyoffice-chat-runtime-dispatch.js";
import { PostgresChatTopicChainRepository } from "../chat/chat-topic-chain-repository.js";
import type { TinyOfficeChatRuntimeProcessTracePublisher } from "../chat/tinyoffice-chat-runtime-dispatch.js";
import { listProcessTraceEvents, ProcessTracePublisher } from "./process-trace-store.js";
import {
  attachTinyOfficeRealtimeGateway,
  TINYOFFICE_REALTIME_SOCKET_IO_PATH,
} from "./tinyoffice-realtime-gateway.js";

export interface TinyOfficeServerConfig {
  repoRoot: string;
  companyId?: string;
  databaseUrl: string;
  publicOrigin: string;
  authSecret?: string;
  runtimeProvider?: NaturalLanguageResponseInput["runtimeProvider"];
  workControlPlaneIntervalMs?: number;
}

export interface TinyOfficeServerHandle {
  server: http.Server;
  companyId?: string;
  bootstrapToken?: string;
  localAccessTicket?: string;
}

type RuntimeMessageService = MessageService & { close?(): void };
type RuntimeAttachmentService = ChatAttachmentApiService & {
  listPublicAttachments(companyId: string, attachmentIds: string[]): Promise<PublicChatAttachment[]>;
  close?(): void;
};
type RuntimeChannelService = ChannelService & { close?(): void };
type RuntimeTitleGenerationService = SystemAiChatTitleGenerationService & { close?(): void };
type RuntimeTopicSummaryGenerationService = SystemAiChatTopicSummaryGenerationService & { close?(): void };
type RuntimeWorkControlPlaneLoop = {
  stopWorkControlPlaneLoop(): void;
};

function runtimeWorkRunSessionAborter(runtimeProvider: NaturalLanguageResponseInput["runtimeProvider"]) {
  return (predicate: (input: { companyId: string; employeeId: string; sessionKey: string }) => boolean) =>
    runtimeProvider
      ? runtimeProvider.abortWhere(predicate)
      : abortNaturalLanguageEmployeeSessions(predicate);
}

async function ingestRuntimeIntakeEvent(input: {
  repoRoot: string;
  companyId: string;
  rawInput: unknown;
  realtimePublisher?: ReturnType<typeof attachTinyOfficeRealtimeGateway>;
  runtimeProvider?: NaturalLanguageResponseInput["runtimeProvider"];
}): Promise<IntakeEventReceipt> {
  const employeeHomes = await loadEmployeeHomes({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
  });
  const employeeHomesById = new Map(employeeHomes.map((employee) => [employee.employeeId, employee]));
  const store = await DbIntakeEventStore.open({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
  });
  const service = new IntakeEventService({
    repoRoot: input.repoRoot,
    store,
    validateTargetMemberId: (memberId) => employeeHomesById.has(memberId),
  });

  let receipt: IntakeEventReceipt;
  try {
    receipt = await service.ingest(input.rawInput);
  } finally {
    service.close();
  }

  if (receipt.status === "processed") {
    void dispatchRuntimeIntakeEvent({
      ...input,
      receipt,
      employeeHomesById,
    }).catch((error) => appendRuntimeChatTrace(input.repoRoot, {
      phase: "tinyoffice_chat_runtime.intake_dispatch.failed",
      companyId: input.companyId,
      intakeEventId: receipt.eventId,
      error: error instanceof Error ? error.stack || error.message : String(error),
    }));
  }

  return receipt;
}

async function dispatchRuntimeIntakeEvent(input: {
  repoRoot: string;
  companyId: string;
  rawInput: unknown;
  receipt: IntakeEventReceipt;
  employeeHomesById: Map<string, EmployeeHome>;
  realtimePublisher?: ReturnType<typeof attachTinyOfficeRealtimeGateway>;
  runtimeProvider?: NaturalLanguageResponseInput["runtimeProvider"];
}): Promise<void> {
  const targetMemberId = input.receipt.result?.targetMemberId;
  if (typeof targetMemberId !== "string" || !targetMemberId.trim()) {
    throw new Error("Processed intake event is missing targetMemberId");
  }
  const employee = input.employeeHomesById.get(targetMemberId);
  if (!employee) {
    throw new Error(`Processed intake event target is not available: ${targetMemberId}`);
  }
  const sessionKey = `${employee.employeeId}|intake_event|${input.receipt.eventId}`;
  const processTrace = createRuntimeProcessTracePublisher(input.repoRoot, input.companyId, input.realtimePublisher);
  const eventPayload = JSON.stringify(input.rawInput, null, 2);
  const contextText = [
    `Intake event id: ${input.receipt.eventId}`,
    `Category: ${input.receipt.category}`,
    input.receipt.eventType ? `Event type: ${input.receipt.eventType}` : undefined,
    "",
    "External intake event payload:",
    eventPayload,
  ].filter((line): line is string => line !== undefined).join("\n");

  await generateNaturalLanguageEmployeeReply({
    employee,
    message: [
      "External intake event received.",
      "Read the intake event context and finish this intake turn with `finish_intake_turn`.",
      "Create Work only when the event is actionable according to the event content or employee guidance; otherwise record an operating event.",
    ].join("\n"),
    sessionKey,
    threadId: input.receipt.eventId,
    actorMemberId: employee.employeeId,
    reachableMemberIds: [employee.employeeId],
    requesterUsername: "External intake",
    preferredLanguage: "en",
    activeToolNames: [...INTAKE_EVENT_ACTIVE_TOOL_NAMES],
    contextBlocks: [{
      role: "intake_event_context",
      source: "external_intake.event_payload",
      label: "External intake event",
      text: contextText,
      metadata: {
        companyId: input.companyId,
        intakeEventId: input.receipt.eventId,
        targetMemberId: employee.employeeId,
        category: input.receipt.category,
        eventType: input.receipt.eventType,
      },
    }],
    userMessageSource: "external_intake.event",
    userMessagePayload: {
      companyId: input.companyId,
      intakeEventId: input.receipt.eventId,
      category: input.receipt.category,
      eventType: input.receipt.eventType,
      targetMemberId: employee.employeeId,
    },
    repoRoot: input.repoRoot,
    runtimeProvider: input.runtimeProvider,
    allowEmptyReply: true,
    async onProcessEvent(event) {
      await processTrace.publishProcessTraceEvent(event);
    },
    onRuntimeSessionPersisted(persisted) {
      input.realtimePublisher?.publish({
        type: "session.updated",
        companyId: input.companyId,
        sessionId: persisted.record.id,
        employeeId: persisted.record.employeeId,
        sessionKey: persisted.record.sessionKey,
        status: persisted.record.status,
      });
    },
  });
}

interface CurrentUserMemberRow {
  company_id: string;
  id: string;
  display_name: string | null;
  role: string | null;
  account_display_name: string | null;
}

async function resolveRuntimeCurrentUserSession(
  repoRoot: string,
  session: TinyOfficeCurrentUserSession,
  selectedCompanyId?: string,
): Promise<TinyOfficeCurrentUserSession> {
  if (selectedCompanyId) {
    const selected = await loadCurrentUserMemberSession(repoRoot, session, selectedCompanyId);
    if (selected) {
      return selected;
    }
  }
  if (session.currentCompanyId) {
    const current = await loadCurrentUserMemberSession(repoRoot, session, session.currentCompanyId);
    if (current) {
      return current;
    }
  }
  return {
    userId: session.userId,
    ...(session.displayName ? { displayName: session.displayName } : {}),
    source: session.source,
  };
}

async function switchRuntimeCurrentUserCompany(
  repoRoot: string,
  session: TinyOfficeCurrentUserSession,
  companyId: unknown,
): Promise<TinyOfficeCurrentUserSession> {
  const selectedCompanyId = typeof companyId === "string" ? companyId.trim() : "";
  if (!selectedCompanyId) {
    throw new Error("companyId is required");
  }
  const selected = await loadCurrentUserMemberSession(repoRoot, session, selectedCompanyId);
  if (!selected) {
    throw new Error("Current user is not a member of the requested Company");
  }
  return selected;
}

async function loadCurrentUserMemberSession(
  repoRoot: string,
  session: TinyOfficeCurrentUserSession,
  companyId: string,
): Promise<TinyOfficeCurrentUserSession | undefined> {
  const postgres = await openConfiguredPostgresConnection(repoRoot);
  if (!postgres) {
    return undefined;
  }
  try {
    const rows = await postgres.client.query<CurrentUserMemberRow>(
      `SELECT member.company_id, member.id, member.display_name, member.role, profile.display_name AS account_display_name
FROM company_members member
LEFT JOIN user_profiles profile ON profile.user_id = member.id
WHERE member.id = $1
  AND member.company_id = $2
ORDER BY member.company_id ASC
LIMIT 1`,
      [session.userId, companyId],
    );
    const row = rows.rows[0];
    if (!row) {
      return undefined;
    }
    return {
      ...session,
      ...(row.account_display_name ? { displayName: row.account_display_name } : {}),
      currentCompanyId: row.company_id,
      member: {
        memberId: row.id,
        ...(row.display_name ? { displayName: row.display_name } : {}),
        ...(row.role ? { role: row.role } : {}),
      },
    };
  } finally {
    postgres.client.release();
    await endCompanyPostgresPool(postgres.pool);
  }
}

function json(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function createAttachmentService(repoRoot: string, companyId: string): Promise<RuntimeAttachmentService> {
  const postgres = await openConfiguredPostgresConnection(repoRoot, { companyId });
  if (!postgres) {
    throw new Error("Chat attachment service requires PostgreSQL runtime configuration.");
  }
  const repository = new PostgresChatAttachmentRepository(postgres.client);
  const store = new LocalChatAttachmentStore(repoRoot);
  let closed = false;
  return {
    async uploadChatImageAttachment(scopedCompanyId, input) {
      const stale = await repository.deleteStaleUnreferencedAttachments({
        companyId: scopedCompanyId,
        olderThan: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });
      for (const record of stale) {
        await store.delete(record);
      }
      const record = await store.writeImage({
        companyId: scopedCompanyId,
        ownerMemberId: input.ownerMemberId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        bytes: input.bytes,
      });
      try {
        return publicChatAttachment(await repository.saveAttachment(record));
      } catch (error) {
        await store.delete(record).catch(() => undefined);
        throw error;
      }
    },
    getChatAttachment(scopedCompanyId, attachmentId) {
      return repository.getAttachment(scopedCompanyId, attachmentId);
    },
    listChatAttachmentReferenceConversationIds(scopedCompanyId, attachmentId) {
      return repository.listReferenceConversationIds(scopedCompanyId, attachmentId);
    },
    readChatAttachment(record: ChatAttachmentRecord) {
      return store.read(record);
    },
    async discardChatAttachment(scopedCompanyId, input) {
      const deleted = await repository.deleteUnreferencedAttachment({
        companyId: scopedCompanyId,
        attachmentId: input.attachmentId,
        ownerMemberId: input.ownerMemberId,
      });
      if (!deleted) {
        const error = new Error(`Chat attachment cannot be discarded because it is referenced or unavailable: ${input.attachmentId}`) as Error & { statusCode?: number };
        error.statusCode = 409;
        throw error;
      }
      try {
        await store.delete(deleted);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Chat attachment ${input.attachmentId} was discarded, but file cleanup failed: ${message}`);
      }
    },
    async listPublicAttachments(scopedCompanyId, attachmentIds) {
      const records = await repository.listAttachments(scopedCompanyId, attachmentIds);
      const byId = new Map(records.map((record) => [record.attachmentId, record]));
      return attachmentIds.map((attachmentId) => {
        const record = byId.get(attachmentId);
        if (!record) {
          throw new Error(`Chat attachment not found: ${attachmentId}`);
        }
        return publicChatAttachment(record);
      });
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      postgres.client.release();
      void endCompanyPostgresPool(postgres.pool);
    },
  };
}

async function createMessageService(
  repoRoot: string,
  companyId: string,
  attachmentService: RuntimeAttachmentService,
): Promise<RuntimeMessageService> {
  const repository = await PostgresMessageRepository.open(repoRoot, { companyId });
  const service = new MessageService({
    repository,
    attachmentResolver: {
      listAttachments(scopedCompanyId, attachmentIds) {
        return attachmentService.listPublicAttachments(scopedCompanyId, attachmentIds);
      },
    },
  }) as RuntimeMessageService;
  let closed = false;
  service.close = () => {
    if (closed) {
      return;
    }
    closed = true;
    repository.close();
  };
  return service;
}

async function createChannelService(repoRoot: string, companyId: string): Promise<RuntimeChannelService> {
  const repository = await PostgresChannelRepository.open(repoRoot, { companyId });
  const service = new ChannelService(repository, {
    memberEligibilityResolver: async ({ memberIds }) => {
      const directory = await loadCompanyDirectoryApiSnapshot(repoRoot, { companyId });
      const activeMemberIds = new Set(directory.directoryMembers.map((member) => member.memberId));
      return memberIds.filter((memberId) => activeMemberIds.has(memberId));
    },
    dissolvePermissionResolver: async ({ actor }) => {
      const memberDirectory = actor.memberId ? await loadCompanyMemberDirectory(repoRoot, { companyId }) : undefined;
      const companyRole = memberDirectory?.members.find((member) => member.id === actor.memberId)?.role;
      return companyRole === "boss";
    },
  }) as RuntimeChannelService;
  let closed = false;
  service.close = () => {
    if (closed) {
      return;
    }
    closed = true;
    repository.close();
  };
  return service;
}

async function createTitleGenerationService(input: {
  repoRoot: string;
  companyId: string;
  messageService: RuntimeMessageService;
  realtimePublisher: ReturnType<typeof attachTinyOfficeRealtimeGateway>;
}): Promise<RuntimeTitleGenerationService> {
  const postgres = await openConfiguredPostgresConnection(input.repoRoot, { companyId: input.companyId });
  if (!postgres) {
    throw new Error("System AI title generation requires PostgreSQL runtime configuration.");
  }
  const service = new SystemAiChatTitleGenerationService({
    providers: [new PiChatTitleGenerationProvider({ repoRoot: input.repoRoot })],
    providerConfigService: new SystemAiProviderConfigService({
      repository: new PostgresSystemAiProviderConfigRepository(postgres.client),
    }),
    auditRepository: new PostgresSystemAiAuditRepository(postgres.client),
    store: input.messageService,
    observer: new ChatTitleGenerationRealtimeObserver(input.realtimePublisher),
  }) as RuntimeTitleGenerationService;
  let closed = false;
  service.close = () => {
    if (closed) {
      return;
    }
    closed = true;
    postgres.client.release();
    void endCompanyPostgresPool(postgres.pool);
  };
  return service;
}

async function createTopicSummaryGenerationService(input: {
  repoRoot: string;
  companyId: string;
  messageService: RuntimeMessageService;
}): Promise<RuntimeTopicSummaryGenerationService> {
  const postgres = await openConfiguredPostgresConnection(input.repoRoot, { companyId: input.companyId });
  if (!postgres) {
    throw new Error("System AI topic summary generation requires PostgreSQL runtime configuration.");
  }
  const service = new SystemAiChatTopicSummaryGenerationService({
    providers: [new PiChatTopicSummaryGenerationProvider({ repoRoot: input.repoRoot })],
    providerConfigService: new SystemAiProviderConfigService({
      repository: new PostgresSystemAiProviderConfigRepository(postgres.client),
    }),
    auditRepository: new PostgresSystemAiAuditRepository(postgres.client),
    store: input.messageService,
  }) as RuntimeTopicSummaryGenerationService;
  let closed = false;
  service.close = () => {
    if (closed) {
      return;
    }
    closed = true;
    postgres.client.release();
    void endCompanyPostgresPool(postgres.pool);
  };
  return service;
}

async function appendRuntimeChatTrace(repoRoot: string, entry: Record<string, unknown>): Promise<void> {
  const traceDir = path.join(repoRoot, ".scratch");
  await mkdir(traceDir, { recursive: true });
  await appendFile(
    path.join(traceDir, "tinyoffice-chat-runtime-dispatch.jsonl"),
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    })}\n`,
    "utf8",
  );
}

export function createRuntimeProcessTracePublisher(
  repoRoot: string,
  companyId: string,
  realtimePublisher?: ReturnType<typeof attachTinyOfficeRealtimeGateway>,
): TinyOfficeChatRuntimeProcessTracePublisher {
  const publisher = new ProcessTracePublisher(repoRoot, companyId);
  async function publishAndNotify(event: Parameters<ProcessTracePublisher["publish"]>[0]) {
    const stored = await publisher.publish(event);
    const employeeId = stored.employeeId || stored.sessionKey.split("|")[0]?.trim();
    if (!employeeId) {
      return stored;
    }
    realtimePublisher?.publish({
      type: "process_trace.appended",
      companyId,
      processTraceId: stored.id,
      employeeId,
      sessionKey: stored.sessionKey,
    });
    return stored;
  }
  return {
    async publishProcessTrace(event) {
      return publishAndNotify(event);
    },
    async publishProcessTraceEvent(event) {
      return publishAndNotify(event);
    },
  };
}

export function startRuntimeWorkControlPlaneLoop(input: {
  repoRoot: string;
  intervalMs?: number;
  realtimePublisher?: ReturnType<typeof attachTinyOfficeRealtimeGateway>;
  runtimeProvider?: NaturalLanguageResponseInput["runtimeProvider"];
  serviceForCompany(companyId: string): Promise<RuntimeMessageService>;
}): RuntimeWorkControlPlaneLoop {
  let stopped = false;
  let running = false;

  async function runControlPlaneOnce(): Promise<void> {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      const viewModel = await loadCompaniesAdminViewModel({ repoRoot: input.repoRoot });
      for (const company of viewModel.companies) {
        const employeeHomes = await loadEmployeeHomes({
          repoRoot: input.repoRoot,
          companyId: company.companyId,
        });
        const employeesById = new Map(employeeHomes.map((employee) => [employee.employeeId, employee]));
        const workService = new WorkService({
          repoRoot: input.repoRoot,
          companyId: company.companyId,
          observer: createRuntimeWorkServiceObserver(input.realtimePublisher),
          onWorkRunTerminal: createRuntimeWorkRunTerminalHandler(input.repoRoot, company.companyId),
        });
        const recoveryRequests = await WorkBlockedRecoveryRequestRepository.open(input.repoRoot, {
          companyId: company.companyId,
        });
        let recoveryService!: WorkBlockedRecoveryConversationService;
        const workExecutionService = new WorkExecutionService({
          workService,
          repoRoot: input.repoRoot,
          companyId: company.companyId,
          runtimeProvider: input.runtimeProvider,
          blockedRecovery: {
            openRecoveryForBlockedRun(event) {
              return recoveryService.openRecoveryForBlockedRun(event);
            },
          },
        });
        recoveryService = new WorkBlockedRecoveryConversationService({
          companyId: company.companyId,
          workService,
          workExecutionService,
          messageService: await input.serviceForCompany(company.companyId),
          recoveryRequests,
          resolveEmployee: async (employeeId) => employeesById.get(employeeId),
          resolveMemberDisplayName: async (memberId) => {
            const directory = await loadCompanyMemberDirectory(input.repoRoot, { companyId: company.companyId });
            return directory.members.find((member) => member.id === memberId)?.displayName;
          },
          onMessageCreated: (result) => publishChatMessageCreated(input.realtimePublisher, result),
        });
        const controlPlane = new CompanyControlPlane({
          repoRoot: input.repoRoot,
          companyId: company.companyId,
          workService,
          workExecutionService,
          async resolveEmployee(employeeId) {
            return employeesById.get(employeeId);
          },
        });
        try {
          await controlPlane.runOnce({
            createdBy: "tinyoffice-runtime-control-plane",
            async onProcessEvent(event) {
              await createRuntimeProcessTracePublisher(input.repoRoot, company.companyId, input.realtimePublisher)
                .publishProcessTraceEvent(event);
            },
          });
        } finally {
          recoveryRequests.close();
        }
      }
    } catch (error) {
      await appendRuntimeChatTrace(input.repoRoot, {
        phase: "tinyoffice_chat_runtime.work_control_plane.failed",
        error: error instanceof Error ? error.stack || error.message : String(error),
      });
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => {
    void runControlPlaneOnce();
  }, input.intervalMs ?? 3000);
  void runControlPlaneOnce();

  return {
    stopWorkControlPlaneLoop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function createRuntimeWorkServiceObserver(
  realtimePublisher: ReturnType<typeof attachTinyOfficeRealtimeGateway> | undefined,
): WorkServiceObserver | undefined {
  if (!realtimePublisher) {
    return undefined;
  }
  return {
    workTaskChanged(event) {
      realtimePublisher.publish({
        type: "work_task.updated",
        companyId: event.companyId,
        workTaskId: event.task.id,
        employeeId: event.task.ownerMemberId,
        status: event.task.status,
      });
    },
    workRunChanged(event) {
      realtimePublisher.publish({
        type: "work_run.updated",
        companyId: event.companyId,
        workRunId: event.run.id,
        workTaskId: event.run.workTaskId,
        employeeId: event.run.assigneeMemberId,
        status: event.run.status,
      });
    },
  };
}

function createRuntimeWorkRunTerminalHandler(repoRoot: string, companyId: string) {
  return async (run: { id: string }) => {
    const governance = await createDbCompanyGovernanceServices(repoRoot, {
      env: process.env,
      companyId,
    });
    try {
      await governance.approvalService.cancelPendingApprovalsForContext({
        contextKind: "work_run",
        contextId: run.id,
        reason: "WorkRun entered a terminal status.",
      });
    } finally {
      governance.store.close?.();
    }
  };
}

function createRuntimeChatDispatchSink(input: {
  repoRoot: string;
  serviceForCompany(companyId: string): Promise<RuntimeMessageService>;
  topicSummaryGenerationServiceForCompany(companyId: string): Promise<RuntimeTopicSummaryGenerationService>;
  realtimePublisher: ReturnType<typeof attachTinyOfficeRealtimeGateway>;
  runtimeProvider?: NaturalLanguageResponseInput["runtimeProvider"];
}): ChatDispatchApiSink {
  return createTinyOfficeChatRuntimeDispatchSink({
    repoRoot: input.repoRoot,
    topicChainRepository: new PostgresChatTopicChainRepository(input.repoRoot),
    serviceForCompany: input.serviceForCompany,
    realtimePublisher: input.realtimePublisher,
    runtimeProvider: input.runtimeProvider,
    workBlockedRecoveryMessageHandler: {
      async handleParticipantMessage(event) {
        const recoveryRequests = await WorkBlockedRecoveryRequestRepository.open(input.repoRoot, {
          companyId: event.companyId,
        });
        try {
          const workService = new WorkService({
            repoRoot: input.repoRoot,
            companyId: event.companyId,
            observer: createRuntimeWorkServiceObserver(input.realtimePublisher),
            onWorkRunTerminal: createRuntimeWorkRunTerminalHandler(input.repoRoot, event.companyId),
          });
          const employeeHomes = await loadEmployeeHomes({
            repoRoot: input.repoRoot,
            companyId: event.companyId,
          });
          const employeesById = new Map(employeeHomes.map((home) => [home.employeeId, home]));
          let recoveryService!: WorkBlockedRecoveryConversationService;
          const workExecutionService = new WorkExecutionService({
            workService,
            repoRoot: input.repoRoot,
            companyId: event.companyId,
            runtimeProvider: input.runtimeProvider,
            blockedRecovery: {
              openRecoveryForBlockedRun(blocked) {
                return recoveryService.openRecoveryForBlockedRun(blocked);
              },
            },
          });
          recoveryService = new WorkBlockedRecoveryConversationService({
            companyId: event.companyId,
            workService,
            workExecutionService,
            messageService: await input.serviceForCompany(event.companyId),
            recoveryRequests,
            resolveEmployee: async (employeeId) => employeesById.get(employeeId),
            resolveMemberDisplayName: async (memberId) => {
              const directory = await loadCompanyMemberDirectory(input.repoRoot, { companyId: event.companyId });
              return directory.members.find((member) => member.id === memberId)?.displayName;
            },
            onProcessEvent: async (processEvent) => {
              await createRuntimeProcessTracePublisher(input.repoRoot, event.companyId, input.realtimePublisher)
                .publishProcessTraceEvent(processEvent);
            },
            onMessageCreated: (result) => publishChatMessageCreated(input.realtimePublisher, result),
          });
          const result = await recoveryService.handleParticipantMessage(event);
          return result.kind === "resumed";
        } finally {
          recoveryRequests.close();
        }
      },
    },
    async runtimeForCompany(companyId) {
      const employeeHomes = await loadEmployeeHomes({
        repoRoot: input.repoRoot,
        companyId,
      });
      return {
        companyId,
        employeeHomesById: new Map(employeeHomes.map((home) => [home.employeeId, home])),
        employeeIds: employeeHomes.map((home) => home.employeeId),
        processTrace: createRuntimeProcessTracePublisher(input.repoRoot, companyId, input.realtimePublisher),
      };
    },
    trace: (entry) => appendRuntimeChatTrace(input.repoRoot, {
      ...entry,
      phase: String(entry.phase).replace(/^tinyoffice_chat_runtime_/, "tinyoffice_chat_runtime."),
    }),
    topicSummaryGenerationService: {
      requestTopicSummaryGeneration(request) {
        void input.topicSummaryGenerationServiceForCompany(request.companyId)
          .then((service) => {
            service.requestTopicSummaryGeneration(request);
            return service.drain();
          })
          .catch((error) => appendRuntimeChatTrace(input.repoRoot, {
            phase: "tinyoffice_chat_runtime.topic_summary_generation.failed",
            companyId: request.companyId,
            roomId: request.roomId,
            topicId: request.topicId,
            error: error instanceof Error ? error.stack || error.message : String(error),
          }));
      },
    },
    onError: () => undefined,
  });
}

export async function createTinyOfficeServer(
  config: TinyOfficeServerConfig,
): Promise<TinyOfficeServerHandle> {
  const companyId = config.companyId?.trim() || undefined;
  const ownerAuth = await createTinyOfficeOwnerAuth({
    repoRoot: config.repoRoot,
    databaseUrl: config.databaseUrl,
    publicOrigin: config.publicOrigin,
    ...(config.authSecret ? { secret: config.authSecret } : {}),
  });

  const services = new Map<string, Promise<RuntimeMessageService>>();
  const attachmentServices = new Map<string, Promise<RuntimeAttachmentService>>();
  const channelServices = new Map<string, Promise<RuntimeChannelService>>();
  const titleGenerationServices = new Map<string, Promise<RuntimeTitleGenerationService>>();
  const topicSummaryGenerationServices = new Map<string, Promise<RuntimeTopicSummaryGenerationService>>();
  const attachmentServiceForCompany = async (scopedCompanyId: string): Promise<RuntimeAttachmentService> => {
    const existing = attachmentServices.get(scopedCompanyId);
    if (existing) {
      return existing;
    }
    const created = createAttachmentService(config.repoRoot, scopedCompanyId);
    attachmentServices.set(scopedCompanyId, created);
    return created;
  };
  const serviceForCompany = async (scopedCompanyId: string): Promise<RuntimeMessageService> => {
    const existing = services.get(scopedCompanyId);
    if (existing) {
      return existing;
    }
    const created = (async () => createMessageService(
      config.repoRoot,
      scopedCompanyId,
      await attachmentServiceForCompany(scopedCompanyId),
    ))();
    services.set(scopedCompanyId, created);
    return created;
  };
  const channelServiceForCompany = async (scopedCompanyId: string): Promise<RuntimeChannelService> => {
    const existing = channelServices.get(scopedCompanyId);
    if (existing) {
      return existing;
    }
    const created = createChannelService(config.repoRoot, scopedCompanyId);
    channelServices.set(scopedCompanyId, created);
    return created;
  };
  const titleGenerationServiceForCompany = async (scopedCompanyId: string): Promise<RuntimeTitleGenerationService> => {
    const existing = titleGenerationServices.get(scopedCompanyId);
    if (existing) {
      return existing;
    }
    const created = (async () => createTitleGenerationService({
      repoRoot: config.repoRoot,
      companyId: scopedCompanyId,
      messageService: await serviceForCompany(scopedCompanyId),
      realtimePublisher,
    }))();
    titleGenerationServices.set(scopedCompanyId, created);
    return created;
  };
  const topicSummaryGenerationServiceForCompany = async (
    scopedCompanyId: string,
  ): Promise<RuntimeTopicSummaryGenerationService> => {
    const existing = topicSummaryGenerationServices.get(scopedCompanyId);
    if (existing) {
      return existing;
    }
    const created = (async () => createTopicSummaryGenerationService({
      repoRoot: config.repoRoot,
      companyId: scopedCompanyId,
      messageService: await serviceForCompany(scopedCompanyId),
    }))();
    topicSummaryGenerationServices.set(scopedCompanyId, created);
    return created;
  };
  const withAccessRequestService = async <T>(
    scopedCompanyId: string,
    action: (service: AccessRequestService) => Promise<T>,
  ): Promise<T> => {
    const governance = await createDbCompanyGovernanceServices(config.repoRoot, {
      env: process.env,
      companyId: scopedCompanyId,
    });
    const recoveryRequests = await WorkBlockedRecoveryRequestRepository.open(config.repoRoot, {
      companyId: scopedCompanyId,
    });
    try {
      const service = new AccessRequestService(
        governance.approvalRepository,
        governance.approvalService,
        {
          async resolveWorkRunForegroundTarget({ companyId: targetCompanyId, workRunId }) {
            const recovery = await recoveryRequests.getOpenByWorkRunId(targetCompanyId, workRunId);
            return recovery
              ? { kind: "chat-room", roomId: recovery.conversationId, surface: "direct" }
              : undefined;
          },
          async resolveWorkRunStatus({ workRunId }) {
            const workService = new WorkService({
              repoRoot: config.repoRoot,
              companyId: scopedCompanyId,
            });
            return (await workService.getWorkRunDetail(workRunId))?.run.status;
          },
        },
      );
      return await action(service);
    } finally {
      recoveryRequests.close();
      governance.store.close?.();
    }
  };

  const server = http.createServer();
  const realtimePublisher = attachTinyOfficeRealtimeGateway(server);
  const chatDispatchSink = createRuntimeChatDispatchSink({
    repoRoot: config.repoRoot,
    serviceForCompany,
    topicSummaryGenerationServiceForCompany,
    realtimePublisher,
    runtimeProvider: config.runtimeProvider,
  });
  const workControlPlaneLoop = startRuntimeWorkControlPlaneLoop({
    repoRoot: config.repoRoot,
    intervalMs: config.workControlPlaneIntervalMs,
    realtimePublisher,
    runtimeProvider: config.runtimeProvider,
    serviceForCompany,
  });
  const directorySource = createPostgresCompanyDirectoryApiSource({ repoRoot: config.repoRoot });
  const updateService = new TinyOfficeUpdateService({ repoRoot: config.repoRoot });
  const tinyOfficeApi = createTinyOfficeApi({
    repoRoot: config.repoRoot,
    backupService: new TinyOfficeBackupService(config.repoRoot),
    updateService,
    companyLifecycleService: {
      deletionGuard: {
        async ensureSafeToDeleteCompany(companyId) {
          const abortSessions = config.runtimeProvider
            ? (predicate: Parameters<NonNullable<typeof config.runtimeProvider>["abortWhere"]>[0]) => config.runtimeProvider!.abortWhere(predicate)
            : abortNaturalLanguageEmployeeSessions;
          await abortSessions((session) => session.companyId === companyId);
        },
      },
      loadCompanies() {
        return loadCompaniesAdminViewModel({ repoRoot: config.repoRoot });
      },
      createCompany(input) {
        return createCompanyWithoutCarrier({
          repoRoot: config.repoRoot,
          ...input,
        });
      },
      async deleteCompany(input, runtime) {
        const result = await deleteCompany({
          repoRoot: config.repoRoot,
          companyId: input.companyId,
          confirmation: input.confirmation,
          runtime,
        });
        return result;
      },
      saveSystemAiSettings(input) {
        return saveCompanySystemAiSettings({
          repoRoot: config.repoRoot,
          companyId: input.companyId,
          settings: input.settings,
        });
      },
      async switchCurrentCompany(session, input) {
        const selected = await switchRuntimeCurrentUserCompany(config.repoRoot, session, input.companyId);
        await saveUserPreferredCompanyId({
          repoRoot: config.repoRoot,
          userId: session.userId,
          companyId: selected.currentCompanyId!,
          fallbackDisplayName: session.displayName,
        });
        return selected;
      },
      async resolveCurrentUserSession(session) {
        const preferredCompanyId = await loadUserPreferredCompanyId({ repoRoot: config.repoRoot, userId: session.userId });
        return resolveRuntimeCurrentUserSession(config.repoRoot, session, preferredCompanyId);
      },
    },
    tasksViewModelService: {
      loadTasksViewModel(scopedCompanyId, input) {
        const viewModelJsonPath = `/api/companies/${encodeURIComponent(scopedCompanyId)}/tasks/view-model`;
        return loadTasksViewModel({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          requestUrl: input.requestUrl,
          routes: {
            htmlPath: "/tasks",
            viewModelJsonPath,
            runActionPathPrefix: `/api/companies/${encodeURIComponent(scopedCompanyId)}/tasks/runs`,
          },
        });
      },
    },
    tasksRunActionService(scopedCompanyId) {
      return Promise.resolve(new WorkServiceTasksRunActionService({
        repoRoot: config.repoRoot,
        companyId: scopedCompanyId,
        workService: new WorkService({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          observer: createRuntimeWorkServiceObserver(realtimePublisher),
          onWorkRunTerminal: createRuntimeWorkRunTerminalHandler(config.repoRoot, scopedCompanyId),
        }),
        abortWorkRunSessions: runtimeWorkRunSessionAborter(config.runtimeProvider),
        cancelBlockedRecovery(workRunId) {
          return cancelOpenWorkBlockedRecoveryRequests({
            repoRoot: config.repoRoot,
            companyId: scopedCompanyId,
            workRunIds: [workRunId],
          });
        },
      }));
    },
    workCreationService(scopedCompanyId) {
      const workService = new WorkService({
        repoRoot: config.repoRoot,
        companyId: scopedCompanyId,
        observer: createRuntimeWorkServiceObserver(realtimePublisher),
        onWorkRunTerminal: createRuntimeWorkRunTerminalHandler(config.repoRoot, scopedCompanyId),
      });
      const cancellationService = new WorkCancellationService({
        repoRoot: config.repoRoot,
        companyId: scopedCompanyId,
        workService,
        abortSessions: runtimeWorkRunSessionAborter(config.runtimeProvider),
        cancelBlockedRecovery(workRunIds) {
          return cancelOpenWorkBlockedRecoveryRequests({
            repoRoot: config.repoRoot,
            companyId: scopedCompanyId,
            workRunIds,
          });
        },
      });
      return Promise.resolve({
        createWork(companyId, input) {
          return workService.createWork({
            ...input,
            metadata: {
              ...input.metadata,
              createdVia: "tinyoffice-api",
            },
          });
        },
        async cancelWorkTask(companyId, input) {
          return cancellationService.cancelWorkTask(input);
        },
        archiveWorkTask(companyId, input) {
          return workService.archiveWorkTask(input);
        },
        restoreWorkTask(companyId, input) {
          return workService.restoreWorkTask(input);
        },
      });
    },
    intakeEventService(_scopedCompanyId) {
      return Promise.resolve({
        ingestIntakeEvent(companyId, input) {
          return ingestRuntimeIntakeEvent({
            repoRoot: config.repoRoot,
            companyId,
            rawInput: input,
            realtimePublisher,
            runtimeProvider: config.runtimeProvider,
          });
        },
      });
    },
    sessionExplorerService: {
      loadSessionExplorerViewModel(scopedCompanyId, input) {
        const viewModelJsonPath = `/api/companies/${encodeURIComponent(scopedCompanyId)}/sessions/view-model`;
        return loadDatabaseSessionExplorerViewModel({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          employeeId: input.employeeId,
          sessionId: input.sessionId,
          query: input.query,
          employeeIdFilter: input.employeeIdFilter,
          routes: {
            indexJsonPath: viewModelJsonPath,
            detailJsonPath: viewModelJsonPath,
            viewModelJsonPath,
          },
        });
      },
    },
    employeeRuntimeSummaryService: {
      async loadEmployeeRuntimeSummary(scopedCompanyId, input) {
        const summaryJsonPath = `/api/companies/${encodeURIComponent(scopedCompanyId)}/employees/runtime-summary`;
        const source = await loadEmployeeStatusViewModel({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          employeeId: input.employeeId,
        });
        return buildEmployeeRuntimeSummaryViewModel({
          source,
          employeeId: input.employeeId,
          summaryJsonPath,
        });
      },
    },
    messageService: serviceForCompany,
    attachmentService: attachmentServiceForCompany,
    directorySource,
    memberRuntimeService: {
      loadMemberRuntime(scopedCompanyId) {
        return loadEmployeesAdminState({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
        });
      },
      async saveMemberRuntimeMember(scopedCompanyId, input) {
        const { availableModels } = await loadPiModelState();
        return saveEmployeeAdminRecord({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          employeeId: input.memberId,
          availableModels,
          ...input,
        });
      },
      setMemberRuntimeEnabled(scopedCompanyId, memberId, enabled, actorMemberId) {
        return setMemberRuntimeLifecycle({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          memberId,
          actorMemberId,
          enabled,
          runtimeProvider: config.runtimeProvider,
        });
      },
      reloadMemberRuntime: config.runtimeProvider
        ? async (_scopedCompanyId, memberId) => {
          const result = await config.runtimeProvider!.reloadWhere((session) =>
            session.employeeId === memberId
          );
          return {
            memberId,
            ...result,
          };
        }
        : undefined,
      reloadAllMemberRuntimes: config.runtimeProvider
        ? async (scopedCompanyId) => {
          const state = await loadEmployeesAdminState({
            repoRoot: config.repoRoot,
            companyId: scopedCompanyId,
          });
          const memberIds = state.employees.filter((employee) => employee.enabled).map((employee) => employee.employeeId);
          const memberIdSet = new Set(memberIds);
          const result = await config.runtimeProvider!.reloadWhere((session) =>
            memberIdSet.has(session.employeeId)
          );
          return {
            memberIds,
            ...result,
          };
        }
        : undefined,
      listEmployeePrivateSkills(scopedCompanyId, memberId) {
        return listEmployeePrivateSkills({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          memberId,
        });
      },
      readEmployeePrivateSkill(scopedCompanyId, memberId, skillId) {
        return readEmployeePrivateSkill({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          memberId,
          skillId,
        });
      },
      saveEmployeePrivateSkill(scopedCompanyId, input) {
        return saveEmployeePrivateSkill({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          memberId: input.memberId,
          skillId: input.skillId,
          content: input.content,
        });
      },
      async listCompanySkills(scopedCompanyId) {
        const result = await listSkillsForCapability({ repoRoot: config.repoRoot, companyId: scopedCompanyId, scope: { kind: "company" } });
        return {
          schema: "company-skills" as const,
          version: 1 as const,
          companyId: scopedCompanyId,
          skillsRootPath: path.join(config.repoRoot, "companies", scopedCompanyId, "skills"),
          skills: result.skills.map((skill) => ({ skillId: skill.name, name: skill.name, path: path.join(config.repoRoot, "companies", scopedCompanyId, "skills", skill.name, "SKILL.md"), relativePath: `${skill.name}/SKILL.md`, exists: true })),
        };
      },
      async readCompanySkill(scopedCompanyId, skillId) {
        const result = await describeSkillForCapability({ repoRoot: config.repoRoot, companyId: scopedCompanyId, scope: { kind: "company" }, skillName: skillId });
        const file = result.files.find((candidate) => candidate.relativePath === "SKILL.md");
        if (!file) throw new Error(`Company Skill ${skillId} has no SKILL.md.`);
        return { schema: "company-skill" as const, version: 1 as const, companyId: scopedCompanyId, skillId, name: skillId, path: path.join(config.repoRoot, "companies", scopedCompanyId, "skills", skillId, "SKILL.md"), relativePath: `${skillId}/SKILL.md`, exists: true, content: file.content, editable: true as const };
      },
      async saveCompanySkill(scopedCompanyId, input) {
        await mutateSkillForCapability({ repoRoot: config.repoRoot, companyId: scopedCompanyId, reloadKey: `company-skill-editor:${input.skillId}:${Date.now()}`, scope: { kind: "company" }, skillName: input.skillId, files: [{ relativePath: "SKILL.md", content: input.content }], mode: "update", scheduleReload: false });
        if (config.runtimeProvider) {
          const state = await loadEmployeesAdminState({ repoRoot: config.repoRoot, companyId: scopedCompanyId });
          const memberIds = new Set(state.employees.filter((employee) => employee.enabled).map((employee) => employee.employeeId));
          await config.runtimeProvider.reloadWhere((session) => memberIds.has(session.employeeId));
        }
        const result = await describeSkillForCapability({ repoRoot: config.repoRoot, companyId: scopedCompanyId, scope: { kind: "company" }, skillName: input.skillId });
        const file = result.files.find((candidate) => candidate.relativePath === "SKILL.md")!;
        return { schema: "company-skill" as const, version: 1 as const, companyId: scopedCompanyId, skillId: input.skillId, name: input.skillId, path: path.join(config.repoRoot, "companies", scopedCompanyId, "skills", input.skillId, "SKILL.md"), relativePath: `${input.skillId}/SKILL.md`, exists: true, content: file.content, editable: true as const };
      },
    },
    runtimeModelsService: {
      async loadRuntimeModels() {
        const modelState = await loadPiModelState();
        return {
          schema: "tinyoffice-runtime-models",
          version: 1,
          availableModels: modelState.availableModels,
          thinkingLevels: EMPLOYEE_THINKING_LEVELS,
        };
      },
    },
    recruitmentService: {
      recruitEmployee(scopedCompanyId, input) {
        const { companyId: _bodyCompanyId, ...employeeInput } = input;
        return recruitEmployee({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          ...employeeInput,
        });
      },
    },
    promptPolicyService: {
      loadPromptPolicy(scopedCompanyId) {
        return loadPromptPolicyViewModel(config.repoRoot, { companyId: scopedCompanyId });
      },
      savePromptPolicyTemplateContent(scopedCompanyId, input) {
        return savePromptPolicyTemplateContent({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          templateId: input.templateId,
          content: input.content,
        });
      },
      resetPromptPolicyTemplateToDefault(scopedCompanyId, templateId) {
        return resetPromptPolicyTemplateToDefault({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          templateId,
        });
      },
      savePromptPolicyBlockContent(scopedCompanyId, input) {
        return savePromptPolicyBlockContent({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          blockPath: input.blockPath,
          title: input.title,
          content: input.content,
        });
      },
      resetPromptPolicyBlockToDefault(scopedCompanyId, blockPath) {
        return resetPromptPolicyBlockToDefault({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          blockPath,
        });
      },
      savePromptPolicyConfig(scopedCompanyId, promptPolicyConfig) {
        return savePromptPolicyConfig({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          config: promptPolicyConfig,
        });
      },
    },
    accessService: {
      loadAccess(scopedCompanyId) {
        return loadToolSafetyViewModel(config.repoRoot, { companyId: scopedCompanyId });
      },
      saveAccessPolicy(scopedCompanyId, policy) {
        return saveToolSafetyPolicy({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
          policy,
        });
      },
      async previewAccessDecision(_scopedCompanyId, input) {
        return previewToolSafetyDecision(input);
      },
      async listAccessRequests(scopedCompanyId) {
        return withAccessRequestService(scopedCompanyId, (service) =>
          service.listAccessRequests(scopedCompanyId)
        );
      },
      async resolveAccessRequest(scopedCompanyId, approvalId, input) {
        return withAccessRequestService(scopedCompanyId, async (service) => {
          const result = await service.resolveAccessRequest(scopedCompanyId, approvalId, input);
          realtimePublisher.publish({
            type: "access.request.changed",
            companyId: scopedCompanyId,
            approvalId: result.request.id,
            status: result.request.status,
            contextKind: result.request.contextKind,
            contextId: result.request.contextId,
          });
          return result;
        });
      },
      async decideAccessToolCall(scopedCompanyId, input) {
        return withAccessRequestService(scopedCompanyId, async (service) => {
          const result = await service.decideAccessToolCall(scopedCompanyId, input);
          if (result.decision === "block") {
            realtimePublisher.publish({
              type: "access.request.changed",
              companyId: scopedCompanyId,
              approvalId: result.request.id,
              status: result.request.status,
              contextKind: result.request.contextKind,
              contextId: result.request.contextId,
            });
          }
          return result;
        });
      },
    },
    doctorService: createTinyOfficeDoctorService({
      loadUpdateStatus() {
        return updateService.loadStatus();
      },
      loadCompanies() {
        return loadCompaniesAdminViewModel({ repoRoot: config.repoRoot });
      },
      loadMemberRuntime(scopedCompanyId) {
        return loadEmployeesAdminState({
          repoRoot: config.repoRoot,
          companyId: scopedCompanyId,
        });
      },
      async loadRuntimeModels() {
        const modelState = await loadPiModelState();
        return {
          schema: "tinyoffice-runtime-models",
          version: 1,
          availableModels: modelState.availableModels,
          thinkingLevels: EMPLOYEE_THINKING_LEVELS,
        };
      },
      loadAccess(scopedCompanyId) {
        return loadToolSafetyViewModel(config.repoRoot, { companyId: scopedCompanyId });
      },
    }),
    channelService: channelServiceForCompany,
    chatProjectionService: async (scopedCompanyId) =>
      new ChatProjectionService({
        conversationSource: await serviceForCompany(scopedCompanyId),
        channelSource: await channelServiceForCompany(scopedCompanyId),
        messageSource: await serviceForCompany(scopedCompanyId),
      }),
    chatCreateEntryService: async (scopedCompanyId) => {
      const messageService = await serviceForCompany(scopedCompanyId);
      const channelService = await channelServiceForCompany(scopedCompanyId);
      const titleGenerationService = await titleGenerationServiceForCompany(scopedCompanyId);
      return new ChatCreateEntryService({
        messageService,
        channelService,
        memberEligibilityResolver: async ({ memberIds }) => {
          const directory = await loadCompanyDirectoryApiSnapshot(config.repoRoot, { companyId: scopedCompanyId });
          const activeMemberIds = new Set(directory.directoryMembers.map((member) => member.memberId));
          return memberIds.filter((memberId) => activeMemberIds.has(memberId));
        },
        projectionService: new ChatProjectionService({
          conversationSource: messageService,
          channelSource: channelService,
          messageSource: messageService,
        }),
        titleGenerationService: {
          requestChatEntryTitleGeneration(request) {
            titleGenerationService.requestChatEntryTitleGeneration(request);
            void titleGenerationService.drain().catch(() => undefined);
          },
        },
      });
    },
    chatRoomMessageService: serviceForCompany,
    processTraceService: {
      listProcessTraceEvents(scopedCompanyId, input) {
        return listProcessTraceEvents(config.repoRoot, scopedCompanyId, {
          processTraceId: input.processTraceId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          sourceMessageId: input.sourceMessageId,
          sessionKey: input.sessionKey,
          limit: input.limit,
        });
      },
    },
    realtimePublisher,
    chatDispatchSink,
    auth: ownerAuth,
  });
  const closeWithoutServiceCleanup = server.close.bind(server);
  server.close = ((callback?: (err?: Error) => void): http.Server => {
    workControlPlaneLoop.stopWorkControlPlaneLoop();
    void Promise.allSettled([
      ...services.values(),
      ...attachmentServices.values(),
      ...channelServices.values(),
      ...titleGenerationServices.values(),
      ...topicSummaryGenerationServices.values(),
    ])
      .then((resolvedServices) => {
        for (const result of resolvedServices) {
          if (result.status === "fulfilled") {
            result.value.close?.();
          }
        }
      })
      .finally(async () => {
        await ownerAuth.close();
        closeWithoutServiceCleanup(callback);
      });
    return server;
  }) as typeof server.close;

  server.on("request", async (req, res) => {
    const requestUrl = req.url ? new URL(req.url, "http://127.0.0.1") : undefined;
    if (requestUrl?.pathname === TINYOFFICE_REALTIME_SOCKET_IO_PATH) {
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, {
        ok: true,
        surface: "tinyoffice-runtime",
        ...(companyId ? { companyId } : {}),
        authentication: "single-owner",
      });
      return;
    }

    if (await handleTinyOfficeApiRequest(req, res, tinyOfficeApi)) {
      return;
    }

    json(res, 404, { error: "TinyOffice route not found." });
  });

  return {
    server,
    ...(companyId ? { companyId } : {}),
    ...(ownerAuth.bootstrapToken ? { bootstrapToken: ownerAuth.bootstrapToken } : {}),
    ...(ownerAuth.localAccessTicket ? { localAccessTicket: ownerAuth.localAccessTicket } : {}),
  };
}
