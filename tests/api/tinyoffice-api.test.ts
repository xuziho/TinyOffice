import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import test from "node:test";

import { createTinyOfficeApi } from "../../src/api/tinyoffice-api.js";
import { handleTinyOfficeApiRequest, isTinyOfficeApiRequest } from "../../src/server/tinyoffice-api-server.js";
import { createTestAuthProvider, type TinyOfficeAuthProvider } from "../../src/auth/tinyoffice-session.js";
import type { TinyOfficeApiOptions } from "../../src/api/tinyoffice-api/contracts.js";
import type { PromptPolicyViewModel } from "../../src/runtime/company-config/prompt-blocks-admin.js";
import type { ToolGuardPolicy, ToolSafetyViewModel } from "../../src/runtime/company-config/tool-guard-admin.js";
import type { RuntimeSessionEvent, RuntimeSessionRecord, RuntimeSessionRepositoryLike } from "../../src/runtime/storage/runtime-session-repository.js";

const fixedNow = "2026-06-26T10:00:00.000Z";
const TEST_CHAT_CHANNEL_ID = "ops";
const TEST_CHANNEL_CONTAINER_ID = `chat-container-channel-${TEST_CHAT_CHANNEL_ID}`;
const tinyOfficeApiComposerUrl = new URL("../../src/api/tinyoffice-api.ts", import.meta.url);
const tinyOfficeApiModuleUrl = new URL("../../src/api/tinyoffice-api/", import.meta.url);

function channelMembers(companyId: string) {
  return [
    {
      schema: "chat-channel-member",
      version: 1,
      companyId,
      chatChannelId: TEST_CHAT_CHANNEL_ID,
      memberId: "xuziho",
      displayName: "Xu",
      role: "owner",
      hasRuntimeProfile: false,
      joinedAt: fixedNow,
    },
    {
      schema: "chat-channel-member",
      version: 1,
      companyId,
      chatChannelId: TEST_CHAT_CHANNEL_ID,
      memberId: "nora-automation",
      displayName: "Nora",
      role: "member",
      hasRuntimeProfile: true,
      joinedAt: fixedNow,
    },
  ] as const;
}

function conversation(companyId: string, conversationId = "conversation-1") {
  return {
    schema: "conversation",
    version: 1,
    companyId,
    conversationId,
    title: "Launch",
    conversationKind: "topic",
    participants: [
      {
        schema: "conversation-participant",
        version: 1,
        companyId,
        conversationId,
        participantId: "participant-xuziho",
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xu",
        joinedAt: fixedNow,
      },
      {
        schema: "conversation-participant",
        version: 1,
        companyId,
        conversationId,
        participantId: "participant-nora",
        participantKind: "company_member",
        memberId: "nora-automation",
        avatarSeed: "nora-automation",
        displayName: "Nora",
        joinedAt: fixedNow,
      },
    ],
    participantStates: [
      {
        schema: "conversation-participant-state",
        version: 1,
        companyId,
        conversationId,
        participantId: "participant-xuziho",
        memberId: "xuziho",
        unreadCount: 1,
        mentionCount: 0,
        updatedAt: fixedNow,
      },
    ],
    lastMessageId: "message-1",
    runtimeLinks: [],
    realtimeSequence: 1,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  } as const;
}

function message(companyId: string, conversationId = "conversation-1", messageId = "message-1", body = "Hello") {
  return {
    schema: "message",
    version: 1,
    companyId,
    conversationId,
    messageId,
    sender: {
      participantId: "participant-xuziho",
      participantKind: "company_member",
      memberId: "xuziho",
      displayName: "Xu",
    },
    body,
    mentions: [],
    attachments: [],
    runtimeLinks: [],
    deliveryState: "sent",
    createdAt: fixedNow,
    updatedAt: fixedNow,
  } as const;
}

function promptPolicyViewModel(companyId: string): PromptPolicyViewModel {
  return {
    contract: {
      name: "prompt-policy",
      version: 1,
      boundary: "scene-runtime-contract",
    },
    routes: {
      htmlPath: "/config/prompt-policy",
      viewModelJsonPath: `/api/companies/${companyId}/prompt-policy`,
      saveBlockPath: `/api/companies/${companyId}/prompt-policy/block`,
      resetBlockPath: `/api/companies/${companyId}/prompt-policy/block/reset`,
      saveTemplatePath: `/api/companies/${companyId}/prompt-policy/template`,
      resetTemplatePath: `/api/companies/${companyId}/prompt-policy/template/reset`,
    },
    config: {
      version: 1,
      always: [],
      scenes: {
        dm_thread: [],
        channel_thread: [],
        intake_event: [],
        work_run_execution: [],
      },
    },
    templates: [{
      id: "base-system-prompt",
      label: "Base System Prompt",
      description: "Stable employee identity and behavior text used as the base system prompt.",
      content: `Base prompt for ${companyId}`,
      defaultContent: "Base prompt default",
      variableHints: ["{employeeId}", "{displayName}", "{role}"],
    }, {
      id: "runtime-prompt-template",
      label: "Runtime Prompt Template",
      description: "Wrapper used to assemble runtime input.",
      content: "Runtime prompt {userMessage}",
      defaultContent: "Runtime prompt default",
      variableHints: ["{sceneType}", "{contextBlocks}", "{userMessage}"],
    }],
    scenes: [{
      id: "dm_thread",
      label: "DM Thread",
      purpose: "Direct employee replies.",
      alwaysBlocks: [],
      sceneBlocks: [],
      effectiveBlockPaths: ["dm-scene"],
      effectivePrompt: "# DM Scene\n\nReply in DM.",
    }],
    availableBlocks: [{
      path: "dm-scene",
      title: "DM Scene",
      sha256: "abc123",
      preview: "Reply in DM.",
      content: "# DM Scene\n\nReply in DM.",
      loadedBy: [{
        scene: "dm_thread",
        label: "DM Thread",
        source: "runtime_default",
      }],
    }],
    diagnostics: {
      errors: [],
      warnings: [],
      unmountedBlocks: [],
    },
  };
}

function accessPolicy(): ToolGuardPolicy {
  return {
    version: 1,
    cwdBoundaryReadMode: "allow",
    cwdBoundaryWriteMode: "allow",
    sensitivePathPatterns: [".env"],
    blockedReadPathPatterns: [],
    protectedWritePathPatterns: [".env"],
    askReadPathPatterns: [],
    askWritePathPatterns: ["node_modules/**"],
    externalWriteAllowPaths: [],
    bashDenyPatterns: ["rm *-rf*"],
    bashAskPatterns: [],
    bashAllowPatterns: ["rg *"],
    denyBashByDefault: false,
  };
}

function accessViewModel(companyId: string, policy = accessPolicy()): ToolSafetyViewModel {
  return {
    contract: {
      name: "access",
      version: 1,
      boundary: "runtime-access-policy",
    },
    routes: {
      htmlPath: "/config/access",
      viewModelJsonPath: "/api/companies/:companyId/access",
      savePolicyPath: "/api/companies/:companyId/access",
      previewPath: "/api/companies/:companyId/access/preview",
    },
    policy,
    policyPath: `PostgreSQL:tool_safety_policies/default:${companyId}`,
    capabilityGroups: [{
      id: "environment-config",
      label: "Environment config",
      summary: "Config files that often contain local secrets or runtime switches.",
      kind: "resource",
      examples: [".env"],
      patterns: [".env"],
      resourcePatterns: [{
        pattern: ".env",
        readRule: "ask",
        readPolicyKey: "sensitivePathPatterns",
        writeRule: "ask",
        writePolicyKey: "protectedWritePathPatterns",
      }],
      readRule: "ask",
      writeRule: "ask",
      readAskPolicyKey: "sensitivePathPatterns",
      writeAskPolicyKey: "protectedWritePathPatterns",
      policyKeys: ["sensitivePathPatterns", "protectedWritePathPatterns"],
    }, {
      id: "dangerous-commands",
      label: "Dangerous commands",
      summary: "High-risk shell commands and the default policy for unmatched commands.",
      kind: "command",
      examples: ["rm *-rf*"],
      patterns: ["rm *-rf*", "rg *"],
      commandRule: "deny",
      defaultDenyBash: false,
      commandPatterns: {
        deny: ["rm *-rf*"],
        ask: [],
        allow: ["rg *"],
      },
      policyKeys: ["bashDenyPatterns", "bashAskPatterns", "bashAllowPatterns", "denyBashByDefault"],
    }],
    previewExamples: [{
      label: "Sensitive read",
      input: { operation: "read", targetPath: ".env" },
      result: {
        operation: "read",
        target: ".env",
        decision: "ask",
        matchedPolicy: "sensitivePathPatterns",
        reason: "Access requires confirmation for sensitive path read: .env",
      },
    }],
    advancedEditor: {
      policyJson: JSON.stringify(policy, null, 2),
    },
  };
}

