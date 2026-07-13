import type { ParticipantRef } from "../contracts/participant-ref.js";
import { normalizeCompanyId } from "../../runtime/company-config/company-paths.js";

export interface AmbientConversationContext {
  companyId?: string;
  channelTopicId?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
  workRunId?: string;
  sessionKey?: string;
  actorMemberId?: string;
  reachableMemberIds: string[];
  reachableParticipants?: ParticipantRef[];
  preferredLanguage?: string;
}

export interface CollaborationPiToolExecutionContext {
  companyId: string;
  channelTopicId?: string;
  threadId?: string;
  roomId?: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
  workRunId?: string;
  sessionKey?: string;
  runtimeEmployeeId: string;
  actorMemberId?: string;
  reachableMemberIds: string[];
  reachableParticipants?: ParticipantRef[];
  preferredLanguage?: string;
}

export interface CollaborationPiToolGatewayOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: () => string;
}

export class CollaborationPiToolGateway {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: () => string;

  constructor(options: CollaborationPiToolGatewayOptions = {}) {
    this.env = options.env || process.env;
    this.cwd = options.cwd || process.cwd;
  }

  buildContext(): CollaborationPiToolExecutionContext {
    const ambient = this.loadAmbientConversationContext();
    return {
      companyId: this.companyId(ambient),
      ...(ambient.channelTopicId ? { channelTopicId: ambient.channelTopicId } : {}),
      ...(ambient.threadId ? { threadId: ambient.threadId } : {}),
      ...(ambient.roomId ? { roomId: ambient.roomId } : {}),
      ...(ambient.conversationId ? { conversationId: ambient.conversationId } : {}),
      ...(ambient.messageId ? { messageId: ambient.messageId } : {}),
      ...(ambient.chatEntryId ? { chatEntryId: ambient.chatEntryId } : {}),
      ...(ambient.workRunId ? { workRunId: ambient.workRunId } : {}),
      ...(ambient.sessionKey ? { sessionKey: ambient.sessionKey } : {}),
      runtimeEmployeeId: this.currentRuntimeEmployeeId(),
      ...(ambient.actorMemberId ? { actorMemberId: ambient.actorMemberId } : {}),
      reachableMemberIds: ambient.reachableMemberIds,
      reachableParticipants: ambient.reachableParticipants,
      preferredLanguage: ambient.preferredLanguage,
    };
  }

  repoRoot(): string {
    return this.env.TASK_REPO_ROOT?.trim() || this.cwd();
  }

  companyId(ambient?: Pick<AmbientConversationContext, "companyId">): string {
    const companyId = this.optionalCompanyId(ambient);
    if (!companyId) {
      throw new Error("Company context is required: companyId is missing.");
    }
    return companyId;
  }

  optionalCompanyId(ambient?: Pick<AmbientConversationContext, "companyId">): string | undefined {
    const companyId = this.env.TINYOFFICE_COMPANY_ID?.trim();
    if (companyId) {
      return normalizeCompanyId(companyId);
    }
    if (ambient?.companyId) {
      return normalizeCompanyId(ambient.companyId);
    }
    const raw = this.env.PI_CONVERSATION_CONTEXT_JSON;
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as { companyId?: unknown };
      return typeof parsed.companyId === "string" && parsed.companyId.trim()
        ? normalizeCompanyId(parsed.companyId)
        : undefined;
    } catch {
      return undefined;
    }
  }

  optionalActorMemberId(): string | undefined {
    const raw = this.env.PI_CONVERSATION_CONTEXT_JSON;
    if (!raw) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as { actorMemberId?: unknown };
      return typeof parsed.actorMemberId === "string" && parsed.actorMemberId.trim()
        ? parsed.actorMemberId.trim()
        : undefined;
    } catch {
      return undefined;
    }
  }

  optionalAmbientConversationContext(): AmbientConversationContext | undefined {
    try {
      return this.loadAmbientConversationContext();
    } catch {
      return undefined;
    }
  }

  private loadAmbientConversationContext(): AmbientConversationContext {
    const raw = this.env.PI_CONVERSATION_CONTEXT_JSON;
    if (!raw) {
      throw new Error("Missing PI_CONVERSATION_CONTEXT_JSON for PI tool execution.");
    }

    const parsed = JSON.parse(raw) as Partial<AmbientConversationContext>;
    if (
      (parsed.threadId !== undefined && typeof parsed.threadId !== "string") ||
      (parsed.companyId !== undefined && typeof parsed.companyId !== "string") ||
      (parsed.roomId !== undefined && typeof parsed.roomId !== "string") ||
      (parsed.conversationId !== undefined && typeof parsed.conversationId !== "string") ||
      (parsed.messageId !== undefined && typeof parsed.messageId !== "string") ||
      (parsed.chatEntryId !== undefined && typeof parsed.chatEntryId !== "string") ||
      (parsed.workRunId !== undefined && typeof parsed.workRunId !== "string") ||
      (parsed.sessionKey !== undefined && typeof parsed.sessionKey !== "string") ||
      (parsed.actorMemberId !== undefined && typeof parsed.actorMemberId !== "string") ||
      (parsed.channelTopicId !== undefined && typeof parsed.channelTopicId !== "string") ||
      !Array.isArray(parsed.reachableMemberIds)
    ) {
      throw new Error("Invalid PI_CONVERSATION_CONTEXT_JSON for PI tool execution.");
    }

    return {
      ...(parsed.companyId ? { companyId: normalizeCompanyId(parsed.companyId) } : {}),
      ...(parsed.channelTopicId ? { channelTopicId: parsed.channelTopicId } : {}),
      ...(parsed.threadId ? { threadId: parsed.threadId } : {}),
      ...(parsed.roomId ? { roomId: parsed.roomId } : {}),
      ...(parsed.conversationId ? { conversationId: parsed.conversationId } : {}),
      ...(parsed.messageId ? { messageId: parsed.messageId } : {}),
      ...(parsed.chatEntryId ? { chatEntryId: parsed.chatEntryId } : {}),
      ...(parsed.workRunId ? { workRunId: parsed.workRunId } : {}),
      ...(parsed.sessionKey ? { sessionKey: parsed.sessionKey } : {}),
      ...(parsed.actorMemberId ? { actorMemberId: parsed.actorMemberId } : {}),
      reachableMemberIds: parsed.reachableMemberIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ),
      reachableParticipants: Array.isArray(parsed.reachableParticipants)
        ? parsed.reachableParticipants.filter(
            (value): value is ParticipantRef =>
              !!value &&
              typeof value === "object" &&
              typeof value.id === "string",
          )
        : undefined,
      preferredLanguage: typeof parsed.preferredLanguage === "string"
        ? parsed.preferredLanguage
        : undefined,
    };
  }

  currentRuntimeEmployeeId(): string {
    const employeeId = this.env.PI_EMPLOYEE_ID?.trim();
    if (!employeeId) {
      throw new Error("Missing PI_EMPLOYEE_ID for PI tool execution.");
    }
    return employeeId;
  }
}

export function createCollaborationPiToolGateway(
  options: CollaborationPiToolGatewayOptions = {},
): CollaborationPiToolGateway {
  return new CollaborationPiToolGateway(options);
}
