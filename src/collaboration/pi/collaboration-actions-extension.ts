import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { OperatingLogService } from "../../operating-log/operating-log-service.js";
import { capabilityRegistry } from "../../runtime/capabilities/capability-registry.js";
import { executeTinyOfficeCapabilityCallTool } from "../../runtime/capabilities/capability-tool.js";
import { recallRuntimeMemories } from "../../runtime/memory/runtime-memory-service.js";
import { WorkService } from "../../work/work-service.js";
import {
  createCollaborationPiToolGateway,
  type CollaborationPiToolExecutionContext,
} from "./collaboration-pi-tool-gateway.js";

const Optional = (Type as typeof Type & { Optional: (schema: unknown) => unknown }).Optional;

const HandoffTopicTurnParams = Type.Object({
  toId: Type.String({
    description:
      "Exactly one participant id from Handoff candidates. Use the stable id only; do not include multiple ids, display names, or explanatory text.",
  }),
});

const FinishWorkTurnParams = Type.Object({
  status: Type.String({
    description:
      "WorkRun status for this turn. Use complete only when acceptanceCriteria is satisfied and evidence is provided. Use in_progress when useful progress was made but the task is not finished and should continue. Use blocked when outside input, material, permission, dependency, or a decision is needed; include blocker fields. Use failed when the WorkRun cannot complete and this is not canceled. Use canceled only when the operator or system explicitly requested cancellation; do not self-cancel because the work is hard.",
    enum: ["in_progress", "complete", "blocked", "failed", "canceled"],
  }),
  summary: Type.String({
    description: "Short result summary in the current user-visible language.",
  }),
  evidence: Type.Array(Type.String(), {
    description: "Evidence items. Required when status is complete; include concrete proof that acceptanceCriteria was satisfied.",
  }),
  blockerMessage: Type.String({
    description: "Blocker explanation. Required when status is blocked. Use an empty string when status is not blocked.",
  }),
});

const IntakeWorkParams = Type.Object({
  title: Type.String({
    description: "Short WorkTask title in the current preferred user-visible language.",
  }),
  description: Type.String({
    description: "Useful background for the background work. Use an empty string if not needed.",
  }),
  ownerMemberId: Type.String({
    description: "Member id responsible for the planned work.",
  }),
  acceptanceCriteria: Type.String({
    description: "Concrete, observable acceptance standard for completing the Task.",
  }),
  scheduleKind: Type.String({
    description: "Choose immediate, scheduled_once, or recurring.",
    enum: ["immediate", "scheduled_once", "recurring"],
  }),
  scheduledFor: Type.String({
    description: "ISO timestamp for scheduled_once or recurring. Use an empty string for immediate work.",
  }),
  intervalMs: Optional({
    type: "number",
    description: "Positive recurrence interval in milliseconds. Required for recurring work.",
  }),
  timezone: Type.String({
    description: "Timezone for interpreting the schedule, such as Asia/Shanghai. Use an empty string if absent.",
  }),
});

const IntakeOperatingEventParams = Type.Object({
  title: Type.String({
    description: "Short operating-log title in the current preferred user-visible language.",
  }),
  message: Type.String({
    description: "Concise explanation in the current preferred user-visible language of what happened and why no task is being created.",
  }),
  severity: Type.String({
    description: "One of info, success, warning, or error.",
    enum: ["info", "success", "warning", "error"],
  }),
  sourceIntakeEventId: Type.String({
    description: "Source intake event id when this event records an inbox decision. Use an empty string if absent.",
  }),
  sourceKind: Type.String({
    description: "Optional source object kind. Use an empty string if absent.",
  }),
  sourceId: Type.String({
    description: "Optional source object id. Use an empty string if absent.",
  }),
});

const FinishIntakeTurnParams = Type.Object({
  outcome: Type.String({
    description: "Final intake triage result.",
    enum: ["create_work", "record_event"],
  }),
  message: Type.String({
    description: "Short handling note in the current user-visible language.",
  }),
  work: Optional(IntakeWorkParams),
  operatingEvent: Optional(IntakeOperatingEventParams),
});

interface FinishIntakeTurnDetails {
  status: "allowed";
  outcome: "create_work" | "record_event";
  message?: string;
  workTaskId?: string;
  workScheduleId?: string;
  workRunId?: string;
  eventId?: string;
}