async function withServer(
  run: (baseUrl: string, calls: string[], realtimeEvents: Array<{ type: string; companyId: string }>) => Promise<void>,
  auth: TinyOfficeAuthProvider = createTestAuthProvider({
    userId: "xuziho",
    displayName: "Xu Ziho",
    currentCompanyId: "acme",
    companyId: "acme",
    member: { memberId: "xuziho", displayName: "Xu", role: "boss" },
    source: "test-session",
  }),
  overrides: Partial<TinyOfficeApiOptions> = {},
) {
  const calls: string[] = [];
  const realtimeEvents: Array<{ type: string; companyId: string }> = [];
  const app = createTinyOfficeApi({
    ...overrides,
    realtimePublisher: {
      publish(event) {
        realtimeEvents.push(event);
        return {
          schema: "tinyoffice-realtime-event",
          version: 1,
          eventId: `event-${realtimeEvents.length}`,
          occurredAt: fixedNow,
          sequence: realtimeEvents.length,
          ...event,
        };
      },
    },
    companyLifecycleService: {
      async loadCompanies() {
        calls.push("companies:list");
        return {
          contract: {
            name: "company-lifecycle",
            version: 1,
            boundary: "company-lifecycle",
          },
          routes: {
            htmlPath: "/company",
            companiesJsonPath: "/api/companies",
            createCompanyPath: "/api/companies",
            deleteCompanyPath: "/api/companies/:companyId",
          },
          companies: [{
            companyId: "acme",
            displayName: "Acme",
            createdAt: fixedNow,
            updatedAt: fixedNow,
          }],
        };
      },
      async createCompany(input) {
        calls.push(`companies:create:${String(input.displayName)}:${String(input.ownerMemberId)}:${String(input.ownerDisplayName)}`);
        return {
          company: {
            companyId: "globex",
            displayName: String(input.displayName),
            createdAt: fixedNow,
            updatedAt: fixedNow,
          },
          hr: {
            companyId: "globex",
            displayName: String(input.displayName),
            hrEmployeeId: "avery-owner",
            hrEmployeeDisplayName: String(input.hrEmployeeDisplayName),
            hrEmployeeHomePath: "/companies/globex/employees/avery-owner",
            hrEmployeeWorkspacePath: "/companies/globex/employees/avery-owner/workspace",
          },
          owner: {
            memberId: String(input.ownerMemberId),
            displayName: String(input.ownerDisplayName),
            role: "boss",
          },
          viewModel: await this.loadCompanies(),
        };
      },
      async updateCompanyProfile(input) {
        calls.push(`companies:update:${input.companyId}:${String(input.displayName)}`);
        return this.loadCompanies();
      },
      async deleteCompany(input, runtime) {
        calls.push(`companies:delete:${input.companyId}`);
        await runtime?.ensureSafeToDeleteCompany(input.companyId);
        return {
          companyId: input.companyId,
          deletedAssetPath: `/companies/${input.companyId}`,
          viewModel: await this.loadCompanies(),
        };
      },
      async saveSystemAiSettings(input) {
        calls.push([
          "companies:system-ai",
          input.companyId,
          String(input.settings?.chatTitleGeneration?.modelProvider),
          String(input.settings?.chatTitleGeneration?.modelId),
          String(input.settings?.chatTopicSummary?.modelProvider),
          String(input.settings?.chatTopicSummary?.modelId),
        ].join(":"));
        return this.loadCompanies();
      },
      deletionGuard: {
        async ensureSafeToDeleteCompany(companyId) {
          calls.push(`companies:guard:${companyId}`);
        },
      },
      async switchCurrentCompany(session, input) {
        calls.push(`companies:switch:${session.userId}:${String(input.companyId)}`);
        if (input.companyId !== "acme" && input.companyId !== "globex") {
          throw new Error("Current user is not a member of the requested Company");
        }
        return {
          ...session,
          currentCompanyId: String(input.companyId),
          member: {
            memberId: session.userId,
            displayName: session.displayName,
            role: input.companyId === "globex" ? "admin" : "boss",
          },
        };
      },
      async resolveCurrentUserSession(session) {
        if (session.currentCompanyId && session.member) {
          return session;
        }
        if (session.userId !== "xuziho") {
          return session;
        }
        return {
          ...session,
          currentCompanyId: "acme",
          member: {
            memberId: "xuziho",
            displayName: "Xu",
            role: "boss",
          },
        };
      },
    },
    tasksViewModelService: {
      async loadTasksViewModel(companyId, input) {
        calls.push(`tasks:${companyId}:${input.requestUrl.searchParams.get("view") || "none"}`);
        return {
          contract: {
            name: "tasks",
            version: 3,
            productBoundary: "task-aggregate",
          },
          routes: {
            htmlPath: "/tasks",
            viewModelJsonPath: `/api/companies/${companyId}/tasks/view-model`,
            runActionPathPrefix: `/api/companies/${companyId}/tasks/runs`,
          },
          refresh: {
            indexIntervalMs: 5000,
            detailIntervalMs: 2500,
          },
          filters: {
            view: "tasks",
            status: "all",
            sort: "recent",
          },
          statusOptions: [],
          sortOptions: [],
          summary: {
            runningRunCount: 0,
            blockedRunCount: 0,
            dispatchFailedCount: 0,
            activeTaskCount: 0,
            enabledScheduleCount: 0,
            participantInputCount: 0,
          },
          tasks: [],
          selected: { kind: undefined },
        };
      },
    },
    tasksRunActionService: {
      async executeTasksRunAction(companyId, input) {
        calls.push(`tasks-action:${companyId}:${input.workRunId}:${input.actionId}:${input.actorMemberId || "none"}:${input.reason || "none"}`);
        if (input.actionId === "retry-dispatch") {
          const error = new Error("Retry dispatch is only available for queued runs with a failed dispatch lease.") as Error & { statusCode: number };
          error.statusCode = 409;
          throw error;
        }
        return {
          accepted: true,
          actionId: input.actionId,
          workRunId: input.workRunId,
          status: input.actionId === "cancel-run" ? "canceled" : "in_progress",
          message: `${input.actionId} accepted`,
        };
      },
    },
    workCreationService: {
      async createWork(companyId, input) {
        calls.push(`work:create:${companyId}:${input.title}:${input.createdByMemberId}:${input.ownerMemberId}:${input.trigger.kind}`);
        return {
          task: {
            id: "work-task-api-1",
            companyId,
            title: input.title,
            description: input.description,
            createdByMemberId: input.createdByMemberId,
            ownerMemberId: input.ownerMemberId,
            sourceKind: input.sourceKind,
            sourceId: input.sourceId,
            requesterId: input.requesterId,
            status: "active",
            acceptanceCriteria: input.acceptanceCriteria,
            metadata: { kind: input.trigger.kind },
            createdAt: fixedNow,
            updatedAt: fixedNow,
          },
          ...(input.trigger.kind === "immediate"
            ? {
                run: {
                  id: "work-run-api-1",
                  companyId,
                  workTaskId: "work-task-api-1",
                  assigneeMemberId: input.ownerMemberId,
                  status: "queued",
                  triggeredBy: "immediate",
                  createdAt: fixedNow,
                  updatedAt: fixedNow,
                },
              }
            : {}),
        };
      },
      async cancelWorkTask(companyId, input) {
        calls.push(`work:cancel:${companyId}:${input.workTaskId}:${input.actorMemberId}:${input.reason || "none"}`);
        return {
          task: {
            id: input.workTaskId,
            title: "Publish weekly social update",
            ownerMemberId: "iris-growth",
            createdByMemberId: "xuziho",
            sourceKind: "manual",
            sourceId: "manual",
            status: "canceled",
            acceptanceCriteria: "Done.",
            canceledReason: input.reason,
            createdAt: fixedNow,
            updatedAt: fixedNow,
          },
          schedules: [],
          runs: [],
        };
      },
      async archiveWorkTask(companyId, input) {
        calls.push(`work:archive:${companyId}:${input.workTaskId}:${input.actorMemberId}:${input.reason || "none"}`);
        return {
          task: {
            id: input.workTaskId,
            title: "Publish weekly social update",
            ownerMemberId: "iris-growth",
            createdByMemberId: "xuziho",
            sourceKind: "manual",
            sourceId: "manual",
            status: "archived",
            acceptanceCriteria: "Done.",
            createdAt: fixedNow,
            updatedAt: fixedNow,
          },
          schedules: [],
          runs: [],
        };
      },
      async restoreWorkTask(companyId, input) {
        calls.push(`work:restore:${companyId}:${input.workTaskId}:${input.actorMemberId}`);
        return {
          task: {
            id: input.workTaskId,
            title: "Publish weekly social update",
            ownerMemberId: "iris-growth",
            createdByMemberId: "xuziho",
            sourceKind: "manual",
            sourceId: "manual",
            status: "canceled",
            acceptanceCriteria: "Done.",
            createdAt: fixedNow,
            updatedAt: fixedNow,
          },
          schedules: [],
          runs: [],
        };
      },
    },
    intakeEventService: {
      async ingestIntakeEvent(companyId, input) {
        const record = input && typeof input === "object"
          ? input as { category?: unknown; routing?: { targetMemberId?: unknown }; sourceEventId?: unknown }
          : {};
        calls.push([
          "intake",
          companyId,
          String(record.category),
          String(record.routing?.targetMemberId),
          String(record.sourceEventId),
        ].join(":"));
        return {
          status: "processed",
          eventId: "intake-event-api-1",
          category: String(record.category),
          result: {
            kind: "intake_event_routed",
            category: String(record.category),
            targetMemberId: String(record.routing?.targetMemberId),
          },
        };
      },
    },
    sessionExplorerService: {
      async loadSessionExplorerViewModel(companyId, input) {
        calls.push(`sessions:${companyId}:${input.query || "none"}:${input.employeeId || "none"}:${input.sessionId || "none"}:${input.employeeIdFilter || "none"}`);
        return {
          contract: {
            name: "session-explorer",
            version: 1,
            runtimeBoundary: "runtime-session-inspector",
          },
          routes: {
            indexJsonPath: `/api/companies/${companyId}/sessions/view-model`,
            detailJsonPath: `/api/companies/${companyId}/sessions/view-model`,
            viewModelJsonPath: `/api/companies/${companyId}/sessions/view-model`,
          },
          refresh: {
            strategy: "runtime-events",
            snapshotUses: ["initial-load"],
            eventSources: ["session"],
            expectsRunningSessions: true,
            expectsIncrementalDetailEvents: true,
          },
          filters: {
            query: input.query || "",
            employeeIdFilter: input.employeeIdFilter || "",
          },
          index: {
            generatedAt: fixedNow,
            employeeCount: 0,
            sessionCount: 0,
            sessions: [],
          },
          selectedSession: null,
          list: {
            mode: "flat",
            sessions: [],
            queryMatchedSessionCount: 0,
            employeeFilters: [],
          },
          sections: [],
        };
      },
    },
    employeeRuntimeSummaryService: {
      async loadEmployeeRuntimeSummary(companyId, input) {
        calls.push(`runtime-summary:${companyId}:${input.employeeId || "none"}`);
        return {
          contract: {
            name: "employee-runtime-summary",
            version: 1,
            productBoundary: "chat-employee-context-runtime-summary",
          },
          routes: {
            summaryJsonPath: `/api/companies/${companyId}/employees/runtime-summary`,
          },
          generatedAt: fixedNow,
          employees: [{
            employeeId: "nora-automation",
            displayName: "Nora",
            role: "automation",
            status: {
              kind: "blocked",
              label: "Blocked",
              reason: "Need source credentials.",
              updatedAt: fixedNow,
            },
            counts: {
              pendingApprovalCount: 0,
              blockedWorkRunCount: 1,
              activeWorkRunCount: 1,
              activeTaskCount: 1,
              recentFailureCount: 0,
            },
            current: [{
              kind: "work-run",
              id: "run-1",
              title: "Launch check",
              status: "blocked",
              updatedAt: fixedNow,
              summary: "Need source credentials.",
            }],
          }],
        };
      },
    },
    directorySource: {
      async loadCompanyDirectory(companyId) {
        calls.push("directory");
        return {
          schema: "company-directory",
          version: 1,
          companyId,
          directoryMembers: [{
            schema: "company-directory-member-entry",
            version: 1,
            companyId,
            memberId: "xuziho",
            selector: { kind: "member", memberId: "xuziho" },
            displayName: "Xu",
            hasRuntimeProfile: false,
          }, {
            schema: "company-directory-member-entry",
            version: 1,
            companyId,
            memberId: "nora-automation",
            selector: { kind: "member", memberId: "nora-automation" },
            displayName: "Nora",
            role: "automation",
            summary: "Runtime-capable automation member.",
            hasRuntimeProfile: true,
          }],
        };
      },
    },
    memberRuntimeService: {
      async loadMemberRuntime(companyId) {
        calls.push(`member-runtime:${companyId}`);
        return {
          employees: [{
            employeeId: "nora-automation",
            enabled: true,
            profile: {
              employeeId: "nora-automation",
              displayName: "Nora",
              role: "automation",
              presenceMode: "resident",
            },
            resourcePolicy: {
              version: 1,
              filesystem: {
                ownWorkspace: "allow",
                otherEmployeeWorkspace: "approval",
                repo: "approval",
                secrets: "deny",
              },
            },
            runtime: {
              version: 1,
              modelProvider: "openai",
              modelId: "gpt-5",
              thinkingLevel: "minimal",
            },
            localAssets: {
              homePath: "/companies/acme/employees/nora-automation",
              workspacePath: "/companies/acme/employees/nora-automation/workspace",
              skillPaths: ["/companies/acme/skills"],
              instructionFiles: [{
                location: "employee_home",
                name: "AGENTS.md",
                path: "/companies/acme/employees/nora-automation/AGENTS.md",
                relativePath: "AGENTS.md",
                exists: true,
                content: "Use concise updates.\n",
                editable: true,
              }],
            },
          }],
          availableModels: [{
            provider: "openai",
            id: "gpt-5",
            name: "GPT-5",
            reasoning: true,
          }],
          presenceModes: ["resident", "auto_exit_idle"],
          thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
        };
      },
      async saveMemberRuntimeMember(companyId, input) {
        calls.push(`member-runtime-save:${companyId}:${input.memberId}`);
        return this.loadMemberRuntime(companyId);
      },
      async setMemberRuntimeEnabled(companyId, memberId, enabled, actorMemberId) {
        calls.push(`member-runtime-lifecycle:${companyId}:${memberId}:${enabled}:${actorMemberId}`);
        return this.loadMemberRuntime(companyId);
      },
      async reloadMemberRuntime(companyId, memberId) {
        calls.push(`member-runtime-reload:${companyId}:${memberId}`);
        return {
          memberId,
          reloadedCount: 1,
          sessionKeys: ["session-1"],
        };
      },
      async reloadAllMemberRuntimes(companyId) {
        calls.push(`member-runtime-reload-all:${companyId}`);
        return {
          memberIds: ["nora-automation"],
          reloadedCount: 1,
          sessionKeys: ["session-1"],
        };
      },
      async listEmployeePrivateSkills(companyId, memberId) {
        calls.push(`member-runtime-skills:${companyId}:${memberId}`);
        return {
          schema: "employee-private-skills",
          version: 1,
          companyId,
          memberId,
          skillsRootPath: `/companies/${companyId}/employees/${memberId}/skills`,
          skills: [{
            skillId: "weekly-automation-audit",
            name: "weekly-automation-audit",
            path: `/companies/${companyId}/employees/${memberId}/skills/weekly-automation-audit/SKILL.md`,
            relativePath: "weekly-automation-audit/SKILL.md",
            exists: true,
          }],
        };
      },
      async readEmployeePrivateSkill(companyId, memberId, skillId) {
        calls.push(`member-runtime-skill-read:${companyId}:${memberId}:${skillId}`);
        return {
          schema: "employee-private-skill",
          version: 1,
          companyId,
          memberId,
          skillId,
          name: skillId,
          path: `/companies/${companyId}/employees/${memberId}/skills/${skillId}/SKILL.md`,
          relativePath: `${skillId}/SKILL.md`,
          exists: true,
          content: "---\nname: weekly-automation-audit\n---\n\nAudit weekly automation workflows.\n",
          editable: true,
        };
      },
      async saveEmployeePrivateSkill(companyId, input) {
        calls.push(`member-runtime-skill-save:${companyId}:${input.memberId}:${input.skillId}`);
        return {
          schema: "employee-private-skill",
          version: 1,
          companyId,
          memberId: input.memberId,
          skillId: input.skillId,
          name: input.skillId,
          path: `/companies/${companyId}/employees/${input.memberId}/skills/${input.skillId}/SKILL.md`,
          relativePath: `${input.skillId}/SKILL.md`,
          exists: true,
          content: input.content.endsWith("\n") ? input.content : `${input.content}\n`,
          editable: true,
        };
      },
    } as any,
    runtimeModelsService: {
      async loadRuntimeModels() {
        calls.push("runtime-models");
        return {
          schema: "tinyoffice-runtime-models",
          version: 1,
          availableModels: [{
            provider: "openai",
            id: "gpt-5",
            name: "GPT-5",
            reasoning: true,
          }],
          thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
        };
      },
    },
    recruitmentService: {
      async recruitEmployee(companyId, input) {
        calls.push(`recruit:${companyId}:${input.employeeId}`);
        return {
          schema: "tinyoffice-recruit-employee-result",
          version: 1,
          companyId,
          employee: {
            employeeId: input.employeeId,
            enabled: true,
            profile: {
              employeeId: input.employeeId,
              displayName: input.displayName,
              role: input.role,
              presenceMode: input.presenceMode || "resident",
            },
            resourcePolicy: {
              version: 1,
              filesystem: {
                ownWorkspace: "allow",
                otherEmployeeWorkspace: "approval",
                repo: "approval",
                secrets: "deny",
              },
            },
            runtime: input.runtime,
          },
          localAssets: {
            homePath: `/companies/${companyId}/employees/${input.employeeId}`,
            workspacePath: `/companies/${companyId}/employees/${input.employeeId}/workspace`,
            instructionPath: `/companies/${companyId}/employees/${input.employeeId}/AGENTS.md`,
            skillsPath: `/companies/${companyId}/employees/${input.employeeId}/skills`,
          },
        };
      },
    },
    promptPolicyService: {
      async loadPromptPolicy(companyId) {
        calls.push(`prompt-policy:${companyId}`);
        return promptPolicyViewModel(companyId);
      },
      async savePromptPolicyTemplateContent(companyId, input) {
        calls.push(`prompt-policy-template-save:${companyId}:${input.templateId}`);
        return {
          ...promptPolicyViewModel(companyId),
          templates: promptPolicyViewModel(companyId).templates.map((template) =>
            template.id === input.templateId ? { ...template, content: input.content } : template
          ),
        };
      },
      async resetPromptPolicyTemplateToDefault(companyId, templateId) {
        calls.push(`prompt-policy-template-reset:${companyId}:${templateId}`);
        return promptPolicyViewModel(companyId);
      },
      async savePromptPolicyBlockContent(companyId, input) {
        calls.push(`prompt-policy-block-save:${companyId}:${input.blockPath}`);
        return {
          ...promptPolicyViewModel(companyId),
          availableBlocks: promptPolicyViewModel(companyId).availableBlocks.map((block) =>
            block.path === input.blockPath ? { ...block, content: input.content } : block
          ),
        };
      },
      async resetPromptPolicyBlockToDefault(companyId, blockPath) {
        calls.push(`prompt-policy-block-reset:${companyId}:${blockPath}`);
        return promptPolicyViewModel(companyId);
      },
      async savePromptPolicyConfig(companyId) {
        calls.push(`prompt-policy-config-save:${companyId}`);
        return promptPolicyViewModel(companyId);
      },
    },
    accessService: {
      async loadAccess(companyId) {
        calls.push(`access:${companyId}`);
        return accessViewModel(companyId);
      },
      async saveAccessPolicy(companyId, policy) {
        calls.push(`access-save:${companyId}`);
        return accessViewModel(companyId, policy as ToolGuardPolicy);
      },
      async previewAccessDecision(companyId, input) {
        calls.push(`access-preview:${companyId}:${input.operation}`);
        return {
          operation: input.operation,
          target: input.operation === "bash" ? String(input.command) : String(input.targetPath),
          decision: input.operation === "bash" ? "deny" : "ask",
          matchedPolicy: input.operation === "bash" ? "bashDenyPatterns" : "sensitivePathPatterns",
          reason: "Access preview from test service",
        };
      },
      async listAccessRequests(companyId) {
        calls.push(`access-requests:${companyId}`);
        return {
          schema: "tinyoffice.access-requests",
          version: 1,
          companyId,
          requests: [{
            id: "approval-1",
            status: "pending",
            requestedByMemberId: "avery",
            requestedAction: "read",
            requestedResource: ".env",
            reason: "Sensitive path read requires approval.",
            contextKind: "channel_topic",
            contextId: "room-1",
            sessionKey: "avery|channel_topic|room-1",
            createdAt: fixedNow,
            actions: ["allow_once", "allow_in_context", "reject"],
          }],
        };
      },
      async resolveAccessRequest(companyId, approvalId, input) {
        calls.push(`access-request-resolve:${companyId}:${approvalId}:${input.decision}:${input.note || ""}`);
        return {
          request: {
            id: approvalId,
            status: input.decision === "reject" ? "rejected" : "approved",
            requestedByMemberId: "avery",
            requestedAction: "read",
            requestedResource: ".env",
            reason: "Sensitive path read requires approval.",
            contextKind: "channel_topic",
            contextId: "room-1",
            sessionKey: "avery|channel_topic|room-1",
            decisionNote: input.note,
            resolvedAt: fixedNow,
            createdAt: fixedNow,
            actions: [],
          },
          ...(input.decision === "reject" ? {} : {
            grant: {
              id: "grant-1",
              approvalId,
              memberId: "avery",
              action: "read",
              resource: ".env",
              scope: input.decision === "allow_once" ? "one_time" : "session",
              contextKind: "channel_topic",
              contextId: "room-1",
              createdAt: fixedNow,
            },
          }),
        };
      },
      async decideAccessToolCall(companyId, input) {
        calls.push(`access-tool-call:${companyId}:${input.memberId}:${input.action}:${input.resource || ""}`);
        return {
          decision: "block",
          reason: input.reason,
          request: {
            id: "approval-tool-call-1",
            status: "pending",
            requestedByMemberId: input.memberId,
            requestedAction: input.action,
            requestedResource: input.resource,
            requestedInputSnapshot: input.requestedInputSnapshot,
            reason: input.reason,
            contextKind: input.contextKind,
            contextId: input.contextId,
            sessionKey: input.sessionKey,
            createdAt: fixedNow,
            actions: ["allow_once", "allow_in_context", "reject"],
          },
        };
      },
    },
    doctorService: {
      async loadDoctorReport(companyId) {
        calls.push(`doctor:${companyId}`);
        return {
          schema: "tinyoffice-doctor-report",
          version: 1,
          companyId,
          generatedAt: fixedNow,
          overallStatus: "ok",
          counts: {
            fail: 0,
            warn: 0,
            ok: 1,
            info: 0,
          },
          sections: [{
            id: "core",
            label: "Core",
            status: "ok",
            checks: [{
              id: "core.api",
              label: "Runtime API",
              status: "ok",
              summary: "Runtime API is reachable.",
            }],
          }],
          nextSteps: [],
        };
      },
    },
    async messageService() {
      return {
        async listConversations(companyId, viewer) {
          calls.push(`list:${viewer.memberId || viewer.employeeId}`);
          return { conversations: [conversation(companyId)] };
        },
        async createConversation(companyId) {
          calls.push("create-conversation");
          return conversation(companyId, "conversation-created");
        },
        async getConversation(companyId, conversationId) {
          calls.push(`get:${conversationId}`);
          return conversation(companyId, conversationId);
        },
        async listMessages(companyId, conversationId) {
          calls.push(`messages:${conversationId}`);
          return { messages: [message(companyId, conversationId)] };
        },
        async sendMessage(companyId, conversationId, actor, body) {
          calls.push(`send:${actor.memberId || actor.employeeId}`);
          return {
            message: message(companyId, conversationId, "message-2", body),
            conversation: conversation(companyId, conversationId),
            realtimeEvent: {
              schema: "conversation-message-realtime-event",
              version: 1,
              eventId: "event-message",
              type: "message.created",
              occurredAt: fixedNow,
              sequence: 2,
              companyId,
              conversationId,
              messageId: "message-2",
              payload: {},
            },
          };
        },
        async markConversationRead(companyId, conversationId, viewer) {
          calls.push(`read:${viewer.memberId || viewer.employeeId}`);
          return {
            conversation: {
              ...conversation(companyId, conversationId),
              participantStates: [{
                ...conversation(companyId, conversationId).participantStates[0],
                unreadCount: 0,
                lastReadMessageId: "message-2",
              }],
            },
            realtimeEvent: {
              schema: "conversation-message-realtime-event",
              version: 1,
              eventId: "event-read",
              type: "participant.read_state.updated",
              occurredAt: fixedNow,
              sequence: 3,
              companyId,
              conversationId,
              payload: {},
            },
          };
        },
      };
    },
    attachmentService: {
      attachments: new Map<string, {
        companyId: string;
        attachmentId: string;
        ownerMemberId: string;
        fileName: string;
        mimeType: "image/png" | "image/jpeg" | "image/webp";
        byteLength: number;
        storageKey: string;
        contentSha256: string;
        createdAt: string;
        localPath: string;
        bytes: Uint8Array;
      }>(),
      async uploadChatImageAttachment(companyId, input) {
        calls.push(`attachment-upload:${companyId}:${input.fileName}:${input.mimeType}:${input.ownerMemberId}`);
        if (input.mimeType !== "image/png" && input.mimeType !== "image/jpeg" && input.mimeType !== "image/webp") {
          throw new Error(`unsupported Chat image attachment MIME type: ${input.mimeType}`);
        }
        const attachmentId = "att-test";
        const record = {
          schema: "chat-attachment" as const,
          version: 1 as const,
          companyId,
          attachmentId,
          ownerMemberId: input.ownerMemberId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          byteLength: input.bytes.byteLength,
          storageKey: `companies/${companyId}/chat-attachments/${attachmentId}/original`,
          contentSha256: "sha",
          createdAt: fixedNow,
          localPath: "D:/private/att-test",
          bytes: input.bytes,
        };
        this.attachments.set(`${companyId}:${attachmentId}`, record);
        return {
          schema: record.schema,
          version: record.version,
          companyId: record.companyId,
          attachmentId: record.attachmentId,
          ownerMemberId: record.ownerMemberId,
          fileName: record.fileName,
          mimeType: record.mimeType,
          byteLength: record.byteLength,
          storageKey: record.storageKey,
          contentSha256: record.contentSha256,
          previewUrl: `/api/companies/${companyId}/chat/attachments/${attachmentId}/content`,
          downloadUrl: `/api/companies/${companyId}/chat/attachments/${attachmentId}/content?download=1`,
          createdAt: record.createdAt,
        };
      },
      async getChatAttachment(companyId, attachmentId) {
        const record = this.attachments.get(`${companyId}:${attachmentId}`);
        if (!record) {
          return undefined;
        }
        const { bytes: _bytes, ...attachment } = record;
        return attachment;
      },
      async listChatAttachmentReferenceConversationIds(companyId, attachmentId) {
        const record = this.attachments.get(`${companyId}:${attachmentId}`);
        return record?.fileName === "referenced.png" ? ["conversation-1"] : [];
      },
      async readChatAttachment(record) {
        const stored = this.attachments.get(`${record.companyId}:${record.attachmentId}`);
        if (!stored) {
          throw new Error(`Attachment not found: ${record.attachmentId}`);
        }
        return stored.bytes;
      },
      async discardChatAttachment(companyId, input) {
        calls.push(`attachment-discard:${companyId}:${input.attachmentId}:${input.ownerMemberId}`);
        const key = `${companyId}:${input.attachmentId}`;
        const record = this.attachments.get(key);
        if (!record || record.ownerMemberId !== input.ownerMemberId) {
          throw new Error(`Chat attachment cannot be discarded because it is referenced or unavailable: ${input.attachmentId}`);
        }
        this.attachments.delete(key);
      },
    },
    async chatProjectionService() {
      return {
        async listChatProjection(companyId, viewer) {
          calls.push(`projection:${viewer.memberId || viewer.employeeId}`);
          return {
            containers: [{
              schema: "chat-container",
              version: 1,
              companyId,
              containerId: TEST_CHANNEL_CONTAINER_ID,
              chatChannelId: TEST_CHAT_CHANNEL_ID,
              kind: "channel",
              title: "Ops",
              unreadCount: 0,
              mentionCount: 0,
              entryCount: 1,
              members: channelMembers(companyId),
              runtimeLinks: [],
            }],
            entries: [{
              schema: "chat-entry",
              version: 1,
              companyId,
              entryId: "chat-entry-topic",
              kind: "channel_topic",
              parentContainerId: TEST_CHANNEL_CONTAINER_ID,
              title: "Launch",
              titleStatus: "manual",
              unreadCount: 0,
              mentionCount: 0,
              openTarget: { kind: "topic_room", roomId: "conversation-1" },
              runtimeLinks: [],
              updatedAt: fixedNow,
            }],
          };
        },
      };
    },
    async chatCreateEntryService() {
      return {
        async createEntry(input) {
          calls.push(`entry:${input.actorMemberId}`);
          return {
            schema: "chat-create-entry-result",
            version: 1,
            companyId: input.companyId,
            container: {
              schema: "chat-container",
              version: 1,
              companyId: input.companyId,
              containerId: input.containerId,
              chatChannelId: TEST_CHAT_CHANNEL_ID,
              kind: "channel",
              title: "Ops",
              unreadCount: 0,
              mentionCount: 0,
              entryCount: 1,
              members: channelMembers(input.companyId),
              runtimeLinks: [],
            },
            entry: {
              schema: "chat-entry",
              version: 1,
              companyId: input.companyId,
              entryId: "chat-entry-created",
              kind: "channel_topic",
              parentContainerId: input.containerId,
              title: input.title || "New topic",
              titleStatus: "manual",
              unreadCount: 0,
              mentionCount: 0,
              openTarget: { kind: "topic_room", roomId: "conversation-created" },
              runtimeLinks: [],
              updatedAt: fixedNow,
            },
            openTarget: { kind: "topic_room", roomId: "conversation-created" },
            firstMessageId: "message-created",
          };
        },
      };
    },
    channelService: async () => ({
      async listChannelsForViewer(companyId, viewer) {
        calls.push(`channels:list:${viewer.memberId}`);
        return [{
          companyId,
          chatChannelId: TEST_CHAT_CHANNEL_ID,
          title: "Ops",
          summary: "Operations Channel",
          members: [...channelMembers(companyId)],
          createdAt: fixedNow,
          updatedAt: fixedNow,
        }];
      },
      async createChannel(input) {
        calls.push(`channels:create:${input.actor.memberId}`);
        return {
          companyId: input.companyId,
          chatChannelId: TEST_CHAT_CHANNEL_ID,
          title: input.title,
          summary: input.summary,
          members: [...channelMembers(input.companyId)],
          createdAt: fixedNow,
          updatedAt: fixedNow,
        };
      },
      async addMembers(input) {
        calls.push(`channels:add:${input.actor.memberId}:${input.members.length}`);
        return {
          companyId: input.companyId,
          chatChannelId: input.channelId,
          title: "Ops",
          summary: "Operations Channel",
          members: [...channelMembers(input.companyId), ...input.members.map((member) => ({
            schema: "chat-channel-member" as const,
            version: 1 as const,
            companyId: input.companyId,
            chatChannelId: input.channelId,
            memberId: member.memberId,
            displayName: member.displayName,
            hasRuntimeProfile: member.hasRuntimeProfile ?? false,
            joinedAt: fixedNow,
          }))],
          createdAt: fixedNow,
          updatedAt: fixedNow,
        };
      },
      async updateDetails(input) {
        calls.push(`channels:update:${input.actor.memberId}:${input.title}:${input.summary}`);
        return {
          companyId: input.companyId,
          chatChannelId: input.channelId,
          title: input.title,
          summary: input.summary,
          members: channelMembers(input.companyId),
          createdAt: fixedNow,
          updatedAt: fixedNow,
        };
      },
      async removeMember(input) {
        calls.push(`channels:remove:${input.actor.memberId}:${input.member.memberId}`);
        return {
          companyId: input.companyId,
          chatChannelId: input.channelId,
          title: "Ops",
          summary: "Operations Channel",
          members: channelMembers(input.companyId).filter((member) => member.memberId !== input.member.memberId),
          createdAt: fixedNow,
          updatedAt: fixedNow,
        };
      },
      async dissolveChannel(input) {
        calls.push(`channels:dissolve:${input.actor.memberId}:${input.confirmation}`);
        return {
          companyId: input.companyId,
          chatChannelId: input.channelId,
          dissolved: true,
        };
      },
    }) as never,
      chatRoomMessageService: async (companyId) => ({
      async getConversation(_companyId: string, conversationId: string) {
        calls.push(`chat-get:${conversationId}`);
        return conversation(companyId, conversationId);
      },
      async listMessages(_companyId: string, conversationId: string) {
        calls.push(`chat-messages:${conversationId}`);
        const listed = message(companyId, conversationId);
        return {
          messages: [
            conversationId === "conversation-runtime-usage"
              ? {
                  ...listed,
                  sender: {
                    participantId: "participant-nora",
                    participantKind: "company_member",
                    memberId: "nora-automation",
                    displayName: "Nora",
                  },
                  runtimeLinks: [{
                    schema: "conversation-runtime-link",
                    version: 1,
                    companyId,
                    conversationId,
                    linkId: "message-runtime-session",
                    targetKind: "session",
                    targetId: "session-runtime-usage",
                    label: "Owned Chat employee reply",
                    messageId: listed.messageId,
                    sourceMessageId: "message-source",
                    createdAt: fixedNow,
                  }],
                }
              : listed,
          ],
        };
      },
      async sendMessage(
        _companyId: string,
        conversationId: string,
        actor: { memberId?: string; employeeId?: string },
        body: string,
        options?: { mentionedMemberIds?: string[] },
      ) {
        calls.push(`chat-send:${actor.memberId || actor.employeeId}:${options?.mentionedMemberIds?.join(",") || "none"}`);
        return {
          message: {
            ...message(companyId, conversationId, "message-chat", body),
            mentions: (options?.mentionedMemberIds || []).map((memberId) => ({
              schema: "message-mention",
              version: 1,
              companyId,
              conversationId,
              messageId: "message-chat",
              memberId,
              createdAt: fixedNow,
            })),
          },
          conversation: conversation(companyId, conversationId),
        };
      },
      async markConversationRead(_companyId: string, conversationId: string, viewer: { memberId?: string; employeeId?: string }) {
        calls.push(`chat-read:${viewer.memberId || viewer.employeeId}`);
        return { conversation: conversation(companyId, conversationId) };
      },
      async updateConversationTitle(
        _companyId: string,
        conversationId: string,
        input: { title: string; titleStatus: "manual" | "generated" | "untitled" },
      ) {
        calls.push(`chat-title:${conversationId}:${input.title}:${input.titleStatus}`);
        const current = conversation(companyId, conversationId);
        return {
          ...current,
          title: input.title,
          titleStatus: input.titleStatus,
          titleSourceMessageId: undefined,
          topic: current.topic ? {
            ...current.topic,
            title: input.title,
            updatedAt: fixedNow,
          } : undefined,
          realtimeSequence: current.realtimeSequence + 1,
          updatedAt: fixedNow,
        };
      },
      async archiveConversationTopic(_companyId: string, conversationId: string, actor: { memberId?: string; employeeId?: string }) {
        calls.push(`chat-archive:${actor.memberId || actor.employeeId}`);
        const current = conversation(companyId, conversationId);
        return {
          ...current,
          topic: {
            schema: "conversation-topic-state",
            version: 1,
            companyId,
            conversationId,
            topicId: "topic-launch",
            title: current.title,
            status: "archived",
            participantIds: current.participants.map((participant) => participant.participantId),
            createdAt: fixedNow,
            updatedAt: fixedNow,
          },
          realtimeSequence: current.realtimeSequence + 1,
          updatedAt: fixedNow,
        };
      },
      async restoreConversationTopic(_companyId: string, conversationId: string, actor: { memberId?: string; employeeId?: string }) {
        calls.push(`chat-restore:${actor.memberId || actor.employeeId}`);
        const current = conversation(companyId, conversationId);
        return {
          ...current,
          topic: {
            schema: "conversation-topic-state",
            version: 1,
            companyId,
            conversationId,
            topicId: "topic-launch",
            title: current.title,
            status: "open",
            participantIds: current.participants.map((participant) => participant.participantId),
            createdAt: fixedNow,
            updatedAt: fixedNow,
          },
          realtimeSequence: current.realtimeSequence + 1,
          updatedAt: fixedNow,
        };
      },
    }),
    processTraceService: async () => ({
      async listProcessTraceEvents(_companyId: string, input: { conversationId: string; processTraceId?: string }) {
        calls.push(`process-trace:${input.conversationId}${input.processTraceId ? `:${input.processTraceId}` : ""}`);
        const events = [{
          id: "trace-call",
          timestamp: fixedNow,
          sessionKey: "nora-automation|chat_topic_room|conversation-1",
          employeeId: "nora-automation",
          kind: "model_tool_call" as const,
          title: "nora-automation called bash",
          summary: "{\"command\":\"pwd\"}",
          status: "succeeded" as const,
          metadata: {
            runId: "run-1",
            sourceMessageId: "message-1",
            toolName: "bash",
            arguments: { command: "pwd" },
          },
        }, {
          id: "trace-reply",
          timestamp: fixedNow,
          sessionKey: "nora-automation|chat_topic_room|conversation-1",
          employeeId: "nora-automation",
          kind: "model_reply_observed" as const,
          title: "nora-automation drafted a reply",
          preview: "This final reply should not be duplicated in Activity.",
          status: "succeeded" as const,
          metadata: {
            runId: "run-1",
            sourceMessageId: "message-1",
          },
        }];
        return input.processTraceId ? events.filter((event) => event.id === input.processTraceId) : events;
      },
    }),
    chatRunControlService: {
      async getActiveChatRun(companyId, input) {
        calls.push(`chat-active:${companyId}:${input.roomId}:${input.actor.memberId || input.actor.employeeId}`);
        return {
          companyId,
          roomId: input.roomId,
          chainId: "chain-1",
          runId: "run-1",
          sourceMessageId: "message-1",
          targetMemberId: "nora-automation",
          status: "active" as const,
        };
      },
      async cancelChatRun(companyId, input) {
        calls.push(`chat-cancel:${companyId}:${input.runId}:${input.actor.memberId || input.actor.employeeId}`);
        return {
          companyId,
          runId: input.runId,
          status: "canceled" as const,
          canceledCount: 1,
        };
      },
    },
    auth,
  });
  const server = http.createServer(async (req, res) => {
    if (await handleTinyOfficeApiRequest(req, res, app)) {
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`, calls, realtimeEvents);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function unauthenticatedProvider(): TinyOfficeAuthProvider {
  return {
    handle: async () => new Response(null, { status: 404 }),
    resolveCurrentUser: async () => undefined,
    status: async () => ({
      schema: "tinyoffice-auth-status",
      version: 2,
      accessMode: "remote",
      authenticated: false,
      bootstrapRequired: false,
      ownerConfigured: true,
      passkeyConfigured: true,
    }),
  };
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

test("Hono TinyOffice API serves Company lifecycle collection routes", async () => {
  await withServer(async (baseUrl, calls) => {
    const listed = await fetch(`${baseUrl}/api/companies`);
    assert.equal(listed.status, 200);
    assert.deepEqual((await json(listed)).contract, {
      name: "company-lifecycle",
      version: 1,
      boundary: "company-lifecycle",
    });

    const created = await fetch(`${baseUrl}/api/companies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tinyoffice-user-id": "xuziho",
        "x-tinyoffice-user-display-name": "Xu Ziho",
      },
      body: JSON.stringify({
        displayName: "Globex Operations",
        ownerMemberId: "malicious-owner",
        ownerDisplayName: "Malicious Owner",
        hrEmployeeDisplayName: "Avery Owner",
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = await json(created);
    assert.equal(createdBody.company.companyId, "globex");
    assert.deepEqual(createdBody.owner, {
      memberId: "xuziho",
      displayName: "Xu Ziho",
      role: "boss",
    });

    const deleted = await fetch(`${baseUrl}/api/companies/globex`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "globex",
        confirmation: {
          intent: "DELETE",
        },
      }),
    });
    assert.equal(deleted.status, 200);
    assert.equal((await json(deleted)).deletedAssetPath, "/companies/globex");

    const systemAi = await fetch(`${baseUrl}/api/companies/acme/system-ai`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatTitleGeneration: {
          modelProvider: "openai",
          modelId: "gpt-5-mini",
        },
        chatTopicSummary: {
          modelProvider: "openai",
          modelId: "gpt-5",
        },
      }),
    });
    assert.equal(systemAi.status, 200);

    const updated = await fetch(`${baseUrl}/api/companies/acme`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Acme Renamed", companyId: "forged" }),
    });
    assert.equal(updated.status, 200);

    assert.deepEqual(calls, [
      "companies:list",
      "companies:create:Globex Operations:xuziho:Xu Ziho",
      "companies:list",
      "companies:switch:xuziho:globex",
      "companies:delete:globex",
      "companies:guard:globex",
      "companies:list",
      "companies:system-ai:acme:openai:gpt-5-mini:openai:gpt-5",
      "companies:list",
      "companies:update:acme:Acme Renamed",
      "companies:list",
    ]);
  });
});

