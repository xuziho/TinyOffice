import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

export function registerPromptPolicyRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { companyIdFromContext, jsonResponse, parsePromptPolicyBlockSaveBody, parsePromptPolicyConfigSaveBody, parsePromptPolicyTemplateSaveBody, readJsonBody, requireParam, resolvePromptPolicyService } = api;

  app.get("/api/companies/:companyId/prompt-policy", async (c) => {
    const companyId = companyIdFromContext(c);
    const promptPolicyService = await resolvePromptPolicyService(options, companyId);
    return jsonResponse(c, await promptPolicyService.loadPromptPolicy(companyId));
  });

  app.post("/api/companies/:companyId/prompt-policy/templates/:templateId", async (c) => {
    const companyId = companyIdFromContext(c);
    const templateId = requireParam(c, "templateId");
    const promptPolicyService = await resolvePromptPolicyService(options, companyId);
    return jsonResponse(
      c,
      await promptPolicyService.savePromptPolicyTemplateContent(
        companyId,
        parsePromptPolicyTemplateSaveBody(await readJsonBody(c), companyId, templateId),
      ),
    );
  });

  app.post("/api/companies/:companyId/prompt-policy/templates/:templateId/reset", async (c) => {
    const companyId = companyIdFromContext(c);
    const templateId = requireParam(c, "templateId");
    const promptPolicyService = await resolvePromptPolicyService(options, companyId);
    return jsonResponse(c, await promptPolicyService.resetPromptPolicyTemplateToDefault(companyId, templateId));
  });

  app.post("/api/companies/:companyId/prompt-policy/blocks/:blockPath", async (c) => {
    const companyId = companyIdFromContext(c);
    const blockPath = requireParam(c, "blockPath");
    const promptPolicyService = await resolvePromptPolicyService(options, companyId);
    return jsonResponse(
      c,
      await promptPolicyService.savePromptPolicyBlockContent(
        companyId,
        parsePromptPolicyBlockSaveBody(await readJsonBody(c), companyId, blockPath),
      ),
    );
  });

  app.post("/api/companies/:companyId/prompt-policy/blocks/:blockPath/reset", async (c) => {
    const companyId = companyIdFromContext(c);
    const blockPath = requireParam(c, "blockPath");
    const promptPolicyService = await resolvePromptPolicyService(options, companyId);
    return jsonResponse(c, await promptPolicyService.resetPromptPolicyBlockToDefault(companyId, blockPath));
  });

  app.post("/api/companies/:companyId/prompt-policy/config", async (c) => {
    const companyId = companyIdFromContext(c);
    const promptPolicyService = await resolvePromptPolicyService(options, companyId);
    if (!promptPolicyService.savePromptPolicyConfig) {
      throw new Error("prompt policy config save is not configured");
    }
    return jsonResponse(c, await promptPolicyService.savePromptPolicyConfig(
      companyId,
      parsePromptPolicyConfigSaveBody(await readJsonBody(c), companyId),
    ));
  });
}
