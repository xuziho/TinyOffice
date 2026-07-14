import type { Context } from "hono";

import { ensureConversationCompanyScope } from "../../collaboration/contracts/conversation-message-contract.js";
import type { CreateCompanyInput, DeleteCompanyInput, SaveCompanySystemAiSettingsInput, SwitchCurrentCompanyInput, UpdateCompanyProfileInput } from "./contracts.js";
import { requireObjectBody, requireParam, requireString } from "./parsing.js";

export function companyIdFromContext(c: Context): string {
  return ensureConversationCompanyScope({ companyId: requireParam(c, "companyId") });
}

export function validateBodyCompanyId(input: Record<string, unknown>, companyId: string): void {
  ensureConversationCompanyScope({
    companyId,
    resourceCompanyId: requireString(input, "companyId"),
  });
}

export function parseCreateCompanyBody(value: unknown): CreateCompanyInput {
  const body = requireObjectBody(value, "Company create body");
  return {
    companyId: body.companyId,
    displayName: body.displayName,
    hrEmployeeDisplayName: body.hrEmployeeDisplayName,
    hrRuntime: body.hrRuntime,
    systemAiRuntime: body.systemAiRuntime,
  };
}

export function parseDeleteCompanyBody(value: unknown, companyId: string): DeleteCompanyInput {
  const body = requireObjectBody(value, "Company delete body");
  validateBodyCompanyId(body, companyId);
  const confirmation = body.confirmation && typeof body.confirmation === "object" && !Array.isArray(body.confirmation)
    ? body.confirmation as Record<string, unknown>
    : undefined;
  return {
    companyId,
    confirmation: {
      intent: confirmation?.intent,
    },
  };
}

export function parseUpdateCompanyProfileBody(value: unknown, companyId: string): UpdateCompanyProfileInput {
  const body = requireObjectBody(value, "Company profile body");
  return {
    companyId,
    displayName: body.displayName,
  };
}

export function parseSaveCompanySystemAiSettingsBody(value: unknown, companyId: string): SaveCompanySystemAiSettingsInput {
  const body = requireObjectBody(value, "Company System AI settings body");
  const chatTitleGeneration = body.chatTitleGeneration && typeof body.chatTitleGeneration === "object" && !Array.isArray(body.chatTitleGeneration)
    ? body.chatTitleGeneration as Record<string, unknown>
    : undefined;
  const chatTopicSummary = body.chatTopicSummary && typeof body.chatTopicSummary === "object" && !Array.isArray(body.chatTopicSummary)
    ? body.chatTopicSummary as Record<string, unknown>
    : undefined;
  return {
    companyId,
    settings: {
      chatTitleGeneration: {
        modelProvider: chatTitleGeneration?.modelProvider,
        modelId: chatTitleGeneration?.modelId,
      },
      chatTopicSummary: {
        modelProvider: chatTopicSummary?.modelProvider,
        modelId: chatTopicSummary?.modelId,
      },
    },
  };
}

export function parseSwitchCurrentCompanyBody(value: unknown): SwitchCurrentCompanyInput {
  const body = requireObjectBody(value, "Current Company switch body");
  return {
    companyId: requireString(body, "companyId"),
  };
}