test("Hono TinyOffice API serves product aliases for Tasks and Sessions view models", async () => {
  await withServer(async (baseUrl, calls) => {
    const tasks = await fetch(`${baseUrl}/api/companies/acme/tasks/view-model?view=tasks`);
    assert.equal(tasks.status, 200);
    assert.deepEqual((await json(tasks)).routes, {
      htmlPath: "/tasks",
      viewModelJsonPath: "/api/companies/acme/tasks/view-model",
      runActionPathPrefix: "/api/companies/acme/tasks/runs",
    });

    const sessions = await fetch(`${baseUrl}/api/companies/acme/sessions/view-model?employeeId=nora-automation&sessionId=session-1&q=launch&employeeIdFilter=nora-automation`);
    assert.equal(sessions.status, 200);
    assert.deepEqual((await json(sessions)).filters, {
      query: "launch",
      employeeIdFilter: "nora-automation",
    });

    assert.equal((await fetch(`${baseUrl}/api/console/tasks/view-model?view=tasks`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/console/sessions/view-model?q=launch`)).status, 404);
    assert.deepEqual(calls, [
      "tasks:acme:tasks",
      "sessions:acme:launch:nora-automation:session-1:nora-automation",
    ]);
  });
});

test("Hono TinyOffice API routes company-scoped intake events", async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/intake/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "2026-07-09",
        source: "api-test",
        sourceEventId: "intake-api-test-1",
        category: "tinyoffice.test",
        routing: {
          targetMemberId: "nora-automation",
        },
        summary: "API route smoke.",
      }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await json(response), {
      status: "processed",
      eventId: "intake-event-api-1",
      category: "tinyoffice.test",
      result: {
        kind: "intake_event_routed",
        category: "tinyoffice.test",
        targetMemberId: "nora-automation",
      },
    });
    assert.equal((await fetch(`${baseUrl}/api/intake/events`, { method: "POST" })).status, 404);
    assert.deepEqual(calls, [
      "intake:acme:tinyoffice.test:nora-automation:intake-api-test-1",
    ]);
  });
});

test("Hono TinyOffice API serves chat-scoped employee runtime summary instead of page-shaped status", async () => {
  await withServer(async (baseUrl, calls) => {
    const loaded = await fetch(`${baseUrl}/api/companies/acme/employees/runtime-summary?employeeId=nora-automation`);
    assert.equal(loaded.status, 200);
    const body = await json(loaded) as {
      contract?: { name?: string; productBoundary?: string };
      routes?: { summaryJsonPath?: string };
      employees?: Array<{
        employeeId?: string;
        status?: { kind?: string; label?: string };
        counts?: Record<string, unknown>;
        current?: Array<{ kind?: string; id?: string }>;
      }>;
    };
    assert.deepEqual(body.contract, {
      name: "employee-runtime-summary",
      version: 1,
      productBoundary: "chat-employee-context-runtime-summary",
    });
    assert.equal(body.routes?.summaryJsonPath, "/api/companies/acme/employees/runtime-summary");
    assert.equal(body.employees?.[0]?.employeeId, "nora-automation");
    assert.equal(body.employees?.[0]?.status?.kind, "blocked");
    assert.equal(body.employees?.[0]?.current?.[0]?.kind, "work-run");

    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /filters|statusOptions|sortOptions|detailSections|modelProvider|modelId|thinkingLevel|evidence|\/console\/|\/app\//);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/employees/status?status=blocked`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/employees/nora-automation/self-status?viewerEmployeeId=nora-automation`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/console/employees/status`)).status, 404);
    assert.deepEqual(calls, ["runtime-summary:acme:nora-automation"]);
  });
});

