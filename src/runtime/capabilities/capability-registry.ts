export type CapabilityEffect = "read" | "create" | "update" | "restore" | "delete" | "execute";
export type CapabilityCategory = "member" | "chat" | "work" | "runtime" | "governance" | "system";
export type CapabilityScene = "chat_dm" | "chat_channel" | "work_run";

export interface CapabilitySchemaProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  enum?: readonly string[];
  properties?: Record<string, CapabilitySchemaProperty>;
  items?: CapabilitySchemaProperty;
  additionalProperties?: boolean;
}

export interface CapabilitySchema {
  type: "object";
  description?: string;
  required?: readonly string[];
  additionalProperties?: boolean;
  properties: Record<string, CapabilitySchemaProperty>;
}

export interface CapabilityConfirmationPolicy {
  required: boolean;
  mode: "none" | "operator" | "typed";
  typedText?: string;
  description?: string;
}

export interface CapabilityEntry {
  id: string;
  category: CapabilityCategory;
  title: string;
  description: string;
  effect: CapabilityEffect;
  allowedScenes: CapabilityScene[];
  confirmationPolicy: CapabilityConfirmationPolicy;
  useWhen: string;
  inputSchema: CapabilitySchema;
  outputSchema: CapabilitySchema;
  notes: string[];
}

export interface CapabilityRegistry {
  schema: "tinyoffice-capability-registry";
  version: 1;
  scope: "system";
  capabilities: CapabilityEntry[];
}

const companyIdProperty: CapabilitySchemaProperty = {
  type: "string",
  required: true,
  description: "Current TinyOffice company id. It must match the runtime company context.",
};