const RecallMemoryParams = Type.Object({
  employeeId: Type.String({
    description: "Optional employee id to search. Use an empty string to search without an employee filter.",
  }),
  workRunId: Type.String({
    description: "Optional WorkRun id to search work-run-scoped memory. Use an empty string if absent.",
  }),
  category: Type.String({
    description: "Optional memory category to search, such as a scene type. Use an empty string if absent.",
  }),
  limit: Type.String({
    description: "Maximum memories to return, from 1 to 50. Use an empty string for the default.",
  }),
});

const TinyOfficeCapabilityListParams = Type.Object({
  scene: Optional(Type.String({
    description: "Optional runtime scene filter: chat_dm, chat_channel, or work_run.",
    enum: ["chat_dm", "chat_channel", "work_run"],
  })),
});

const TinyOfficeCapabilityDescribeParams = Type.Object({
  capabilityId: Type.String({
    description: "Capability id returned by tinyoffice_capability_list.",
  }),
});

const TinyOfficeCapabilityCallParams = Type.Object({
  capabilityId: Type.String({
    description: "Capability id to execute. Use tinyoffice_capability_describe before calling when the input schema is not already known.",
  }),
  input: Optional(Type.Object({}, {
    description: "Capability input object. Include companyId when required by the described input schema.",
    additionalProperties: true,
  })),
  confirmation: Optional(Type.Object({
    accepted: Optional(Type.String({
      description: "Set true only after the operator confirms a capability that requires confirmation.",
    })),
    typedText: Optional(Type.String({
      description: "Typed confirmation text for typed confirmation capabilities, such as RESTORE.",
    })),
    note: Optional(Type.String({
      description: "Optional operator note or constraint to carry with the confirmation.",
    })),
  }, {
    description: "Operator confirmation payload for capabilities whose confirmationPolicy.required is true.",
    additionalProperties: true,
  })),
});

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function requiredString(value: unknown, fieldName: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function requiredRuntimeContextSourceId(context: CollaborationPiToolExecutionContext): string {
  if (context.sessionKey?.includes("|intake_event|") && context.threadId) {
    return context.threadId;
  }
  const sourceId =
    context.conversationId ||
    context.messageId ||
    context.chatEntryId ||
    context.roomId ||
    context.workRunId ||
    context.channelTopicId ||
    context.sessionKey ||
    context.threadId;
  if (!sourceId) {
    throw new Error("TinyOffice runtime context source id is required.");
  }
  return sourceId;
}

function runtimeContextSourceMetadata(context: CollaborationPiToolExecutionContext): Record<string, string> | undefined {
  const metadata = {
    ...(context.conversationId ? { conversationId: context.conversationId } : {}),
    ...(context.messageId ? { messageId: context.messageId } : {}),
    ...(context.chatEntryId ? { chatEntryId: context.chatEntryId } : {}),
    ...(context.roomId ? { roomId: context.roomId } : {}),
    ...(context.workRunId ? { workRunId: context.workRunId } : {}),
    ...(context.channelTopicId ? { channelTopicId: context.channelTopicId } : {}),
    ...(context.threadId ? { threadId: context.threadId } : {}),
  };
  return Object.keys(metadata).length ? metadata : undefined;
}

function normalizeTriggerKind(value: unknown) {
  const normalized = requiredString(value, "scheduleKind");
  if (
    normalized !== "immediate" &&
    normalized !== "scheduled_once" &&
    normalized !== "recurring"
  ) {
    throw new Error("scheduleKind is invalid.");
  }
  return normalized;
}

export default function collaborationActionsExtension(pi: ExtensionAPI) {
  const gateway = createCollaborationPiToolGateway();

  pi.registerTool({
    name: "tinyoffice_capability_list",
    label: "TinyOffice Capability List",
    description: "List registered TinyOffice capabilities available to employee runtimes. Call this before writing ordinary files whenever the operator asks to create or change a persistent reusable method, workflow, template, or ability for future work, especially when it should be available to the whole Company or another Employee. Natural-language requests do not need to name a Capability or Skill.",
    parameters: TinyOfficeCapabilityListParams,
    async execute(_toolCallId: string, params: unknown) {
      const typed = params as { scene?: unknown };
      const scene = optionalString(typed.scene);
      const capabilities = capabilityRegistry.capabilities
        .filter((entry) => !scene || entry.allowedScenes.includes(scene as never))
        .map((entry) => ({
          id: entry.id,
          category: entry.category,
          title: entry.title,
          effect: entry.effect,
          allowedScenes: entry.allowedScenes,
          requiresOperatorConfirmation: entry.confirmationPolicy.required,
          useWhen: entry.useWhen,
        }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              schema: "tinyoffice-capability-list",
              version: 1,
              capabilities,
            }, null, 2),
          },
        ],
        details: {
          status: "allowed",
          capabilities,
        },
      };
    },
  });

  pi.registerTool({
    name: "tinyoffice_capability_describe",
    label: "TinyOffice Capability Describe",
    description: "Describe one registered TinyOffice capability, including input schema and confirmation policy.",
    parameters: TinyOfficeCapabilityDescribeParams,
    async execute(_toolCallId: string, params: unknown) {
      const typed = params as { capabilityId?: unknown };
      const capabilityId = requiredString(typed.capabilityId, "capabilityId");
      const entry = capabilityRegistry.capabilities.find((candidate) => candidate.id === capabilityId);
      if (!entry) {
        throw new Error(`tinyoffice_capability_describe ${capabilityId} is not registered in the capability registry.`);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(entry, null, 2),
          },
        ],
        details: {
          status: "allowed",
          capability: entry,
        },
      };
    },
  });

  pi.registerTool({
    name: "tinyoffice_capability_call",
    label: "TinyOffice Capability Call",
    description: "Execute a registered TinyOffice capability from the current employee runtime context.",
    parameters: TinyOfficeCapabilityCallParams,
    async execute(_toolCallId: string, params: unknown) {
      const typed = params as {
        capabilityId?: unknown;
        input?: unknown;
        confirmation?: unknown;
      };
      const context = gateway.optionalAmbientConversationContext();
      const result = await executeTinyOfficeCapabilityCallTool({
        repoRoot: gateway.repoRoot(),
        companyId: gateway.optionalCompanyId(context),
        actorMemberId: context?.actorMemberId,
        runtimeEmployeeId: process.env.PI_EMPLOYEE_ID,
        channelTopicId: context?.channelTopicId,
        workRunId: context?.workRunId,
        threadId: context?.threadId,
        roomId: context?.roomId,
        conversationId: context?.conversationId,
        messageId: context?.messageId,
        chatEntryId: context?.chatEntryId,
        sessionKey: context?.sessionKey,
        capabilityId: typed.capabilityId,
        input: typed.input,
        confirmation: typed.confirmation,
      });
      return {
        content: [
          {
            type: "text",
            text: [
              `tinyoffice_capability_call completed ${result.capabilityId}.`,
              "Result:",
              JSON.stringify(result.result, null, 2),
            ].join("\n"),
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "handoff_topic_turn",
    label: "Handoff Topic Turn",
    description:
      "Required channel-topic state action. This must be called exactly once during each channel-topic turn to select the single Handoff candidate who owns the next step.",
    parameters: HandoffTopicTurnParams,
    async execute(_toolCallId: string, params: unknown) {
      return {
        content: [
          {
            type: "text",
            text: "handoff_topic_turn recorded.",
          },
        ],
        details: {
          status: "allowed",
          result: params,
        },
      };
    },
  });

  pi.registerTool({
    name: "finish_work_turn",
    label: "Finish Work Turn",
    description:
      [
        "Submit the structured result for this WorkRun turn. This is the formal WorkRun state exit.",
        "Use complete when you judge acceptanceCriteria is satisfied and can provide evidence.",
        "Use in_progress when you made progress but the WorkRun is not finished.",
        "Use blocked when you need outside input, material, permission, dependency, or a decision.",
        "Use failed when you cannot complete the WorkRun.",
        "Use canceled only when operator requested cancellation or the system explicitly requested cancellation.",
      ].join(" "),
    parameters: FinishWorkTurnParams,
    async execute(_toolCallId: string, params: unknown) {
      return {
        content: [
          {
            type: "text",
            text: "finish_work_turn recorded.",
          },
        ],
        details: {
          status: "allowed",
          result: params,
        },
      };
    },
  });

  pi.registerTool({
    name: "finish_intake_turn",
    label: "Finish Intake Turn",
    description:
      "Submit the final structured result for this external intake event. The result creates work, records an operating event, or requests approval.",
    parameters: FinishIntakeTurnParams,
    async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<FinishIntakeTurnDetails>> {
      const typed = params as {
        outcome?: string;
        message?: string;
        work?: Record<string, unknown>;
        operatingEvent?: Record<string, unknown>;
      };
      const context = gateway.buildContext();
      const repoRoot = gateway.repoRoot();
      const actorMemberId = requiredString(context.actorMemberId, "actorMemberId");

      if (typed.outcome === "create_work") {
        const work = typed.work || {};
        const sourceId = requiredRuntimeContextSourceId(context);
        const workService = new WorkService({ repoRoot, companyId: context.companyId });
        const created = await workService.createWork({
          title: requiredString(work.title, "work.title"),
          description: optionalString(work.description),
          createdByMemberId: actorMemberId,
          ownerMemberId: requiredString(work.ownerMemberId, "work.ownerMemberId"),
          sourceKind: "intake_event",
          sourceId,
          requesterId: actorMemberId,
          acceptanceCriteria: requiredString(work.acceptanceCriteria, "work.acceptanceCriteria"),
          metadata: runtimeContextSourceMetadata(context),
          trigger: {
            kind: normalizeTriggerKind(work.scheduleKind),
            scheduledFor: optionalString(work.scheduledFor),
            intervalMs: optionalNumber(work.intervalMs),
            timezone: optionalString(work.timezone),
          },
        });

        return {
          content: [
            {
              type: "text",
              text: `finish_intake_turn created WorkTask ${created.task.id}.`,
            },
          ],
          details: {
            status: "allowed",
            outcome: "create_work",
            message: typed.message,
            workTaskId: created.task.id,
            workScheduleId: created.schedule?.id,
            workRunId: created.run?.id,
          },
        };
      }

      if (typed.outcome === "record_event") {
        const operatingEvent = typed.operatingEvent || {};
        const sourceId = requiredRuntimeContextSourceId(context);
        const operatingLogService = new OperatingLogService({ repoRoot, companyId: context.companyId });
        const event = await operatingLogService.recordEvent({
          actorMemberId,
          title: requiredString(operatingEvent.title, "operatingEvent.title"),
          message: requiredString(operatingEvent.message, "operatingEvent.message"),
          severity: optionalString(operatingEvent.severity) as "info" | "success" | "warning" | "error" | undefined,
          sourceIntakeEventId: context.threadId,
          sourceKind: optionalString(operatingEvent.sourceKind) || "intake_event",
          sourceId: optionalString(operatingEvent.sourceId) || sourceId,
        });

        return {
          content: [
            {
              type: "text",
              text: `finish_intake_turn recorded operating event ${event.id}.`,
            },
          ],
          details: {
            status: "allowed",
            outcome: "record_event",
            message: typed.message,
            eventId: event.id,
          },
        };
      }

      throw new Error("finish_intake_turn outcome is invalid.");
    },
  });

  pi.registerTool({
    name: "recall_memory",
    label: "Recall Memory",
    description: "Search durable runtime memory summaries from the company database by employee, WorkRun id, or memory category. This is read-only and does not route ownership or change task state.",
    parameters: RecallMemoryParams,
    async execute(_toolCallId: string, params: unknown) {
      const typed = params as {
        employeeId?: string;
        workRunId?: string;
        category?: string;
        limit?: string | number;
      };
      const context = gateway.buildContext();
      const memories = await recallRuntimeMemories({
        repoRoot: gateway.repoRoot(),
        companyId: context.companyId,
        employeeId: optionalString(typed.employeeId),
        workRunId: optionalString(typed.workRunId),
        category: optionalString(typed.category),
        limit: optionalNumber(typed.limit),
      });

      return {
        content: [
          {
            type: "text",
            text: memories.length
              ? memories
                  .map((memory) => `${memory.title}\n${memory.summary}`)
                  .join("\n\n")
              : "No matching memory summaries found.",
          },
        ],
        details: {
          status: "allowed",
          memories,
        },
      };
    },
  });

}