test("Hono TinyOffice API executes Tasks Run actions through the company-scoped route", async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/tasks/runs/run-792/actions/cancel-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorMemberId: "forged-member",
        reason: "Operator canceled the run.",
      }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await json(response), {
      accepted: true,
      actionId: "cancel-run",
      workRunId: "run-792",
      status: "canceled",
      message: "cancel-run accepted",
    });

    const disabled = await fetch(`${baseUrl}/api/companies/acme/tasks/runs/run-792/actions/retry-dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(disabled.status, 409);
    assert.match(JSON.stringify(await json(disabled)), /failed dispatch lease/);

    assert.equal((await fetch(`${baseUrl}/api/work/run-792/cancel-run`, { method: "POST" })).status, 404);
    assert.deepEqual(calls, [
      "tasks-action:acme:run-792:cancel-run:xuziho:Operator canceled the run.",
      "tasks-action:acme:run-792:retry-dispatch:xuziho:none",
    ]);
  });
});

test("Hono TinyOffice API no longer exposes employee self-status as a separate product route", async () => {
  await withServer(async (baseUrl, calls) => {
    const loaded = await fetch(`${baseUrl}/api/companies/acme/employees/nora-automation/self-status?viewerEmployeeId=nora-automation`);
    assert.equal(loaded.status, 404);
    const crossEmployee = await fetch(`${baseUrl}/api/companies/acme/employees/nora-automation/self-status?viewerEmployeeId=quality-editor`);
    assert.equal(crossEmployee.status, 404);

    const memberFallback = await fetch(`${baseUrl}/api/companies/acme/employees/nora-automation/self-status?viewerMemberId=xuziho`);
    assert.equal(memberFallback.status, 404);

    assert.equal((await fetch(`${baseUrl}/api/console/employees/self-status?employeeId=nora-automation`)).status, 404);
    assert.deepEqual(calls, []);
  });
});

test("Hono TinyOffice API main path serves Chat, directory, conversation, message, and read routes", async () => {
  await withServer(async (baseUrl, calls) => {
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/directory`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/chat?viewerMemberId=xuziho`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/prompt-policy`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/access`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/employees/runtime-summary?employeeId=nora-automation`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/employees/nora-automation/self-status?viewerEmployeeId=nora-automation`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1?viewerMemberId=xuziho`)).status, 200);
    const traceResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/process-trace?viewerMemberId=xuziho`);
    assert.equal(traceResponse.status, 200);
    assert.equal(((await json(traceResponse)) as { events?: unknown[] }).events?.length, 2);
    const activityResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/activity?viewerMemberId=xuziho`);
    assert.equal(activityResponse.status, 200);
    const activityBody = await json(activityResponse) as {
      items?: Array<{
        kind?: string;
        title?: string;
        primary?: { toolName?: string; arguments?: unknown };
        raw?: { eventIds?: string[] };
      }>;
    };
    assert.deepEqual(activityBody.items, [{
      id: "activity:tool_step:run-1:trace-call",
      kind: "tool_call",
      title: "Tool · bash",
      details: "{\"command\":\"pwd\"}",
      status: "succeeded",
      timestamp: fixedNow,
      primary: {
        toolName: "bash",
        arguments: { command: "pwd" },
      },
      raw: {
        eventIds: ["trace-call"],
        events: [{
          id: "trace-call",
          timestamp: fixedNow,
          sessionKey: "nora-automation|chat_topic_room|conversation-1",
          employeeId: "nora-automation",
          kind: "model_tool_call",
          title: "nora-automation called bash",
          summary: "{\"command\":\"pwd\"}",
          status: "succeeded",
          metadata: {
            runId: "run-1",
            sourceMessageId: "message-1",
            toolName: "bash",
            arguments: { command: "pwd" },
          },
        }],
      },
    }]);
    assert.doesNotMatch(JSON.stringify(activityBody), /This final reply should not be duplicated/);
    const filteredActivityResponse = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/activity?viewerMemberId=xuziho&processTraceId=trace-call`);
    assert.equal(filteredActivityResponse.status, 200);
    assert.equal(((await json(filteredActivityResponse)) as { items?: unknown[] }).items?.length, 1);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages?viewerMemberId=xuziho`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", body: "Ship it" }),
    })).status, 201);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "acme", viewerMemberId: "xuziho" }),
    })).status, 200);
    const archived = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", confirmation: "ARCHIVE" }),
    });
    assert.equal(archived.status, 200, await archived.clone().text());
    assert.equal(((await json(archived)).topic as { status?: string }).status, "archived");
    const restored = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", confirmation: "RESTORE" }),
    });
    assert.equal(restored.status, 200, await restored.clone().text());
    assert.equal(((await json(restored)).topic as { status?: string }).status, "open");
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        containerId: TEST_CHANNEL_CONTAINER_ID,
        actorMemberId: "xuziho",
        firstMessage: { body: "New topic" },
      }),
    })).status, 201);

    const outside = await fetch(`${baseUrl}/api/process-trace`);
    assert.equal(outside.status, 404);
    assert.deepEqual(calls, [
      "directory",
      "projection:xuziho",
      "chat-get:conversation-1",
      "prompt-policy:acme",
      "access:acme",
      "runtime-summary:acme:nora-automation",
      "chat-get:conversation-1",
      "chat-get:conversation-1",
      "process-trace:conversation-1",
      "chat-get:conversation-1",
      "process-trace:conversation-1",
      "chat-get:conversation-1",
      "process-trace:conversation-1:trace-call",
      "chat-get:conversation-1",
      "chat-messages:conversation-1",
      "chat-get:conversation-1",
      "chat-send:xuziho:none",
      "chat-get:conversation-1",
      "chat-read:xuziho",
      "chat-get:conversation-1",
      "chat-archive:xuziho",
      "chat-get:conversation-1",
      "chat-restore:xuziho",
      "entry:xuziho",
    ]);
  });
});

