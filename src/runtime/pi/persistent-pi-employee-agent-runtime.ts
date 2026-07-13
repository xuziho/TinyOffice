import type { ParticipantRef } from "../../collaboration/contracts/participant-ref.js";
import { resolvePreferredLanguage } from "../language/preferred-language.js";
import {
  buildPromptInputPackage,
} from "../provider/prompt-input-package.js";
import type { EmployeeHome } from "../registry/employee-home.js";
import {
  deriveRuntimeSceneType,
  deriveRuntimeSubjectId,
} from "../orchestration/runtime-turn-identity.js";
import { DefaultPiSessionTransport } from "./persistent-pi-session-transport.js";
import {
  buildSystemPromptAppend,
  buildUserPrompt,
  loadConfiguredPromptTemplates,
} from "./persistent-pi-employee-agent-prompt-builder.js";
import {
  companyScopeFromEmployeeHome,
} from "./persistent-pi-employee-agent-paths.js";
import {
  loadCompanyPromptBlocks,
} from "./persistent-pi-employee-agent-prompt-resources.js";
import type {
  PersistentPiEmployeeAgentReply,
  PersistentPiEmployeeAgentResponseInput,
  PersistentPiEmployeeAgentStatus,
  PiSessionTransport,
} from "./persistent-pi-employee-agent-contracts.js";
import { nowIso } from "./persistent-pi-transport-state.js";

function buildConversationContextEnv(input: PersistentPiEmployeeAgentResponseInput & { companyId: string }): NodeJS.ProcessEnv {
  const sceneType = deriveRuntimeSceneType(input.sessionKey);
  return {
    PI_CONVERSATION_CONTEXT_JSON: JSON.stringify({
      companyId: input.companyId,
      ...(sceneType === "work_run_execution"
        ? { workRunId: deriveRuntimeSubjectId(input.sessionKey) }
        : {}),
      ...(input.channelTopicId ? { channelTopicId: input.channelTopicId } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.roomId ? { roomId: input.roomId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.chatEntryId ? { chatEntryId: input.chatEntryId } : {}),
      sessionKey: input.sessionKey,
      ...(input.actorMemberId ? { actorMemberId: input.actorMemberId } : {}),
      reachableMemberIds: input.reachableMemberIds || [],
      reachableParticipants: input.reachableParticipants || [],
      preferredLanguage: resolvePreferredLanguage({
        explicit: input.preferredLanguage,
        text: input.message,
        env: process.env,
      }),
    }),
  };
}

export class PersistentPiEmployeeAgent {
  private status: PersistentPiEmployeeAgentStatus;
  private operationChain: Promise<unknown> = Promise.resolve();
  private readonly transport: PiSessionTransport;

  constructor(
    readonly employee: EmployeeHome,
    private readonly options: {
      sessionRootPath: string;
      sessionKey?: string;
      transport?: PiSessionTransport;
      env?: NodeJS.ProcessEnv;
    },
  ) {
    this.transport = options.transport ?? new DefaultPiSessionTransport();
    this.status = {
      companyId: employee.companyId,
      employeeId: employee.employeeId,
      sessionKey: options.sessionKey || "default",
      bootstrapped: false,
      sessionDir: options.sessionRootPath,
    };
  }

  getStatus(): PersistentPiEmployeeAgentStatus {
    return { ...this.status };
  }

  async start(input?: { sessionKey?: string }): Promise<void> {
    if (this.status.bootstrapped) {
      return;
    }

    const sessionKey = input?.sessionKey || this.options.sessionKey || "default";
    const companyScope = companyScopeFromEmployeeHome(this.employee.homePath);
    const templates = await loadConfiguredPromptTemplates(companyScope);
    const promptBlocks = await loadCompanyPromptBlocks({
      employeeHomePath: this.employee.homePath,
      sessionKey,
    });
    await this.transport.start({
      cwd: this.employee.workspacePath,
      employeeHomePath: this.employee.homePath,
      sessionDir: this.status.sessionDir,
      env: {
        ...process.env,
        ...this.options.env,
      },
      systemPromptAppend: buildSystemPromptAppend({
        employee: this.employee,
        sessionKey,
        templateContent: templates.baseSystemPromptTemplate,
      }),
      promptBlocks,
    });

    this.status = {
      ...this.status,
      sessionKey,
      bootstrapped: true,
    };
  }

  async abort(): Promise<void> {
    await this.transport.abort?.();
  }

  async reply(
    input: PersistentPiEmployeeAgentResponseInput,
  ): Promise<PersistentPiEmployeeAgentReply> {
    const replyPromise = this.operationChain.then(async () => {
      await this.start({ sessionKey: input.sessionKey });
      const promptBlocks = await loadCompanyPromptBlocks({
        employeeHomePath: this.employee.homePath,
        sessionKey: input.sessionKey,
      });
      const companyScope = companyScopeFromEmployeeHome(this.employee.homePath);
      const templates = await loadConfiguredPromptTemplates(companyScope);
      const systemPromptAppend = buildSystemPromptAppend({
        employee: this.employee,
        sessionKey: input.sessionKey,
        templateContent: templates.baseSystemPromptTemplate,
      });
      const userPrompt = buildUserPrompt({
        employee: this.employee,
        message: input.message,
        sessionKey: input.sessionKey,
        channelTopicId: input.channelTopicId,
        threadId: input.threadId,
        reachableMemberIds: input.reachableMemberIds,
        reachableParticipants: input.reachableParticipants,
        contextBlocks: input.contextBlocks,
        promptBlocks,
        requesterUsername: input.requesterUsername,
        preferredLanguage: input.preferredLanguage,
        runtimePromptTemplate: templates.runtimePromptTemplate,
      });

      const reply = await this.transport.reply({
        cwd: this.employee.workspacePath,
        employeeHomePath: this.employee.homePath,
        sessionDir: this.status.sessionDir,
        env: {
          ...process.env,
          ...this.options.env,
          ...buildConversationContextEnv({
            ...input,
            companyId: this.employee.companyId,
          }),
        },
        systemPromptAppend,
        promptBlocks,
        userPrompt,
        imageInputs: input.imageInputs,
        activeToolNames: input.activeToolNames,
        onTextDelta: input.onTextDelta,
        onSessionEvent: input.onSessionEvent,
      });

      this.status = {
        ...this.status,
        sessionKey: input.sessionKey,
        bootstrapped: true,
        lastPromptAt: nowIso(),
        lastReplyAt: nowIso(),
      };

      return {
        message: reply.message,
        promptInputPackage: buildPromptInputPackage({
          employee: this.employee,
          sessionKey: input.sessionKey,
          createdAt: nowIso(),
          message: input.message,
          userPrompt,
          systemPromptAppend,
          requesterUsername: input.requesterUsername,
          threadId: input.threadId,
          roomId: input.roomId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          chatEntryId: input.chatEntryId,
          channelTopicId: input.channelTopicId,
          reachableParticipants: input.reachableParticipants,
          contextBlocks: input.contextBlocks,
          promptBlocks,
          employeeInstructionFiles: reply.employeeInstructionFiles,
          activeToolNames: input.activeToolNames,
          loadedSkillNames: reply.loadedSkillNames,
        }),
      };
    });

    this.operationChain = replyPromise.then(
      () => undefined,
      () => undefined,
    );

    return replyPromise;
  }

}
