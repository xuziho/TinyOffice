import type { Hono } from "hono";

import type { TinyOfficeApiOptions } from "./context.js";
import * as api from "./context.js";

function requireEmployeePrivateSkillId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
    const error = new Error(`Invalid employee private skill id: ${value}`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

export function registerMemberRuntimeRoutes(app: Hono, options: TinyOfficeApiOptions): void {
  const { companyIdFromContext, currentUserFromRequest, jsonResponse, parseEmployeePrivateSkillSaveBody, parseMemberRuntimeSaveBody, readJsonBody, requireParam, resolveMemberRuntimeService } = api;

  app.get("/api/companies/:companyId/member-runtime", async (c) => {
    const companyId = companyIdFromContext(c);
    const memberRuntimeService = await resolveMemberRuntimeService(options, companyId);
    return jsonResponse(c, await memberRuntimeService.loadMemberRuntime(companyId));
  });

  app.post("/api/companies/:companyId/member-runtime/members/:memberId", async (c) => {
    const companyId = companyIdFromContext(c);
    const memberId = requireParam(c, "memberId");
    const memberRuntimeService = await resolveMemberRuntimeService(options, companyId);
    return jsonResponse(
      c,
      await memberRuntimeService.saveMemberRuntimeMember(
        companyId,
        parseMemberRuntimeSaveBody(await readJsonBody(c), companyId, memberId),
      ),
    );
  });

  app.post("/api/companies/:companyId/member-runtime/members/:memberId/lifecycle", async (c) => {
    const companyId = companyIdFromContext(c);
    const memberId = requireParam(c, "memberId");
    const body = await readJsonBody(c) as { enabled?: unknown };
    if (typeof body?.enabled !== "boolean") {
      throw new Error("enabled boolean is required");
    }
    const memberRuntimeService = await resolveMemberRuntimeService(options, companyId);
    if (!memberRuntimeService.setMemberRuntimeEnabled) {
      throw new Error("member runtime lifecycle is not configured");
    }
    const actor = currentUserFromRequest(c.req.raw);
    return jsonResponse(c, await memberRuntimeService.setMemberRuntimeEnabled(companyId, memberId, body.enabled, actor.userId));
  });

  app.get("/api/companies/:companyId/member-runtime/members/:memberId/skills", async (c) => {
    const companyId = companyIdFromContext(c);
    const memberId = requireParam(c, "memberId");
    const memberRuntimeService = await resolveMemberRuntimeService(options, companyId);
    if (!memberRuntimeService.listEmployeePrivateSkills) {
      throw new Error("employee private skill list is not configured");
    }
    return jsonResponse(c, await memberRuntimeService.listEmployeePrivateSkills(companyId, memberId));
  });

  app.get("/api/companies/:companyId/member-runtime/members/:memberId/skills/:skillId", async (c) => {
    const companyId = companyIdFromContext(c);
    const memberId = requireParam(c, "memberId");
    const skillId = requireEmployeePrivateSkillId(requireParam(c, "skillId"));
    const memberRuntimeService = await resolveMemberRuntimeService(options, companyId);
    if (!memberRuntimeService.readEmployeePrivateSkill) {
      throw new Error("employee private skill read is not configured");
    }
    return jsonResponse(c, await memberRuntimeService.readEmployeePrivateSkill(companyId, memberId, skillId));
  });

  app.post("/api/companies/:companyId/member-runtime/members/:memberId/skills/:skillId", async (c) => {
    const companyId = companyIdFromContext(c);
    const memberId = requireParam(c, "memberId");
    const skillId = requireEmployeePrivateSkillId(requireParam(c, "skillId"));
    const memberRuntimeService = await resolveMemberRuntimeService(options, companyId);
    if (!memberRuntimeService.saveEmployeePrivateSkill) {
      throw new Error("employee private skill save is not configured");
    }
    return jsonResponse(
      c,
      await memberRuntimeService.saveEmployeePrivateSkill(
        companyId,
        parseEmployeePrivateSkillSaveBody(await readJsonBody(c), companyId, memberId, skillId),
      ),
    );
  });

  app.post("/api/companies/:companyId/member-runtime/members/:memberId/reload", async (c) => {
    const companyId = companyIdFromContext(c);
    const memberId = requireParam(c, "memberId");
    const memberRuntimeService = await resolveMemberRuntimeService(options, companyId);
    if (!memberRuntimeService.reloadMemberRuntime) {
      throw new Error("member runtime reload is not configured");
    }
    return jsonResponse(c, await memberRuntimeService.reloadMemberRuntime(companyId, memberId));
  });

  app.get("/api/companies/:companyId/skills", async (c) => {
    const companyId = companyIdFromContext(c);
    const service = await resolveMemberRuntimeService(options, companyId);
    if (!service.listCompanySkills) throw new Error("company skill list is not configured");
    return jsonResponse(c, await service.listCompanySkills(companyId));
  });

  app.get("/api/companies/:companyId/skills/:skillId", async (c) => {
    const companyId = companyIdFromContext(c);
    const skillId = requireEmployeePrivateSkillId(requireParam(c, "skillId"));
    const service = await resolveMemberRuntimeService(options, companyId);
    if (!service.readCompanySkill) throw new Error("company skill read is not configured");
    return jsonResponse(c, await service.readCompanySkill(companyId, skillId));
  });

  app.post("/api/companies/:companyId/skills/:skillId", async (c) => {
    const companyId = companyIdFromContext(c);
    const skillId = requireEmployeePrivateSkillId(requireParam(c, "skillId"));
    const body = await readJsonBody(c) as { content?: unknown };
    if (typeof body.content !== "string") throw new Error("company Skill content is required");
    const service = await resolveMemberRuntimeService(options, companyId);
    if (!service.saveCompanySkill) throw new Error("company skill save is not configured");
    return jsonResponse(c, await service.saveCompanySkill(companyId, { skillId, content: body.content }));
  });

  app.post("/api/companies/:companyId/member-runtime/reload", async (c) => {
    const companyId = companyIdFromContext(c);
    const memberRuntimeService = await resolveMemberRuntimeService(options, companyId);
    if (!memberRuntimeService.reloadAllMemberRuntimes) {
      throw new Error("member runtime reload is not configured");
    }
    return jsonResponse(c, await memberRuntimeService.reloadAllMemberRuntimes(companyId));
  });
}