test("Hono TinyOffice API attaches per-turn runtime usage to linked Chat messages", async () => {
  const runtimeSessionRecord = {
    id: "session-runtime-usage",
    companyId: "acme",
    employeeId: "nora-automation",
    sessionKey: "nora-automation|chat_topic_room|conversation-runtime-usage",
    sessionId: "pi-session-runtime-usage",
    sceneType: "chat_topic_room",
    status: "completed",
    startedAt: fixedNow,
    updatedAt: fixedNow,
    eventCount: 2,
    userMessageCount: 1,
    assistantMessageCount: 1,
    toolCallCount: 0,
    toolResultCount: 0,
    tokenInputTotal: 9999,
    tokenOutputTotal: 888,
    tokenCacheTotal: 777,
    byteSize: 0,
    truncated: false,
  } as RuntimeSessionRecord;
  const runtimeSessionEvents = [{
    id: "event-runtime-usage-other-turn",
    sessionRecordId: "session-runtime-usage",
    sequence: 1,
    timestamp: fixedNow,
    kind: "message_end",
    role: "assistant",
    turnId: "nora-automation|chat_topic_room|conversation-runtime-usage|message-other",
    modelCallId: "model-call-other",
    payload: { usage: { input: 9000, output: 800, cacheRead: 70, cacheWrite: 7 } },
    byteSize: 0,
    truncated: false,
  }, {
    id: "event-runtime-usage",
    sessionRecordId: "session-runtime-usage",
    sequence: 2,
    timestamp: fixedNow,
    kind: "message_end",
    role: "assistant",
    turnId: "nora-automation|chat_topic_room|conversation-runtime-usage|message-source",
    modelCallId: "model-call-primary",
    payload: { usage: { input: 1234, output: 56, cacheRead: 700, cacheWrite: 8 } },
    byteSize: 0,
    truncated: false,
  }, {
    id: "event-runtime-usage-duplicate-snapshot",
    sessionRecordId: "session-runtime-usage",
    sequence: 3,
    timestamp: fixedNow,
    kind: "turn_end",
    role: "assistant",
    turnId: "nora-automation|chat_topic_room|conversation-runtime-usage|message-source",
    modelCallId: "model-call-primary",
    payload: { usage: { input: 1234, output: 56, cacheRead: 700, cacheWrite: 8 } },
    byteSize: 0,
    truncated: false,
  }, {
    id: "event-runtime-usage-handoff-repair",
    sessionRecordId: "session-runtime-usage",
    sequence: 4,
    timestamp: fixedNow,
    kind: "model_call_usage",
    turnId: "nora-automation|chat_topic_room|conversation-runtime-usage|message-source",
    modelCallId: "model-call-handoff-repair",
    payload: { usage: { input: 10, output: 2, cacheRead: 3 } },
    byteSize: 0,
    truncated: false,
  }] satisfies RuntimeSessionEvent[];
  const runtimeSessionRepository = {
    getSessionRecord(id: string) {
      return id === runtimeSessionRecord.id ? runtimeSessionRecord : undefined;
    },
    listSessionRecords(input?: { sessionKey?: string }) {
      return !input?.sessionKey || input.sessionKey === runtimeSessionRecord.sessionKey ? [runtimeSessionRecord] : [];
    },
    listSessionEvents(sessionRecordId: string) {
      return sessionRecordId === runtimeSessionRecord.id ? runtimeSessionEvents : [];
    },
    close() {},
  } as RuntimeSessionRepositoryLike;

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-runtime-usage/messages?viewerMemberId=xuziho`);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await json(response) as {
      messages?: Array<{
        runtimeUsage?: {
          inputTokens: number;
          outputTokens: number;
          cacheTokens: number;
        };
      }>;
    };
    assert.deepEqual(body.messages?.[0]?.runtimeUsage, {
      inputTokens: 1244,
      outputTokens: 58,
      cacheTokens: 711,
    });
  }, undefined, { runtimeSessionRepository });

  runtimeSessionEvents.splice(1);
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-runtime-usage/messages?viewerMemberId=xuziho`);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await json(response) as { messages?: Array<{ runtimeUsage?: unknown }> };
    assert.equal(body.messages?.[0]?.runtimeUsage, undefined);
  }, undefined, { runtimeSessionRepository });
});

test("Hono TinyOffice API lets users manually rename a Chat room title", async () => {
  await withServer(async (baseUrl, calls, realtimeEvents) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        title: "Website analytics employee setup",
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());

    const renamed = await json(response) as {
      title?: string;
      titleStatus?: string;
      titleSourceMessageId?: string;
    };
    assert.equal(renamed.title, "Website analytics employee setup");
    assert.equal(renamed.titleStatus, "manual");
    assert.equal(renamed.titleSourceMessageId, undefined);
    assert.deepEqual(calls, [
      "chat-get:conversation-1",
      "chat-title:conversation-1:Website analytics employee setup:manual",
    ]);
    assert.deepEqual(realtimeEvents.map((event) => event.type), [
      "chat.projection.changed",
      "chat.projection.changed",
    ]);
  });
});

test("Hono TinyOffice API covers shadcn frontend client routes", async () => {
  await withServer(async (baseUrl) => {
    const jsonHeaders = { "Content-Type": "application/json" };
    const sessionHeaders = {
      ...jsonHeaders,
      "x-tinyoffice-company-id": "acme",
      "x-tinyoffice-member-id": "xuziho",
      "x-tinyoffice-member-display-name": "Xu",
      "x-tinyoffice-member-role": "boss",
    };
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "route-parity.png");

    const requests: Array<[string, RequestInit | undefined]> = [
      ["/api/companies", undefined],
      ["/api/companies", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ displayName: "Globex", hrEmployeeDisplayName: "Mira" }),
      }],
      ["/api/companies/acme", {
        method: "DELETE",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme", confirmation: { intent: "DELETE" } }),
      }],
      ["/api/companies/acme/system-ai", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ chatTitleGeneration: {}, chatTopicSummary: {} }),
      }],
      ["/api/tinyoffice/session/current", undefined],
      ["/api/tinyoffice/session/current-company", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme" }),
      }],
      ["/api/companies/acme/directory", undefined],
      ["/api/companies/acme/sessions/view-model?employeeId=nora-automation", undefined],
      ["/api/companies/acme/tasks/view-model?status=active&sort=recent&workTaskId=work-task-api-1", undefined],
      ["/api/companies/acme/tasks/runs/run-792/actions/cancel-run", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ reason: "Route parity check." }),
      }],
      ["/api/companies/acme/work/work-task-api-1/cancel", {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ companyId: "acme", workTaskId: "work-task-api-1", confirmation: "CANCEL" }),
      }],
      ["/api/companies/acme/work/work-task-api-1/archive", {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ companyId: "acme", workTaskId: "work-task-api-1", confirmation: "ARCHIVE" }),
      }],
      ["/api/companies/acme/work/work-task-api-1/restore", {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({ companyId: "acme", workTaskId: "work-task-api-1", confirmation: "RESTORE" }),
      }],
      ["/api/companies/acme/chat?viewerMemberId=xuziho", undefined],
      ["/api/companies/acme/chat/entries", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          companyId: "acme",
          containerId: TEST_CHANNEL_CONTAINER_ID,
          actorMemberId: "xuziho",
          firstMessage: { body: "Route parity topic" },
        }),
      }],
      ["/api/companies/acme/chat/rooms/conversation-1/messages?viewerMemberId=xuziho", undefined],
      ["/api/companies/acme/chat/rooms/conversation-1/activity?viewerMemberId=xuziho&limit=500", undefined],
      ["/api/companies/acme/chat/rooms/conversation-1/read", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme", viewerMemberId: "xuziho" }),
      }],
      ["/api/companies/acme/chat/rooms/conversation-1/messages", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", body: "Route parity reply" }),
      }],
      ["/api/companies/acme/chat/rooms/conversation-1/title", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", title: "Route parity title" }),
      }],
      ["/api/companies/acme/chat/rooms/conversation-1/archive", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", confirmation: "ARCHIVE" }),
      }],
      ["/api/companies/acme/chat/rooms/conversation-1/restore", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", confirmation: "RESTORE" }),
      }],
      ["/api/companies/acme/chat/attachments?viewerMemberId=xuziho", { method: "POST", body: form }],
      ["/api/companies/acme/chat/channels/channel-general", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", title: "Ops", summary: "Operations" }),
      }],
      ["/api/companies/acme/chat/channels", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "xuziho",
          actorDisplayName: "Xu",
          title: "Operations",
          members: [{ memberId: "nora-automation", displayName: "Nora", hasRuntimeProfile: true }],
        }),
      }],
      ["/api/companies/acme/chat/channels/channel-general/members", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "xuziho",
          members: [{ memberId: "nora-automation", displayName: "Nora", hasRuntimeProfile: true }],
        }),
      }],
      ["/api/companies/acme/chat/channels/channel-general/members", {
        method: "DELETE",
        headers: jsonHeaders,
        body: JSON.stringify({
          companyId: "acme",
          actorMemberId: "xuziho",
          member: { memberId: "nora-automation", displayName: "Nora", hasRuntimeProfile: true },
        }),
      }],
      ["/api/companies/acme/chat/channels/channel-general", {
        method: "DELETE",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", confirmation: "DELETE" }),
      }],
      ["/api/companies/acme/chat/runs/run-1/cancel", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", reason: "Route parity check." }),
      }],
      ["/api/companies/acme/chat/rooms/conversation-1/active-run", undefined],
    ];

    for (const [path, init] of requests) {
      const response = await fetch(`${baseUrl}${path}`, init);
      assert.notEqual(
        response.status,
        404,
        `${init?.method || "GET"} ${path} should be registered for the shadcn frontend client`,
      );
    }
  });
});

test("Hono TinyOffice Chat APIs reject non-contract member identity fields", async () => {
  await withServer(async (baseUrl, calls) => {
    const rejectedMessage = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorEmployeeId: "nora-automation",
        body: "old actor selector",
      }),
    });
    assert.equal(rejectedMessage.status, 400);
    assert.match(JSON.stringify(await json(rejectedMessage)), /unknown send Chat room message body field: actorEmployeeId/);

    const rejectedRead = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        viewerEmployeeId: "nora-automation",
      }),
    });
    assert.equal(rejectedRead.status, 400);
    assert.match(JSON.stringify(await json(rejectedRead)), /unknown mark Chat room read body field: viewerEmployeeId/);

    const ignoredProjectionIdentity = await fetch(`${baseUrl}/api/companies/acme/chat?viewerEmployeeId=nora-automation`);
    assert.equal(ignoredProjectionIdentity.status, 200);

    const ignoredProjectionAlias = await fetch(`${baseUrl}/api/companies/acme/chat?memberId=intruder`);
    assert.equal(ignoredProjectionAlias.status, 200);

    const rejectedMessageAlias = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        memberId: "xuziho",
        body: "old generic member alias",
      }),
    });
    assert.equal(rejectedMessageAlias.status, 400);
    assert.match(JSON.stringify(await json(rejectedMessageAlias)), /unknown send Chat room message body field: memberId/);

    const rejectedReadAlias = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        memberId: "xuziho",
      }),
    });
    assert.equal(rejectedReadAlias.status, 400);
    assert.match(JSON.stringify(await json(rejectedReadAlias)), /unknown mark Chat room read body field: memberId/);

    const rejectedCreateEntry = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        containerId: TEST_CHANNEL_CONTAINER_ID,
        actorMemberId: "xuziho",
        participantEmployeeIds: ["nora-automation"],
        firstMessage: {
          body: "old participants",
          mentionedEmployeeIds: ["nora-automation"],
        },
      }),
    });
    assert.equal(rejectedCreateEntry.status, 400);
    assert.match(JSON.stringify(await json(rejectedCreateEntry)), /unknown create Chat entry body field: participantEmployeeIds/);

    const rejectedCreateEntryActorAlias = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        containerId: TEST_CHANNEL_CONTAINER_ID,
        memberId: "xuziho",
        memberDisplayName: "Xu",
        firstMessage: {
          body: "old actor aliases",
        },
      }),
    });
    assert.equal(rejectedCreateEntryActorAlias.status, 400);
    assert.match(JSON.stringify(await json(rejectedCreateEntryActorAlias)), /unknown create Chat entry body field: memberId/);

    const rejectedChannelMember = await fetch(`${baseUrl}/api/companies/acme/chat/channels/${TEST_CHAT_CHANNEL_ID}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        members: [{ employeeId: "nora-automation" }],
      }),
    });
    assert.equal(rejectedChannelMember.status, 400);
    assert.match(JSON.stringify(await json(rejectedChannelMember)), /memberId/);

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "screen.png");
    form.append("ownerEmployeeId", "nora-automation");
    const rejectedAttachmentOwner = await fetch(`${baseUrl}/api/companies/acme/chat/attachments?viewerMemberId=xuziho`, {
      method: "POST",
      body: form,
    });
    assert.equal(rejectedAttachmentOwner.status, 400);
    assert.match(JSON.stringify(await json(rejectedAttachmentOwner)), /unknown Chat attachment upload field: ownerEmployeeId/);

    assert.deepEqual(calls, ["projection:xuziho", "chat-get:conversation-1", "projection:xuziho", "chat-get:conversation-1"]);
  });
});

test("Hono TinyOffice Chat APIs reject non-contract request fields through schema validation", async () => {
  await withServer(async (baseUrl, calls) => {
    const sendWithExtraField = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        body: "Ship it",
        unexpectedIdentityField: "legacy",
      }),
    });
    assert.equal(sendWithExtraField.status, 400);
    assert.match(JSON.stringify(await json(sendWithExtraField)), /unknown send Chat room message body field: unexpectedIdentityField/);

    const createEntryWithExtraField = await fetch(`${baseUrl}/api/companies/acme/chat/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        containerId: TEST_CHANNEL_CONTAINER_ID,
        actorMemberId: "xuziho",
        firstMessage: {
          body: "New topic",
          unexpectedMentionField: ["nora-automation"],
        },
      }),
    });
    assert.equal(createEntryWithExtraField.status, 400);
    assert.match(JSON.stringify(await json(createEntryWithExtraField)), /unknown firstMessage field: unexpectedMentionField/);

    assert.deepEqual(calls, []);
  });
});

test("Hono TinyOffice API exposes owned Channel title and summary updates", async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/channels/${TEST_CHAT_CHANNEL_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        title: "Launch room",
        summary: "Coordinate launch work across content and analytics.",
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await json(response) as { title?: string; summary?: string };
    assert.equal(body.title, "Launch room");
    assert.equal(body.summary, "Coordinate launch work across content and analytics.");

    assert.deepEqual(calls, [
      "channels:update:xuziho:Launch room:Coordinate launch work across content and analytics.",
    ]);
  });
});