export const capabilityRegistry = {
  schema: "tinyoffice-capability-registry",
  version: 1,
  scope: "system",
  capabilities: [
    {
      id: "company.member.directory.list",
      category: "member",
      title: "List company member directory",
      description:
        "Returns company members that can be selected for employee recruitment, channel creation, and collaboration workflows.",
      effect: "read",
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
      confirmationPolicy: { required: false, mode: "none" },
      useWhen: "Use before selecting people for an employee, channel, or collaboration workflow.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          schema: { type: "string" },
          companyId: { type: "string" },
          members: {
            type: "array",
            items: {
              type: "object",
              properties: {
                participantKind: { type: "string", description: "Always company_member." },
                memberId: { type: "string" },
                displayName: { type: "string" },
                role: { type: "string" },
                summary: { type: "string" },
                hasRuntimeProfile: { type: "boolean" },
              },
            },
          },
        },
      },
      notes: [
        "Compare proposed names case-insensitively and trim extra whitespace.",
        "Directory output uses members[].participantKind: company_member.",
        "Use members[].memberId when selecting a returned directory entry.",
        "Do not guess memberId from displayName; use the ids returned here.",
      ],
    },
    {
      id: "runtime.models.list",
      category: "runtime",
      title: "List available runtime models",
      description: "Returns runtime model providers, model ids, and supported thinking levels.",
      effect: "read",
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
      confirmationPolicy: { required: false, mode: "none" },
      useWhen: "Use before recommending an employee runtime model or thinking level.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          schema: { type: "string" },
          availableModels: {
            type: "array",
            items: {
              type: "object",
              properties: {
                provider: { type: "string" },
                id: { type: "string" },
                name: { type: "string" },
                reasoning: { type: "boolean" },
              },
            },
          },
          thinkingLevels: { type: "array", items: { type: "string" } },
        },
      },
      notes: [
        "Never recommend a runtime model that is not present in availableModels.",
        "If availableModels is empty, ask the operator to configure runtime models before creating a runtime-capable employee.",
      ],
    },
    {
      id: "intake.integration.describe",
      category: "system",
      title: "Describe external Intake integration",
      description:
        "Returns the machine-readable HTTP contract an AI employee needs when connecting an external system to TinyOffice Intake.",
      effect: "read",
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
      confirmationPolicy: { required: false, mode: "none" },
      useWhen: "Use before writing or changing automation code that sends external events into TinyOffice.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { companyId: companyIdProperty },
      },
      outputSchema: {
        type: "object",
        properties: {
          schema: { type: "string" },
          companyId: { type: "string" },
          method: { type: "string" },
          endpointPath: { type: "string" },
          contentType: { type: "string" },
          targetSelectionCapabilityId: { type: "string" },
          requestContract: { type: "object" },
          idempotency: { type: "object" },
          acceptedResponse: { type: "object" },
          implementationGuidance: { type: "array", items: { type: "string" } },
        },
      },
      notes: [
        "This capability describes an integration contract; it does not send an Intake event itself.",
        "Use company.member.directory.list and select an active runtime-capable member before writing routing.targetMemberId.",
        "Keep business workflow logic in the external automation and employee guidance, not in the Intake transport.",
      ],
    },
    {
      id: "skill.list",
      category: "system",
      title: "List Company or Employee Skills",
      description: "Lists user-managed Skills in exactly one Company or Employee scope.",
      effect: "read",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: { required: false, mode: "none" },
      useWhen: "Use when the operator asks in natural language to create, inspect, or change a persistent reusable method, workflow, template, or ability for future executions. Company-wide or cross-employee reuse is a strong Company Skill signal. Call before writing ordinary workspace documents so names and scope are not guessed or overwritten.",
      inputSchema: {
        type: "object",
        required: ["companyId", "scope"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          scope: {
            type: "object",
            description: "Use kind company, or kind employee with a memberId from company.member.directory.list.",
            properties: {
              kind: { type: "string", enum: ["company", "employee"] },
              memberId: { type: "string" },
            },
          },
        },
      },
      outputSchema: { type: "object", properties: { companyId: { type: "string" }, scope: { type: "object" }, skills: { type: "array", items: { type: "object" } } } },
      notes: [
        "TinyOffice has no user-managed system Skill scope. System operations are capabilities.",
        "Company Skills affect the current Company only. Employee Skills affect one runtime-capable member.",
        "A document written into one Employee workspace is not a Company Skill and is not automatically loaded by other employees.",
      ],
    },
    {
      id: "skill.describe",
      category: "system",
      title: "Describe one Company or Employee Skill",
      description: "Reads one existing user-managed Skill and its package files from an explicit scope.",
      effect: "read",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: { required: false, mode: "none" },
      useWhen: "Use after skill.list and before proposing a Skill update.",
      inputSchema: {
        type: "object",
        required: ["companyId", "scope", "skillName"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          scope: { type: "object", properties: { kind: { type: "string", enum: ["company", "employee"] }, memberId: { type: "string" } } },
          skillName: { type: "string" },
        },
      },
      outputSchema: { type: "object", properties: { companyId: { type: "string" }, scope: { type: "object" }, skillName: { type: "string" }, files: { type: "array", items: { type: "object" } } } },
      notes: ["Unknown Skills and wrong scopes fail explicitly."],
    },
    {
      id: "skill.create",
      category: "system",
      title: "Create a Company or Employee Skill",
      description: "Validates and creates a new user-managed Skill package in the current Company or one Employee scope, then schedules safe runtime reload after the current Chat turn.",
      effect: "create",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: { required: true, mode: "operator", description: "Show the scope, target, name, purpose, files, and affected employees; call only after explicit operator confirmation." },
      useWhen: "Use after clarifying realistic examples, choosing Company versus Employee scope, listing existing Skills, and receiving explicit confirmation.",
      inputSchema: {
        type: "object",
        required: ["companyId", "scope", "skillName", "files"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          scope: { type: "object", properties: { kind: { type: "string", enum: ["company", "employee"] }, memberId: { type: "string" } } },
          skillName: { type: "string", description: "Lowercase hyphen-case name, at most 64 characters." },
          files: { type: "array", description: "Complete files to create. Must contain SKILL.md; optional paths are limited to references, scripts, and assets.", items: { type: "object", properties: { relativePath: { type: "string" }, content: { type: "string" } } } },
        },
      },
      outputSchema: { type: "object", properties: { companyId: { type: "string" }, scope: { type: "object" }, skillName: { type: "string" }, operation: { type: "string" }, files: { type: "array", items: { type: "string" } }, affectedMemberIds: { type: "array", items: { type: "string" } }, reload: { type: "object" } } },
      notes: [
        "A Skill is reusable workflow knowledge, not a substitute for a TinyOffice system capability.",
        "Prefer Company scope only when every employee in the current Company should be able to use the workflow; otherwise use Employee scope.",
        "When the operator asks for a method that future executions or other employees can directly use, create a Skill package instead of claiming that ordinary workspace Markdown is shared runtime knowledge.",
        "SKILL.md must use valid frontmatter with a matching name and an explicit trigger description.",
        "Do not create broad, speculative, duplicate, or test-only Skills. Ground the Skill in concrete user examples.",
        "Creation never overwrites an existing Skill. Use skill.update after describing the existing Skill.",
      ],
    },
    {
      id: "skill.update",
      category: "system",
      title: "Update a Company or Employee Skill",
      description: "Validates and atomically updates named files in an existing scoped Skill, then schedules safe runtime reload after the current Chat turn.",
      effect: "update",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: { required: true, mode: "operator", description: "Show the current scope and proposed file changes; call only after explicit operator confirmation." },
      useWhen: "Use after skill.describe, a clear proposed change, and explicit operator confirmation.",
      inputSchema: {
        type: "object",
        required: ["companyId", "scope", "skillName", "files"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          scope: { type: "object", properties: { kind: { type: "string", enum: ["company", "employee"] }, memberId: { type: "string" } } },
          skillName: { type: "string" },
          files: { type: "array", description: "Named files to replace. Must contain the complete validated SKILL.md; omitted package files remain unchanged.", items: { type: "object", properties: { relativePath: { type: "string" }, content: { type: "string" } } } },
        },
      },
      outputSchema: { type: "object", properties: { companyId: { type: "string" }, scope: { type: "object" }, skillName: { type: "string" }, operation: { type: "string" }, files: { type: "array", items: { type: "string" } }, affectedMemberIds: { type: "array", items: { type: "string" } }, reload: { type: "object" } } },
      notes: ["Update never creates a missing Skill and never deletes omitted package files."],
    },
    {
      id: "member.profile.describe",
      category: "member",
      title: "Describe company member profile",
      description:
        "Returns an AI-readable company member profile for task assignment, channel planning, and collaboration decisions.",
      effect: "read",
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
      confirmationPolicy: { required: false, mode: "none" },
      useWhen: "Use when deciding who a member is, what they are responsible for, or whether they can receive runtime work.",
      inputSchema: {
        type: "object",
        required: ["companyId", "memberId"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          memberId: { type: "string", description: "Company member id from company.member.directory.list or Work owner/assignee fields." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          schema: { type: "string" },
          companyId: { type: "string" },
          member: { type: "object" },
        },
      },
      notes: [
        "This capability describes collaboration identity, not editable employee configuration.",
        "Do not expose employee resource policy or raw runtime model configuration here.",
        "Use company.member.directory.list first when selecting from multiple members.",
      ],
    },
    {
      id: "employee.recruit",
      category: "member",
      title: "Recruit runtime-capable employee",
      description:
        "Creates a TinyOffice employee profile, runtime configuration, home assets, workspace, skills directory, and optional AGENTS.md guidance.",
      effect: "create",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms the recommended employee draft.",
      },
      useWhen: "Use after the operator confirms a draft for recruiting or creating a runtime-capable TinyOffice employee.",
      inputSchema: {
        type: "object",
        required: ["companyId", "displayName", "role", "summary", "runtime"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          employeeId: {
            type: "string",
            required: false,
            description: "Stable lowercase employee id. If omitted, the capability derives a unique id from displayName.",
          },
          displayName: { type: "string", description: "Human-readable employee name." },
          role: {
            type: "string",
            description:
              "Concise, human-readable English Company title of 1-3 natural words, such as Content Ops or SEO Specialist. Do not use an id, kebab-case, or a responsibility sentence.",
          },
          summary: {
            type: "string",
            description: "Short company-directory responsibility. Keep detailed guidance out of this field.",
          },
          presenceMode: {
            type: "string",
            enum: ["resident", "auto_exit_idle"],
            description: "Employee runtime presence mode.",
          },
          runtime: {
            type: "object",
            properties: {
              version: { type: "number", description: "Use 1." },
              modelProvider: { type: "string" },
              modelId: { type: "string" },
              thinkingLevel: {
                type: "string",
                enum: ["off", "minimal", "low", "medium", "high", "xhigh"],
              },
            },
          },
          resourcePolicy: { type: "object", additionalProperties: true },
          instructionContent: {
            type: "string",
            description: "Initial employee-local AGENTS.md personal operating guidance with detailed responsibilities.",
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          employee: { type: "object", description: "Created employee profile and runtime configuration." },
          localAssets: { type: "object", description: "Home, workspace, skills, and instruction file paths." },
        },
      },
      notes: [
        "New recruited employees default to resident presence when presenceMode is omitted.",
        "Structured identity facts live in the database; detailed personal guidance belongs in the employee AGENTS.md.",
        "Do not claim success until the capability returns successfully.",
      ],
    },
    {
      id: "chat.channel.create",
      category: "chat",
      title: "Create Chat channel",
      description: "Creates a Chat channel with selected company members. The runtime context supplies the creating member identity.",
      effect: "create",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms the channel title and member list.",
      },
      useWhen: "Use after the operator confirms a group chat or channel should be created with selected members.",
      inputSchema: {
        type: "object",
        required: ["companyId", "title"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          title: { type: "string", description: "Human-readable channel name." },
          summary: { type: "string", description: "Short purpose for the channel." },
          members: {
            type: "array",
            description: "Company member selectors. Each item must contain only memberId.",
            items: {
              type: "object",
              properties: {
                memberId: { type: "string", description: "Company member id from company.member.directory.list." },
              },
            },
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          chatChannelId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          members: { type: "array", items: { type: "object" } },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
        },
      },
      notes: [
        "Do not create channels without operator confirmation unless the operator explicitly asked to create it directly.",
        "Channel input uses members[].memberId selectors only.",
        "Do not invent ids. Use company.member.directory.list immediately before calling this capability.",
      ],
    },
    {
      id: "work.create",
      category: "work",
      title: "Create background Work",
      description: "Creates a formal background Work task, optional schedule, and queued run from a confirmed DM or Channel discussion.",
      effect: "create",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms the Work creation checklist.",
      },
      useWhen: "Use after a confirmed DM or Channel discussion should become formal background Work.",
      inputSchema: {
        type: "object",
        required: ["companyId", "title", "ownerMemberId", "acceptanceCriteria", "trigger"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          title: { type: "string", description: "Short human-readable Work title." },
          description: { type: "string", description: "Optional detail about the Work objective and context." },
          ownerMemberId: { type: "string", description: "Company member id responsible for executing the Work." },
          acceptanceCriteria: { type: "string", description: "Observable standard that means the Task is complete." },
          trigger: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["immediate", "scheduled_once", "recurring"],
              },
              scheduledFor: { type: "string", description: "RFC3339 timestamp with an explicit Z or UTC offset for scheduled_once or recurring Work." },
              intervalMs: { type: "number", description: "Simple recurring interval in milliseconds." },
              timezone: { type: "string", description: "Optional timezone label." },
              cron: { type: "string", description: "Optional cron expression." },
            },
          },
          maxRuns: { type: "number", description: "Optional cap for recurring Work." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          task: { type: "object", description: "Created WorkTask, including task.id." },
          schedule: { type: "object", description: "Created WorkSchedule when scheduled." },
          run: { type: "object", description: "Queued WorkRun when applicable." },
        },
      },
      notes: [
        "DM/Channel creation requires operator confirmation before calling this capability.",
        "Intake work creation may skip confirmation only when explicit employee guidance allows the intake signal to become Work.",
        "Do not use this capability to update WorkRun completion state; the execution scene reports its final result through the WorkRun result contract.",
      ],
    },
    {
      id: "work.list",
      category: "work",
      title: "List relevant Work",
      description:
        "Returns AI-readable Work task summaries. By default it lists Work relevant to the current employee or current conversation context.",
      effect: "read",
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
      confirmationPolicy: { required: false, mode: "none" },
      useWhen: "Use when deciding what Work exists, what the current employee owns, or whether Work needs attention.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          scope: {
            type: "string",
            enum: ["mine", "company"],
            description: "Defaults to mine. Use company only when the operator asks for company-wide Work.",
          },
          ownerMemberId: { type: "string", description: "Optional owner member filter." },
          status: {
            type: "string",
            enum: ["active", "completed", "canceled", "archived"],
            description: "Optional WorkTask status filter.",
          },
          attentionOnly: { type: "boolean", description: "When true, return only Work with blocked or failed execution attention signals." },
          limit: { type: "number", description: "Maximum summaries to return. Defaults to 20 and caps at 50." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          schema: { type: "string" },
          companyId: { type: "string" },
          scope: { type: "string" },
          tasks: { type: "array", items: { type: "object" } },
        },
      },
      notes: [
        "Use scope: mine by default. Use scope: company only when the operator asks for company-wide Work.",
        "This is a read capability; do not use it to cancel, archive, or mutate Work.",
        "Use work.describe when a returned workTaskId needs full detail.",
      ],
    },
    {
      id: "work.describe",
      category: "work",
      title: "Describe Work detail",
      description: "Returns AI-readable detail for one Work task, including schedules, runs, and optional latest run events.",
      effect: "read",
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
      confirmationPolicy: { required: false, mode: "none" },
      useWhen: "Use after work.list or when the operator names a specific Work task that needs inspection.",
      inputSchema: {
        type: "object",
        required: ["companyId", "workTaskId"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          workTaskId: { type: "string", description: "WorkTask id returned by work.list or Work creation." },
          includeEvents: { type: "boolean", description: "When true, include latest WorkRun events." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          schema: { type: "string" },
          companyId: { type: "string" },
          task: { type: "object" },
          schedules: { type: "array", items: { type: "object" } },
          runs: { type: "array", items: { type: "object" } },
          latestRunEvents: { type: "array", items: { type: "object" } },
          needsAttention: { type: "boolean" },
          suggestedNextStep: { type: "string" },
        },
      },
      notes: [
        "This capability is for inspection only.",
        "includeEvents should be used when the employee needs to explain a blocked or failed run.",
        "Unknown workTaskId fails explicitly instead of returning an empty detail.",
      ],
    },
    {
      id: "work.cancel",
      category: "work",
      title: "Cancel Work",
      description: "Cancels an active WorkTask, its future schedules, and any non-terminal WorkRuns.",
      effect: "update",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms which Work should be canceled and why.",
      },
      useWhen: "Use after the operator confirms that an active Task should stop completely.",
      inputSchema: {
        type: "object",
        required: ["companyId", "workTaskId", "reason"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          workTaskId: { type: "string", description: "WorkTask id returned by work.list or work.describe." },
          reason: { type: "string", description: "Operator-confirmed reason for canceling the Task." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          task: { type: "object" },
          schedules: { type: "array", items: { type: "object" } },
          runs: { type: "array", items: { type: "object" } },
        },
      },
      notes: [
        "Cancel affects the whole Task, including future schedule triggers.",
        "Use schedule.cancel when only a named schedule is being managed.",
      ],
    },
    {
      id: "work.revise",
      category: "work",
      title: "Revise confirmed Work objective",
      description: "Updates an active WorkTask objective after the operator explicitly confirms a changed direction, while preserving revision history.",
      effect: "update",
      allowedScenes: ["chat_dm", "chat_channel", "work_run"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Restate the new objective and only call after the operator explicitly confirms the revision.",
      },
      useWhen: "Use when the operator changes the Task goal, brief, or acceptance criteria; ordinary clarification must remain only in the conversation.",
      inputSchema: {
        type: "object",
        required: ["companyId", "workTaskId", "reason"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          workTaskId: { type: "string" },
          title: { type: "string", description: "Confirmed replacement title when it changed." },
          description: { type: "string", description: "Confirmed replacement brief when it changed." },
          acceptanceCriteria: { type: "string", description: "Confirmed replacement completion standard when it changed." },
          reason: { type: "string", description: "Why the operator changed direction." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          task: { type: "object" },
          revisions: { type: "array", items: { type: "object" } },
          runs: { type: "array", items: { type: "object" } },
        },
      },
      notes: [
        "Do not call for ordinary facts, credentials, or clarification that leave the objective unchanged.",
        "In a blocked WorkRun, the current Run moves to the new Task revision and continues in the original session.",
      ],
    },
    {
      id: "work.retry",
      category: "work",
      title: "Retry failed WorkRun",
      description: "Creates a new queued WorkRun from one failed WorkRun while keeping its WorkTask active.",
      effect: "execute",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms the failed WorkRun should be retried.",
      },
      useWhen: "Use after work.describe identifies a failed WorkRun and the operator confirms retry.",
      inputSchema: {
        type: "object",
        required: ["companyId", "workRunId"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          workRunId: { type: "string", description: "Failed WorkRun id returned by work.describe." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          run: { type: "object", description: "The newly queued retry WorkRun." },
        },
      },
      notes: ["Only failed WorkRuns can be retried; active or completed runs fail explicitly."],
    },
    {
      id: "work.archive",
      category: "work",
      title: "Archive inactive Work",
      description: "Archives a completed or canceled WorkTask without deleting its evidence.",
      effect: "update",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms the inactive Task should leave the default Tasks list.",
      },
      useWhen: "Use after the operator confirms a completed or canceled Task should be archived.",
      inputSchema: {
        type: "object",
        required: ["companyId", "workTaskId"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          workTaskId: { type: "string" },
          reason: { type: "string", description: "Optional archive note." },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          task: { type: "object" },
        },
      },
      notes: ["Archiving preserves WorkRuns, Sessions, Process Trace, and source Chat evidence."],
    },
    {
      id: "work.restore",
      category: "work",
      title: "Restore archived Work",
      description: "Restores an archived WorkTask to its previous completed or canceled state.",
      effect: "restore",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms the archived Task should be restored.",
      },
      useWhen: "Use after the operator confirms an archived Task should return to normal visibility.",
      inputSchema: {
        type: "object",
        required: ["companyId", "workTaskId"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          workTaskId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          task: { type: "object" },
        },
      },
      notes: ["Restore changes visibility only; it does not restart execution or reactivate a canceled schedule."],
    },
    {
      id: "schedule.pause",
      category: "work",
      title: "Pause Work schedule",
      description: "Pauses an enabled WorkSchedule without canceling its parent Task.",
      effect: "update",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms the schedule and pause reason.",
      },
      useWhen: "Use when future runs should stop temporarily but the Task should remain available.",
      inputSchema: {
        type: "object",
        required: ["companyId", "workScheduleId", "reason"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          workScheduleId: { type: "string" },
          reason: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: { companyId: { type: "string" }, schedule: { type: "object" } },
      },
      notes: ["Pause is reversible through schedule.resume."],
    },
    {
      id: "schedule.resume",
      category: "work",
      title: "Resume Work schedule",
      description: "Re-enables a paused WorkSchedule.",
      effect: "update",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms the paused schedule should resume.",
      },
      useWhen: "Use when the operator wants future runs from a paused schedule to continue.",
      inputSchema: {
        type: "object",
        required: ["companyId", "workScheduleId"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          workScheduleId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: { companyId: { type: "string" }, schedule: { type: "object" } },
      },
      notes: ["Canceled or completed schedules cannot be resumed."],
    },
    {
      id: "schedule.cancel",
      category: "work",
      title: "Cancel Work schedule",
      description: "Permanently cancels a WorkSchedule and closes its parent Task.",
      effect: "update",
      allowedScenes: ["chat_dm", "chat_channel"],
      confirmationPolicy: {
        required: true,
        mode: "operator",
        description: "Only call after the operator confirms the schedule should be permanently canceled.",
      },
      useWhen: "Use when a future or recurring schedule should never produce another run.",
      inputSchema: {
        type: "object",
        required: ["companyId", "workScheduleId", "reason"],
        additionalProperties: false,
        properties: {
          companyId: companyIdProperty,
          workScheduleId: { type: "string" },
          reason: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        properties: { companyId: { type: "string" }, schedule: { type: "object" } },
      },
      notes: ["Schedule cancellation is terminal; use schedule.pause for a reversible stop."],
    },
  ],
} as const satisfies CapabilityRegistry;

export type CapabilityEntryId = (typeof capabilityRegistry.capabilities)[number]["id"];

export function getCapabilityEntry(id: string): CapabilityEntry | undefined {
  return capabilityRegistry.capabilities.find((entry) => entry.id === id);
}