test("Hono TinyOffice API exposes Channel member removal", async () => {
  await withServer(async (baseUrl, calls) => {
    const removed = await fetch(`${baseUrl}/api/companies/acme/chat/channels/${TEST_CHAT_CHANNEL_ID}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        member: {
          memberId: "nora-automation",
        },
      }),
    });
    assert.equal(removed.status, 200, await removed.clone().text());
    const removedBody = await json(removed) as { members?: Array<{ memberId?: string }> };
    assert.deepEqual(removedBody.members?.map((member) => member.memberId), ["xuziho"]);

    assert.deepEqual(calls, [
      "channels:remove:xuziho:nora-automation",
    ]);
  });
});

test("Hono TinyOffice API hard deletes a Channel only with DELETE confirmation", async () => {
  await withServer(async (baseUrl, calls) => {
    const missingConfirmation = await fetch(`${baseUrl}/api/companies/acme/chat/channels/${TEST_CHAT_CHANNEL_ID}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        confirmation: "delete",
      }),
    });
    assert.equal(missingConfirmation.status, 400);
    assert.match(JSON.stringify(await json(missingConfirmation)), /confirmation must be DELETE/);

    const dissolved = await fetch(`${baseUrl}/api/companies/acme/chat/channels/${TEST_CHAT_CHANNEL_ID}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        confirmation: "DELETE",
      }),
    });
    assert.equal(dissolved.status, 200, await dissolved.clone().text());
    assert.deepEqual(await json(dissolved), {
      companyId: "acme",
      chatChannelId: TEST_CHAT_CHANNEL_ID,
      dissolved: true,
    });

    assert.deepEqual(calls, [
      "channels:dissolve:xuziho:DELETE",
    ]);
  });
});

test("Hono TinyOffice API serves company-scoped Access routes", async () => {
  await withServer(async (baseUrl, calls) => {
    const loaded = await fetch(`${baseUrl}/api/companies/acme/access`);
    assert.equal(loaded.status, 200);
    const body = await json(loaded) as {
      contract?: { name?: string; boundary?: string };
      routes?: { viewModelJsonPath?: string; savePolicyPath?: string; previewPath?: string };
      policy?: { sensitivePathPatterns?: string[]; bashDenyPatterns?: string[] };
      capabilityGroups?: Array<{ label?: string; kind?: string }>;
    };
    assert.deepEqual(body.contract, {
      name: "access",
      version: 1,
      boundary: "runtime-access-policy",
    });
    assert.deepEqual(body.routes, {
      htmlPath: "/config/access",
      viewModelJsonPath: "/api/companies/acme/access",
      savePolicyPath: "/api/companies/acme/access",
      previewPath: "/api/companies/acme/access/preview",
    });
    assert.deepEqual(body.policy?.sensitivePathPatterns, [".env"]);
    assert.equal(body.capabilityGroups?.[0]?.label, "Environment config");

    const nextPolicy = {
      ...accessPolicy(),
      askReadPathPatterns: ["customer-exports/**"],
    };
    const saved = await fetch(`${baseUrl}/api/companies/acme/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "acme", policy: nextPolicy }),
    });
    assert.equal(saved.status, 200);

    assert.deepEqual(((await json(saved)).policy as { askReadPathPatterns?: string[] })?.askReadPathPatterns, ["customer-exports/**"]);

    const preview = await fetch(`${baseUrl}/api/companies/acme/access/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        policy: nextPolicy,
        operation: "bash",
        command: "rm -rf build",
      }),
    });
    assert.equal(preview.status, 200);
    assert.deepEqual(await json(preview), {
      operation: "bash",
      target: "rm -rf build",
      decision: "deny",
      matchedPolicy: "bashDenyPatterns",
      reason: "Access preview from test service",
    });

    const requests = await fetch(`${baseUrl}/api/companies/acme/access/requests`);
    assert.equal(requests.status, 200);
    const requestsBody = await json(requests) as {
      requests?: Array<{ id?: string; actions?: string[]; requestedResource?: string }>;
    };
    assert.equal(requestsBody.requests?.[0]?.id, "approval-1");
    assert.deepEqual(requestsBody.requests?.[0]?.actions, ["allow_once", "allow_in_context", "reject"]);
    assert.equal(requestsBody.requests?.[0]?.requestedResource, ".env");

    const resolvedOnce = await fetch(`${baseUrl}/api/companies/acme/access/requests/approval-1/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        decision: "allow_once",
      }),
    });
    assert.equal(resolvedOnce.status, 200, await resolvedOnce.clone().text());
    assert.equal(((await json(resolvedOnce)).grant as { scope?: string })?.scope, "one_time");

    const resolvedContext = await fetch(`${baseUrl}/api/companies/acme/access/requests/approval-1/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        decision: "allow_in_context",
        note: "Only use this while configuring the current connector.",
      }),
    });
    assert.equal(resolvedContext.status, 200, await resolvedContext.clone().text());
    const resolvedContextBody = await json(resolvedContext) as {
      request?: { decisionNote?: string };
      grant?: { scope?: string };
    };
    assert.equal(resolvedContextBody.grant?.scope, "session");
    assert.equal(resolvedContextBody.request?.decisionNote, "Only use this while configuring the current connector.");

    const rejected = await fetch(`${baseUrl}/api/companies/acme/access/requests/approval-1/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        decision: "reject",
        note: "Use the managed connector instead.",
      }),
    });
    assert.equal(rejected.status, 200, await rejected.clone().text());
    assert.equal(((await json(rejected)).request as { status?: string; decisionNote?: string })?.status, "rejected");

    const toolCall = await fetch(`${baseUrl}/api/companies/acme/access/tool-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        memberId: "avery",
        action: "read",
        resource: ".env",
        reason: "Access requires participant decision for sensitive path read: .env",
        contextKind: "channel_topic",
        contextId: "room-1",
        sessionKey: "avery|channel_topic|room-1",
        requestedInputSnapshot: { toolName: "read", input: { path: ".env" } },
      }),
    });
    assert.equal(toolCall.status, 200, await toolCall.clone().text());
    const toolCallBody = await json(toolCall) as {
      decision?: string;
      request?: { id?: string; requestedInputSnapshot?: unknown };
    };
    assert.equal(toolCallBody.decision, "block");
    assert.equal(toolCallBody.request?.id, "approval-tool-call-1");
    assert.deepEqual(toolCallBody.request?.requestedInputSnapshot, { toolName: "read", input: { path: ".env" } });

    assert.equal((await fetch(`${baseUrl}/api/console/tool-safety`)).status, 404);
    assert.deepEqual(calls, [
      "access:acme",
      "access-save:acme",
      "access-preview:acme:bash",
      "access-requests:acme",
      "access-request-resolve:acme:approval-1:allow_once:",
      "access-request-resolve:acme:approval-1:allow_in_context:Only use this while configuring the current connector.",
      "access-request-resolve:acme:approval-1:reject:Use the managed connector instead.",
      "access-tool-call:acme:avery:read:.env",
    ]);
  });
});

test("Hono TinyOffice API serves company-scoped Doctor route", async () => {
  await withServer(async (baseUrl, calls) => {
    const loaded = await fetch(`${baseUrl}/api/companies/acme/doctor`);
    assert.equal(loaded.status, 200, await loaded.clone().text());
    const body = await json(loaded) as {
      schema?: string;
      companyId?: string;
      overallStatus?: string;
      sections?: Array<{ id?: string; status?: string }>;
      nextSteps?: unknown[];
    };

    assert.equal(body.schema, "tinyoffice-doctor-report");
    assert.equal(body.companyId, "acme");
    assert.equal(body.overallStatus, "ok");
    assert.equal(body.sections?.[0]?.id, "core");
    assert.equal(body.sections?.[0]?.status, "ok");
    assert.deepEqual(body.nextSteps, []);
    assert.deepEqual(calls, ["doctor:acme"]);
  });
});

test("Hono TinyOffice API exposes authenticated update status and controlled install acceptance", async () => {
  const updateCalls: string[] = [];
  await withServer(async (baseUrl) => {
    const loaded = await fetch(`${baseUrl}/api/tinyoffice/updates`);
    assert.equal(loaded.status, 200, await loaded.clone().text());
    const status = await json(loaded) as { schema?: string; release?: { state?: string }; pi?: { installedVersion?: string } };
    assert.equal(status.schema, "tinyoffice-update-status");
    assert.equal(status.release?.state, "ready_to_install");
    assert.equal(status.pi?.installedVersion, "0.80.6");

    const started = await fetch(`${baseUrl}/api/tinyoffice/updates`, { method: "POST" });
    assert.equal(started.status, 202, await started.clone().text());
    const job = await json(started) as { schema?: string; targetReleaseId?: string };
    assert.equal(job.schema, "tinyoffice-update-job");
    assert.equal(job.targetReleaseId, "0.1.1-bbbbbbbbbbbb");
    assert.deepEqual(updateCalls, ["status", "start"]);
  }, undefined, {
    updateService: {
      async loadStatus() {
        updateCalls.push("status");
        return {
          schema: "tinyoffice-update-status",
          version: 2,
          checkedAt: fixedNow,
          channel: "stable",
          release: {
            installed: { releaseId: "0.1.0-aaaaaaaaaaaa", tinyOfficeVersion: "0.1.0", gitCommit: "a".repeat(40) },
            approved: { releaseId: "0.1.1-bbbbbbbbbbbb", tinyOfficeVersion: "0.1.1", gitCommit: "b".repeat(40), minimumNodeVersion: "22.19.0", artifact: { fileName: "tinyoffice.tgz", url: "https://example.test/tinyoffice.tgz", sha256: "c".repeat(64) }, notes: [] },
            state: "ready_to_install",
          },
          runtime: { nodeVersion: "22.19.0", minimumNodeVersion: "22.19.0", compatible: true },
          pi: {
            packageName: "@earendil-works/pi-coding-agent",
            installedVersion: "0.80.6",
            npmLatestVersion: "0.81.0",
            approvedVersion: "0.81.0",
            state: "ready_to_install",
            installedModels: [],
            approvedModels: [],
            addedModels: [],
            removedModels: [],
          },
          installation: { enabled: true, reason: "Ready", requiresBackup: true, requiresRestart: true },
          sources: { npmRegistry: "npm", approvalManifest: "manifest", approvalManifestSource: "remote", releaseManifest: "release-manifest", releaseManifestSource: "remote", warnings: [] },
        };
      },
      async startApprovedUpdate() {
        updateCalls.push("start");
        return {
          schema: "tinyoffice-update-job",
          version: 2,
          jobId: "update-1",
          targetReleaseId: "0.1.1-bbbbbbbbbbbb",
          status: "accepted",
          startedAt: fixedNow,
          updatedAt: fixedNow,
        };
      },
    },
  });
});

test("Hono TinyOffice API serves company-scoped Prompt Policy routes", async () => {
  await withServer(async (baseUrl, calls) => {
    const loaded = await fetch(`${baseUrl}/api/companies/acme/prompt-policy`);
    assert.equal(loaded.status, 200);
    const body = await json(loaded) as {
      contract?: { name?: string; boundary?: string };
      templates?: Array<{ id?: string; content?: string }>;
      availableBlocks?: Array<{ path?: string; loadedBy?: Array<{ label?: string }> }>;
    };
    assert.deepEqual(body.contract, {
      name: "prompt-policy",
      version: 1,
      boundary: "scene-runtime-contract",
    });
    assert.equal(body.templates?.[0]?.id, "base-system-prompt");
    assert.equal(body.availableBlocks?.[0]?.path, "dm-scene");
    assert.equal(body.availableBlocks?.[0]?.loadedBy?.[0]?.label, "DM Thread");

    const savedTemplate = await fetch(`${baseUrl}/api/companies/acme/prompt-policy/templates/base-system-prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        templateId: "base-system-prompt",
        content: "Custom base prompt",
      }),
    });
    assert.equal(savedTemplate.status, 200);
    assert.equal(((await json(savedTemplate)).templates as Array<{ content?: string }>)?.[0]?.content, "Custom base prompt");

    assert.equal((await fetch(`${baseUrl}/api/companies/acme/prompt-policy/templates/base-system-prompt/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "acme", templateId: "base-system-prompt" }),
    })).status, 200);

    const savedBlock = await fetch(`${baseUrl}/api/companies/acme/prompt-policy/blocks/dm-scene`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        path: "dm-scene",
        content: "# DM Scene\n\nCustom DM guidance.",
      }),
    });
    assert.equal(savedBlock.status, 200);
    assert.equal(((await json(savedBlock)).availableBlocks as Array<{ content?: string }>)?.[0]?.content, "# DM Scene\n\nCustom DM guidance.");

    assert.equal((await fetch(`${baseUrl}/api/companies/acme/prompt-policy/blocks/dm-scene/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "acme", path: "dm-scene" }),
    })).status, 200);

    assert.equal((await fetch(`${baseUrl}/api/companies/acme/prompt-policy/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        config: {
          version: 1,
          always: [],
          scenes: {
            dm_thread: ["dm-scene"],
            channel_thread: [],
            intake_event: [],
            work_run_execution: [],
          },
        },
      }),
    })).status, 200);

    assert.equal((await fetch(`${baseUrl}/api/console/prompt-policy`)).status, 404);
    assert.deepEqual(calls, [
      "prompt-policy:acme",
      "prompt-policy-template-save:acme:base-system-prompt",
      "prompt-policy-template-reset:acme:base-system-prompt",
      "prompt-policy-block-save:acme:dm-scene",
      "prompt-policy-block-reset:acme:dm-scene",
      "prompt-policy-config-save:acme",
    ]);
  });
});

test("Hono TinyOffice API serves company-scoped Member Runtime configuration routes", async () => {
  await withServer(async (baseUrl, calls) => {
    const oldRoute = await fetch(`${baseUrl}/api/companies/acme/employee-runtime`);
    assert.equal(oldRoute.status, 404);

    const loaded = await fetch(`${baseUrl}/api/companies/acme/member-runtime`);
    assert.equal(loaded.status, 200);
    const body = await json(loaded) as {
      employees?: Array<{ employeeId?: string; localAssets?: { instructionFiles?: Array<{ name?: string }> } }>;
      availableModels?: Array<{ provider?: string; id?: string }>;
    };
    assert.equal(body.employees?.[0]?.employeeId, "nora-automation");
    assert.equal(body.employees?.[0]?.localAssets?.instructionFiles?.[0]?.name, "AGENTS.md");
    assert.deepEqual(body.availableModels?.[0], {
      provider: "openai",
      id: "gpt-5",
      name: "GPT-5",
      reasoning: true,
    });

    const saved = await fetch(`${baseUrl}/api/companies/acme/member-runtime/members/nora-automation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        memberId: "nora-automation",
        profile: {
          employeeId: "nora-automation",
          displayName: "Nora",
          role: "automation",
          presenceMode: "resident",
        },
        resourcePolicy: {
          version: 1,
          filesystem: {
            ownWorkspace: "allow",
            otherEmployeeWorkspace: "approval",
            repo: "approval",
            secrets: "deny",
          },
        },
        runtime: {
          version: 1,
          modelProvider: "openai",
          modelId: "gpt-5",
          thinkingLevel: "minimal",
        },
        instructionFiles: [{
          path: "/companies/acme/employees/nora-automation/AGENTS.md",
          content: "Use concise updates.\n",
        }],
      }),
    });
    assert.equal(saved.status, 200);

    const deactivated = await fetch(`${baseUrl}/api/companies/acme/member-runtime/members/nora-automation/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(deactivated.status, 200);

    const reload = await fetch(`${baseUrl}/api/companies/acme/member-runtime/members/nora-automation/reload`, {
      method: "POST",
    });
    assert.deepEqual(await json(reload), {
      memberId: "nora-automation",
      reloadedCount: 1,
      sessionKeys: ["session-1"],
    });

    const reloadAll = await fetch(`${baseUrl}/api/companies/acme/member-runtime/reload`, {
      method: "POST",
    });
    assert.deepEqual(await json(reloadAll), {
      memberIds: ["nora-automation"],
      reloadedCount: 1,
      sessionKeys: ["session-1"],
    });

    assert.equal((await fetch(`${baseUrl}/api/console/employee-config`)).status, 404);
    assert.deepEqual(calls, [
      "member-runtime:acme",
      "member-runtime-save:acme:nora-automation",
      "member-runtime:acme",
      "member-runtime-lifecycle:acme:nora-automation:false:xuziho",
      "member-runtime:acme",
      "member-runtime-reload:acme:nora-automation",
      "member-runtime-reload-all:acme",
    ]);
  });
});

test("Hono TinyOffice API serves employee private skill management routes", async () => {
  await withServer(async (baseUrl, calls) => {
    const listed = await fetch(`${baseUrl}/api/companies/acme/member-runtime/members/nora-automation/skills`);
    assert.equal(listed.status, 200);
    const listBody = await json(listed) as {
      schema?: string;
      memberId?: string;
      skills?: Array<{ skillId?: string; relativePath?: string; content?: string }>;
    };
    assert.equal(listBody.schema, "employee-private-skills");
    assert.equal(listBody.memberId, "nora-automation");
    assert.deepEqual(listBody.skills, [{
      skillId: "weekly-automation-audit",
      name: "weekly-automation-audit",
      path: "/companies/acme/employees/nora-automation/skills/weekly-automation-audit/SKILL.md",
      relativePath: "weekly-automation-audit/SKILL.md",
      exists: true,
    }]);
    assert.equal(Object.hasOwn(listBody.skills?.[0] ?? {}, "content"), false);

    const readSkill = await fetch(`${baseUrl}/api/companies/acme/member-runtime/members/nora-automation/skills/weekly-automation-audit`);
    assert.equal(readSkill.status, 200);
    const readBody = await json(readSkill) as {
      schema?: string;
      skillId?: string;
      content?: string;
      editable?: boolean;
    };
    assert.equal(readBody.schema, "employee-private-skill");
    assert.equal(readBody.skillId, "weekly-automation-audit");
    assert.match(readBody.content ?? "", /Audit weekly automation workflows/);
    assert.equal(readBody.editable, true);

    const savedSkill = await fetch(`${baseUrl}/api/companies/acme/member-runtime/members/nora-automation/skills/weekly-automation-audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        memberId: "nora-automation",
        skillId: "weekly-automation-audit",
        content: "---\nname: weekly-automation-audit\n---\n\nUpdated workflow.\n",
      }),
    });
    assert.equal(savedSkill.status, 200);
    const savedBody = await json(savedSkill) as { content?: string };
    assert.equal(savedBody.content, "---\nname: weekly-automation-audit\n---\n\nUpdated workflow.\n");

    const mismatched = await fetch(`${baseUrl}/api/companies/acme/member-runtime/members/nora-automation/skills/weekly-automation-audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "other-company",
        memberId: "nora-automation",
        skillId: "weekly-automation-audit",
        content: "wrong company",
      }),
    });
    assert.equal(mismatched.status, 403);
    assert.match(JSON.stringify(await json(mismatched)), /companyId mismatch|company scope/);

    const traversal = await fetch(`${baseUrl}/api/companies/acme/member-runtime/members/nora-automation/skills/..%2Fsecrets`);
    assert.equal(traversal.status, 400);
    assert.match(JSON.stringify(await json(traversal)), /Invalid employee private skill id/);

    assert.deepEqual(calls, [
      "member-runtime-skills:acme:nora-automation",
      "member-runtime-skill-read:acme:nora-automation:weekly-automation-audit",
      "member-runtime-skill-save:acme:nora-automation:weekly-automation-audit",
    ]);
  });
});

test("Hono TinyOffice API serves member-directory and runtime-model routes", async () => {
  await withServer(async (baseUrl, calls) => {
    const memberDirectory = await fetch(`${baseUrl}/api/companies/acme/member-directory`);
    assert.equal(memberDirectory.status, 200);
    const memberDirectoryBody = await json(memberDirectory) as {
      schema?: string;
      members?: Array<{
        participantKind?: string;
        displayName?: string;
        memberId?: string;
        employeeId?: string;
        hasRuntimeProfile?: boolean;
        runtimeBinding?: unknown;
      }>;
    };
    assert.equal(memberDirectoryBody.schema, "company-member-directory");
    assert.deepEqual(memberDirectoryBody.members, [
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        avatarSeed: "nora-automation",
        displayName: "Nora",
        role: "automation",
        summary: "Runtime-capable automation member.",
        hasRuntimeProfile: true,
      },
      {
        participantKind: "company_member",
        memberId: "xuziho",
        avatarSeed: "xuziho",
        displayName: "Xu",
        hasRuntimeProfile: false,
      },
    ]);
    assert.doesNotMatch(JSON.stringify(memberDirectoryBody), /employeeId|"employee"/);
    assert.equal(Object.hasOwn(memberDirectoryBody.members?.[0] ?? {}, "runtimeBinding"), false);

    const runtimeModels = await fetch(`${baseUrl}/api/runtime/models`);
    assert.equal(runtimeModels.status, 200);
    const runtimeModelsBody = await json(runtimeModels) as {
      schema?: string;
      availableModels?: Array<{ provider?: string; id?: string }>;
      employees?: unknown[];
      thinkingLevels?: string[];
    };
    assert.equal(runtimeModelsBody.schema, "tinyoffice-runtime-models");
    assert.deepEqual(runtimeModelsBody.availableModels?.[0], {
      provider: "openai",
      id: "gpt-5",
      name: "GPT-5",
      reasoning: true,
    });
    assert.equal(runtimeModelsBody.thinkingLevels?.includes("medium"), true);
    assert.equal(Object.hasOwn(runtimeModelsBody, "employees"), false);

    assert.deepEqual(calls, ["directory", "runtime-models"]);
  });
});

test("Hono TinyOffice API exposes company-scoped employee recruitment", async () => {
  await withServer(async (baseUrl, calls, realtimeEvents) => {
    const recruited = await fetch(`${baseUrl}/api/companies/acme/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        employeeId: "iris-growth",
        displayName: "Iris Growth",
        role: "growth",
        summary: "Runs growth experiments.",
        runtime: {
          version: 1,
          modelProvider: "openai",
          modelId: "gpt-5",
          thinkingLevel: "low",
        },
      }),
    });

    assert.equal(recruited.status, 200);
    const body = await json(recruited) as {
      schema?: string;
      companyId?: string;
      employee?: {
        employeeId?: string;
        profile?: { displayName?: string; role?: string; presenceMode?: string };
      };
      localAssets?: { workspacePath?: string; instructionPath?: string };
    };
    assert.equal(body.schema, "tinyoffice-recruit-employee-result");
    assert.equal(body.companyId, "acme");
    assert.equal(body.employee?.employeeId, "iris-growth");
    assert.equal(body.employee?.profile?.displayName, "Iris Growth");
    assert.equal(body.employee?.profile?.role, "growth");
    assert.equal(body.employee?.profile?.presenceMode, "resident");
    assert.equal(body.localAssets?.workspacePath, "/companies/acme/employees/iris-growth/workspace");
    assert.equal(body.localAssets?.instructionPath, "/companies/acme/employees/iris-growth/AGENTS.md");
    assert.deepEqual(realtimeEvents, [{ type: "company.directory.changed", companyId: "acme" }]);

    const mismatched = await fetch(`${baseUrl}/api/companies/acme/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "other-company",
        employeeId: "iris-growth",
        displayName: "Iris Growth",
        role: "growth",
        runtime: {
          version: 1,
          modelProvider: "openai",
          modelId: "gpt-5",
          thinkingLevel: "low",
        },
      }),
    });
    assert.equal(mismatched.status, 403);
    assert.match(JSON.stringify(await json(mismatched)), /companyId mismatch/);
    assert.deepEqual(calls, ["recruit:acme:iris-growth"]);
  });
});

test("Hono TinyOffice API does not expose direct Work creation", async () => {
  await withServer(async (baseUrl, calls) => {
    const sessionHeaders = {
      "Content-Type": "application/json",
      "x-tinyoffice-company-id": "acme",
      "x-tinyoffice-member-id": "xuziho",
      "x-tinyoffice-member-display-name": "Xu",
      "x-tinyoffice-member-role": "boss",
    };
    const created = await fetch(`${baseUrl}/api/companies/acme/work`, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        companyId: "acme",
        title: "Publish weekly social update",
        description: "Confirmed from a Channel discussion.",
        ownerMemberId: "iris-growth",
        sourceKind: "chat_request",
        sourceId: "conversation-work-api",
        acceptanceCriteria: "Published post URL is recorded.",
        trigger: {
          kind: "immediate",
        },
      }),
    });

    assert.equal(created.status, 404);
    assert.deepEqual(calls, []);
  });
});

test("Hono TinyOffice API exposes WorkTask lifecycle actions with explicit confirmations", async () => {
  await withServer(async (baseUrl, calls) => {
    const sessionHeaders = {
      "Content-Type": "application/json",
      "x-tinyoffice-company-id": "acme",
      "x-tinyoffice-member-id": "xuziho",
      "x-tinyoffice-member-display-name": "Xu",
      "x-tinyoffice-member-role": "boss",
    };

    const canceled = await fetch(`${baseUrl}/api/companies/acme/work/work-task-api-1/cancel`, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        companyId: "acme",
        confirmation: "CANCEL",
        reason: "The request was withdrawn.",
      }),
    });
    assert.equal(canceled.status, 200);
    assert.equal(((await json(canceled)) as { task?: { status?: string } }).task?.status, "canceled");

    const archived = await fetch(`${baseUrl}/api/companies/acme/work/work-task-api-1/archive`, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        companyId: "acme",
        confirmation: "ARCHIVE",
        reason: "Hide from default Tasks.",
      }),
    });
    assert.equal(archived.status, 200);
    assert.equal(((await json(archived)) as { task?: { status?: string } }).task?.status, "archived");

    const restored = await fetch(`${baseUrl}/api/companies/acme/work/work-task-api-1/restore`, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        companyId: "acme",
        confirmation: "RESTORE",
      }),
    });
    assert.equal(restored.status, 200);
    assert.equal(((await json(restored)) as { task?: { status?: string } }).task?.status, "canceled");

    const rejected = await fetch(`${baseUrl}/api/companies/acme/work/work-task-api-1/archive`, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        companyId: "acme",
        confirmation: "WRONG",
      }),
    });
    assert.equal(rejected.status, 400);
    assert.match(JSON.stringify(await json(rejected)), /confirmation must be ARCHIVE/);

    assert.deepEqual(calls, [
      "work:cancel:acme:work-task-api-1:xuziho:The request was withdrawn.",
      "work:archive:acme:work-task-api-1:xuziho:Hide from default Tasks.",
      "work:restore:acme:work-task-api-1:xuziho",
    ]);
  });
});

test("TinyOffice API uses the verified Owner session instead of request identity headers", async () => {
  await withServer(async (baseUrl, calls) => {
    const sessionHeaders = {
      "x-tinyoffice-company-id": "acme",
      "x-tinyoffice-member-id": "xuziho",
      "x-tinyoffice-member-display-name": "Xu",
      "x-tinyoffice-member-role": "Founder",
    };
    const session = await fetch(`${baseUrl}/api/tinyoffice/session/current`, { headers: sessionHeaders });
    assert.equal(session.status, 200);
    assert.deepEqual(await json(session), {
      schema: "tinyoffice-current-session",
      version: 2,
      user: {
        id: "xuziho",
        displayName: "Xu Ziho",
      },
      currentCompanyId: "acme",
      companyId: "acme",
      member: {
        memberId: "xuziho",
        displayName: "Xu",
        role: "boss",
      },
      needsProfileInitialization: false,
      needsCompanyInitialization: false,
    });

    assert.equal((await fetch(`${baseUrl}/api/companies/acme/chat?viewerMemberId=intruder`, { headers: sessionHeaders })).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sessionHeaders },
      body: JSON.stringify({ companyId: "acme", actorMemberId: "xuziho", body: "Ship it" }),
    })).status, 201);
    const mismatched = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sessionHeaders },
      body: JSON.stringify({ companyId: "acme", actorMemberId: "intruder", body: "Nope" }),
    });
    assert.equal(mismatched.status, 400);
    assert.deepEqual(calls, ["projection:xuziho", "chat-get:conversation-1", "chat-get:conversation-1", "chat-send:xuziho:none"]);
  });
});

test("Hono TinyOffice Chat message route preserves mentioned member ids", async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        body: "@Nora please check this",
        mentionedMemberIds: ["nora-automation"],
      }),
    });

    assert.equal(response.status, 201);
    const body = await json(response);
    assert.deepEqual((body.message as { mentions?: unknown[] }).mentions, [{
      schema: "message-mention",
      version: 1,
      companyId: "acme",
      conversationId: "conversation-1",
      messageId: "message-chat",
      memberId: "nora-automation",
      createdAt: fixedNow,
    }]);
    assert.deepEqual(calls, ["chat-get:conversation-1", "chat-send:xuziho:nora-automation"]);
  });
});

test("Hono TinyOffice API uploads and serves company-scoped Chat image attachments", async () => {
  await withServer(async (baseUrl, calls) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "screen.png");

    const response = await fetch(`${baseUrl}/api/companies/acme/chat/attachments?viewerMemberId=xuziho`, {
      method: "POST",
      body: form,
    });

    assert.equal(response.status, 201);
    const body = await json(response) as {
      attachment?: {
        attachmentId?: string;
        fileName?: string;
        mimeType?: string;
        ownerMemberId?: string;
        previewUrl?: string;
      };
    };
    assert.equal(body.attachment?.fileName, "screen.png");
    assert.equal(body.attachment?.mimeType, "image/png");
    assert.equal(body.attachment?.ownerMemberId, "xuziho");
    assert.equal(body.attachment?.previewUrl, "/api/companies/acme/chat/attachments/att-test/content");

    const content = await fetch(`${baseUrl}${body.attachment?.previewUrl}?viewerMemberId=xuziho`);
    assert.equal(content.status, 200);
    assert.equal(content.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await content.arrayBuffer())], [137, 80, 78, 71]);
    assert.deepEqual(calls, ["attachment-upload:acme:screen.png:image/png:xuziho"]);
  });
});

test("Hono TinyOffice API lets the uploader discard an unreferenced Chat attachment", async () => {
  await withServer(async (baseUrl, calls) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "discard.png");
    const uploaded = await fetch(`${baseUrl}/api/companies/acme/chat/attachments?viewerMemberId=xuziho`, {
      method: "POST",
      body: form,
    });
    assert.equal(uploaded.status, 201);

    const discarded = await fetch(`${baseUrl}/api/companies/acme/chat/attachments/att-test?viewerMemberId=xuziho`, {
      method: "DELETE",
    });
    assert.equal(discarded.status, 200);
    assert.deepEqual(await json(discarded), {
      companyId: "acme",
      attachmentId: "att-test",
      discarded: true,
    });
    assert.deepEqual(calls, [
      "attachment-upload:acme:discard.png:image/png:xuziho",
      "attachment-discard:acme:att-test:xuziho",
    ]);
  });
});

test("Hono TinyOffice API ignores URL attachment viewers and uses the Owner session", async () => {
  await withServer(async (baseUrl) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "private-preview.png");
    const uploaded = await fetch(`${baseUrl}/api/companies/acme/chat/attachments?viewerMemberId=xuziho`, {
      method: "POST",
      body: form,
    });
    assert.equal(uploaded.status, 201);

    const content = await fetch(`${baseUrl}/api/companies/acme/chat/attachments/att-test/content?viewerMemberId=outside-member`);
    assert.equal(content.status, 200);
  });
});

test("Hono TinyOffice API derives referenced attachment access from the Owner session", async () => {
  await withServer(async (baseUrl) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "referenced.png");
    const uploaded = await fetch(`${baseUrl}/api/companies/acme/chat/attachments?viewerMemberId=xuziho`, {
      method: "POST",
      body: form,
    });
    assert.equal(uploaded.status, 201);

    const allowed = await fetch(`${baseUrl}/api/companies/acme/chat/attachments/att-test/content?viewerMemberId=nora-automation`);
    assert.equal(allowed.status, 200);

    const stillOwner = await fetch(`${baseUrl}/api/companies/acme/chat/attachments/att-test/content?viewerMemberId=outside-member`);
    assert.equal(stillOwner.status, 200);
  });
});

test("Hono TinyOffice API rejects unsupported Chat attachment MIME types", async () => {
  await withServer(async (baseUrl, calls) => {
    const form = new FormData();
    form.append("file", new Blob(["hello"], { type: "text/plain" }), "notes.txt");

    const response = await fetch(`${baseUrl}/api/companies/acme/chat/attachments?viewerMemberId=xuziho`, {
      method: "POST",
      body: form,
    });

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await json(response)), /unsupported Chat image attachment MIME type/);
    assert.deepEqual(calls, ["attachment-upload:acme:notes.txt:text/plain:xuziho"]);
  });
});

test("Hono TinyOffice Chat message route rejects browser-supplied attachment metadata", async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        body: "look at this",
        attachments: [{ attachmentId: "att-1", downloadUrl: "https://example.invalid/file.png" }],
      }),
    });

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await json(response)), /unknown send Chat room message body field: attachments/);
    assert.deepEqual(calls, []);
  });
});

test("Hono TinyOffice Chat run route cancels an active run through the run-control service", async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/runs/tinyoffice_chat%3Achat_room_message%3Aacme%3Aconversation-1%3Amessage-1%3Anora-automation/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: "acme",
        actorMemberId: "xuziho",
        reason: "User stopped the reply.",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), {
      companyId: "acme",
      runId: "tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation",
      status: "canceled",
      canceledCount: 1,
    });
    assert.deepEqual(calls, [
      "chat-cancel:acme:tinyoffice_chat:chat_room_message:acme:conversation-1:message-1:nora-automation:xuziho",
    ]);
  });
});

test("Hono TinyOffice Chat room route restores the durable active Topic run", async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/active-run`);

    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), {
      companyId: "acme",
      roomId: "conversation-1",
      chainId: "chain-1",
      runId: "run-1",
      sourceMessageId: "message-1",
      targetMemberId: "nora-automation",
      status: "active",
    });
    assert.deepEqual(calls, ["chat-active:acme:conversation-1:xuziho"]);
  });
});

test("TinyOffice API resolves the Owner from its authenticated session", async () => {
  await withServer(async (baseUrl) => {
    const session = await fetch(`${baseUrl}/api/tinyoffice/session/current`);
    assert.equal(session.status, 200);
    assert.deepEqual(await json(session), {
      schema: "tinyoffice-current-session",
      version: 2,
      user: {
        id: "xuziho",
        displayName: "Xu Ziho",
      },
      currentCompanyId: "acme",
      companyId: "acme",
      member: {
        memberId: "xuziho",
        displayName: "Xu",
        role: "boss",
      },
      needsProfileInitialization: false,
      needsCompanyInitialization: false,
    });
  });
});

test("TinyOffice API binds the resolved current member session for every authenticated route", async () => {
  const unresolvedOwner = createTestAuthProvider({
    userId: "xuziho",
    displayName: "Xu Ziho",
    source: "test-session",
  });
  await withServer(async (baseUrl) => {
    const chat = await fetch(`${baseUrl}/api/companies/acme/chat`);
    assert.equal(chat.status, 200);
    const page = await json(chat);
    assert.ok(Array.isArray(page.entries));
  }, unresolvedOwner);
});

test("TinyOffice API switches the current Company through Owner session truth", async () => {
  await withServer(async (baseUrl, calls) => {
    const switched = await fetch(`${baseUrl}/api/tinyoffice/session/current-company`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "globex" }),
    });

    assert.equal(switched.status, 200);
    assert.deepEqual(await json(switched), {
      schema: "tinyoffice-current-session",
      version: 2,
      user: {
        id: "xuziho",
        displayName: "Xu Ziho",
      },
      currentCompanyId: "globex",
      companyId: "globex",
      member: {
        memberId: "xuziho",
        displayName: "Xu Ziho",
        role: "admin",
      },
      needsProfileInitialization: false,
      needsCompanyInitialization: false,
    });
    assert.deepEqual(calls, ["companies:switch:xuziho:globex"]);
  });
});

test("TinyOffice API returns initialization-needed session before the Owner creates a Company", async () => {
  await withServer(async (baseUrl) => {
    const session = await fetch(`${baseUrl}/api/tinyoffice/session/current`);
    assert.equal(session.status, 200);
    assert.deepEqual(await json(session), {
      schema: "tinyoffice-current-session",
      version: 2,
      user: {
        id: "new-owner",
        displayName: "New Owner",
      },
      needsProfileInitialization: false,
      needsCompanyInitialization: true,
    });
  }, createTestAuthProvider({ userId: "new-owner", displayName: "New Owner", source: "test-session" }));
});

test("TinyOffice API rejects URL-only member identity without an authenticated session", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat?viewerMemberId=xuziho`);
    assert.equal(response.status, 401);
    assert.deepEqual(await json(response), {
      error: "TinyOffice Owner authentication is required",
      message: "TinyOffice Owner authentication is required",
    });
  }, unauthenticatedProvider());
});

test("TinyOffice exposes only non-secret authentication readiness before sign-in", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tinyoffice/auth/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), {
      schema: "tinyoffice-auth-status",
      version: 2,
      accessMode: "remote",
      authenticated: false,
      bootstrapRequired: false,
      ownerConfigured: true,
      passkeyConfigured: true,
    });
  }, unauthenticatedProvider());
});

test("TinyOffice API rejects employee body identity as current product identity", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tinyoffice-company-id": "acme",
        "x-tinyoffice-member-id": "xuziho",
      },
      body: JSON.stringify({ companyId: "acme", actorEmployeeId: "nora-automation", body: "No implicit employee actor" }),
    });
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await json(response)), /unknown send Chat room message body field: actorEmployeeId/);
  });
});

test("TinyOffice Chat projection cannot be impersonated through URL identity", async () => {
  await withServer(async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat?viewerMemberId=intruder`);

    assert.equal(response.status, 200);
    const projection = await json(response) as {
      containers: Array<{ containerId: string; entryCount: number; unreadCount: number; mentionCount: number }>;
      entries: unknown[];
    };
    assert.equal(projection.entries.length, 1);
    assert.equal(projection.containers.find((container) =>
      container.containerId === TEST_CHANNEL_CONTAINER_ID
    )?.entryCount, 1);
    assert.equal(projection.containers.find((container) =>
      container.containerId === TEST_CHANNEL_CONTAINER_ID
    )?.unreadCount, 0);
    assert.equal(projection.containers.find((container) =>
      container.containerId === TEST_CHANNEL_CONTAINER_ID
    )?.mentionCount, 0);
    assert.deepEqual(calls, ["projection:xuziho", "chat-get:conversation-1"]);
  });
});

test("TinyOffice Chat API ignores URL room viewers and uses the Owner session", async () => {
  await withServer(async (baseUrl, calls) => {
    const room = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1?viewerMemberId=intruder`);
    const messages = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages?viewerMemberId=intruder`);

    assert.equal(room.status, 200);
    assert.equal(messages.status, 200);
    assert.deepEqual(calls, ["chat-get:conversation-1", "chat-get:conversation-1", "chat-messages:conversation-1"]);
  });
});

test("TinyOffice Chat API denies sends and read-state updates for nonparticipants before mutation", async () => {
  await withServer(async (baseUrl, calls) => {
    const send = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "acme", actorMemberId: "intruder", body: "No access" }),
    });
    const read = await fetch(`${baseUrl}/api/companies/acme/chat/rooms/conversation-1/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "acme", viewerMemberId: "intruder" }),
    });

    assert.equal(send.status, 400);
    assert.equal(read.status, 400);
    assert.match(JSON.stringify(await json(send)), /must match the current member session/);
    assert.match(JSON.stringify(await json(read)), /must match the current member session/);
    assert.deepEqual(calls, []);
  });
});

test("TinyOffice API ignores a URL viewer that differs from the Owner session", async () => {
  await withServer(async (baseUrl, calls) => {
    assert.equal((await fetch(`${baseUrl}/api/companies/acme/chat?viewerMemberId=intruder`)).status, 200);
    assert.deepEqual(calls, ["projection:xuziho", "chat-get:conversation-1"]);
  });
});

test("Hono TinyOffice API returns normalized authentication errors", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/companies/acme/chat`);
    assert.equal(response.status, 401);
    assert.deepEqual(await json(response), {
      error: "TinyOffice Owner authentication is required",
      message: "TinyOffice Owner authentication is required",
    });
  }, unauthenticatedProvider());
});

test("TinyOffice Node API adapter recognizes current product company routes", () => {
  assert.equal(isTinyOfficeApiRequest("/api/auth/passkey/generate-authenticate-options"), true);
  assert.equal(isTinyOfficeApiRequest("/api/tinyoffice/auth/status"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/members"), false);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/members?viewerMemberId=xuziho"), false);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/conversations"), false);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/system-ai"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/attention?viewerMemberId=xuziho"), false);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/member-directory"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/work"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/doctor"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/capabilities"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/mcp"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/mcp/check"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/skills"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/branding/logo"), true);
  assert.equal(isTinyOfficeApiRequest("/api/tinyoffice/profile"), true);
  assert.equal(isTinyOfficeApiRequest("/api/tinyoffice/updates"), true);
  assert.equal(isTinyOfficeApiRequest("/api/companies/acme/member-names"), false);
  assert.equal(isTinyOfficeApiRequest("/api/runtime/models"), true);
});

test("TinyOffice API composer delegates product route registration to modules", async () => {
  const composer = await readFile(tinyOfficeApiComposerUrl, "utf8");
  assert.doesNotMatch(composer, /\bapp\.(get|post|put|patch|delete)\(/);

  const routeModules = [
    ["company-routes.ts", "registerCompanyRoutes", "/api/companies"],
    ["work-routes.ts", "registerWorkRoutes", "/api/companies/:companyId/work"],
    ["tasks-routes.ts", "registerTasksRoutes", "/api/companies/:companyId/tasks/view-model"],
    ["sessions-routes.ts", "registerSessionsRoutes", "/api/companies/:companyId/sessions/view-model"],
    ["directory-routes.ts", "registerDirectoryRoutes", "/api/companies/:companyId/directory"],
    ["member-directory-routes.ts", "registerMemberDirectoryRoutes", "/api/companies/:companyId/member-directory"],
    ["member-runtime-routes.ts", "registerMemberRuntimeRoutes", "/api/companies/:companyId/member-runtime"],
    ["runtime-models-routes.ts", "registerRuntimeModelsRoutes", "/api/runtime/models"],
    ["employee-runtime-summary-routes.ts", "registerEmployeeRuntimeSummaryRoutes", "/api/companies/:companyId/employees/runtime-summary"],
    ["prompt-policy-routes.ts", "registerPromptPolicyRoutes", "/api/companies/:companyId/prompt-policy"],
    ["access-routes.ts", "registerAccessRoutes", "/api/companies/:companyId/access"],
    ["doctor-routes.ts", "registerDoctorRoutes", "/api/companies/:companyId/doctor"],
    ["update-routes.ts", "registerUpdateRoutes", "/api/tinyoffice/updates"],
    ["attachment-routes.ts", "registerAttachmentRoutes", "/api/companies/:companyId/chat/attachments"],
    ["chat-routes.ts", "registerChatRoutes", "/api/companies/:companyId/chat"],
    ["session-routes.ts", "registerSessionRoutes", "/api/tinyoffice/session/current"],
  ] as const;

  for (const [fileName, registrarName, routePath] of routeModules) {
    const moduleSource = await readFile(new URL(fileName, tinyOfficeApiModuleUrl), "utf8");
    assert.match(composer, new RegExp(registrarName));
    assert.match(moduleSource, new RegExp(routePath.replace(/[/:]/g, "\\$&")));
  }

  const context = await readFile(new URL("context.ts", tinyOfficeApiModuleUrl), "utf8");
  assert.ok(context.split("\n").length < 50, "context.ts should stay a thin shared-helper barrel");

  const helperModules = [
    "contracts.ts",
    "auth-helpers.ts",
    "parsing.ts",
    "parsing-company.ts",
    "parsing-identity.ts",
    "parsing-chat.ts",
    "parsing-config.ts",
    "service-resolvers.ts",
    "chat-helpers.ts",
  ] as const;
  for (const fileName of helperModules) {
    const moduleSource = await readFile(new URL(fileName, tinyOfficeApiModuleUrl), "utf8");
    assert.match(moduleSource, /export /);
  }

  const baseParsing = await readFile(new URL("parsing.ts", tinyOfficeApiModuleUrl), "utf8");
  assert.ok(baseParsing.split("\n").length < 120, "parsing.ts should stay focused on generic request/value helpers");
});
