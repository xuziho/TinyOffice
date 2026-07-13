import { existsSync } from "node:fs";
import path from "node:path";

import {
  defaultToolGuardPolicy,
  normalizeToolGuardPolicy,
  type CwdBoundaryMode,
  type ToolGuardPolicy,
} from "../../../src/runtime/company-config/access-policy.js";

interface ExtensionAPI {
  on(event: "tool_call", handler: (event: ToolCallEvent, ctx: GuardContext) => unknown | Promise<unknown>): void;
}

interface ToolCallEvent {
  toolName: string;
  input: unknown;
}

interface GuardContext {
  cwd: string;
}

const policyEnvName = "PI_TOOL_GUARD_POLICY_JSON";
const accessApiBaseUrlEnvName = "TINYOFFICE_API_BASE_URL";
const accessCompanyIdEnvName = "TINYOFFICE_COMPANY_ID";
const accessMemberIdEnvName = "PI_EMPLOYEE_ID";
const conversationContextEnvName = "PI_CONVERSATION_CONTEXT_JSON";
const readTools = new Set(["read", "grep", "find", "ls"]);
const writeTools = new Set(["write", "edit"]);
const runtimeConfigFileNames = new Set([
  "env.ts",
  "env.tsx",
  "env.js",
  "env.jsx",
  "env.mts",
  "env.cts",
  "env.mjs",
  "env.cjs",
  "runtime-config.ts",
  "runtime-config.js",
  "app-config.ts",
  "app-config.js",
  "application.json",
  "application.properties",
  "application.yaml",
  "application.yml",
  "appsettings.json",
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
  "firebase.json",
  "fly.toml",
  "netlify.toml",
  "render.yaml",
  "render.yml",
  "serverless.json",
  "serverless.yaml",
  "serverless.yml",
  "terraform.tfvars",
  "terraform.tfvars.json",
  "values.yaml",
  "values.yml",
  "vercel.json",
  "wrangler.toml",
]);
const runtimeConfigDirectoryNames = new Set([
  ".config",
  "conf",
  "conf.d",
  "config",
  "configs",
  "configuration",
  "deploy",
  "deployment",
  "deployments",
  "env",
  "environments",
  "helm",
  "infra",
  "infrastructure",
  "k8s",
  "kubernetes",
  "manifests",
  "settings",
]);
const runtimeConfigFileExtensions = new Set([
  ".cjs",
  ".conf",
  ".config",
  ".cts",
  ".hcl",
  ".ini",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".mjs",
  ".mts",
  ".properties",
  ".tfvars",
  ".toml",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml",
]);
const runtimeConfigContentPatterns = [
  { label: "BASE_URL", pattern: /\bBASE_URL\b/ },
  { label: "API_URL", pattern: /\bAPI_URL\b/ },
  { label: "PUBLIC_*", pattern: /\bPUBLIC_[A-Z0-9_]+\b/ },
  { label: "*_KEY", pattern: /\b[A-Z0-9_]+_(?:API_)?KEY\b/ },
  { label: "*_TOKEN", pattern: /\b[A-Z0-9_]+_TOKEN\b/ },
  { label: "CLIENT_ID", pattern: /\bCLIENT_ID\b/ },
  { label: "CLIENT_SECRET", pattern: /\bCLIENT_SECRET\b/ },
  { label: "process.env", pattern: /\bprocess\.env\b/ },
];
const runtimeConfigFileNamePattern = /(?:^|[-_.])(?:appsettings|application|config|env|environment|settings)(?:[-_.]|$)/;
const runtimeConfigContentFileNamePattern = /(?:^|[-_.])(?:config|env|environment|settings|constants)(?:[-_.]|$)/;

export default function piToolGuard(api: ExtensionAPI) {
  api.on("tool_call", async (event, ctx) => {
    const repoRoot = findRepoRoot(ctx.cwd);
    const policy = loadPolicy(ctx.cwd);

    if (readTools.has(event.toolName)) {
      const targetPath = extractPath(event.input);
      if (targetPath && matchesAnyPathPattern(resolveTarget(ctx.cwd, targetPath), ctx.cwd, policy.sensitivePathPatterns, repoRoot)) {
        return accessDecisionForAsk(event, "read", targetPath, `Access requires participant decision for sensitive path read: ${targetPath}`);
      }
      if (targetPath && matchesAnyPathPattern(resolveTarget(ctx.cwd, targetPath), ctx.cwd, policy.blockedReadPathPatterns, repoRoot)) {
        return {
          block: true,
          reason: `Access blocked read: ${targetPath}`,
        };
      }
      if (targetPath && matchesAnyPathPattern(resolveTarget(ctx.cwd, targetPath), ctx.cwd, policy.askReadPathPatterns, repoRoot)) {
        return accessDecisionForAsk(event, "read", targetPath, `Access requires approval for read: ${targetPath}`);
      }
      if (targetPath) {
        const absoluteTarget = resolveTarget(ctx.cwd, targetPath);
        if (!isInside(path.resolve(ctx.cwd), absoluteTarget)) {
          const decision = await cwdBoundaryDecision(policy.cwdBoundaryReadMode, "read", targetPath, event);
          if (decision) return decision;
        }
      }
      return undefined;
    }

    if (writeTools.has(event.toolName)) {
      const targetPath = extractPath(event.input);
      if (!targetPath) return undefined;
      const absoluteTarget = resolveTarget(ctx.cwd, targetPath);
      if (matchesAnyPathPattern(absoluteTarget, ctx.cwd, policy.protectedWritePathPatterns, repoRoot)) {
        return accessDecisionForAsk(event, "write", targetPath, `Access requires participant decision for protected path write: ${targetPath}`);
      }
      const runtimeConfigReason = getRuntimeConfigReason(ctx.cwd, event.toolName, absoluteTarget, event.input);
      if (runtimeConfigReason) {
        return accessDecisionForAsk(event, "write", targetPath, `Access requires participant decision for runtime config write (${runtimeConfigReason}): ${targetPath}`);
      }
      if (matchesAnyPathPattern(absoluteTarget, ctx.cwd, policy.askWritePathPatterns, repoRoot)) {
        return accessDecisionForAsk(event, "write", targetPath, `Access requires approval for write: ${targetPath}`);
      }
      if (!isInside(path.resolve(ctx.cwd), absoluteTarget) && !isAllowedExternalWrite(absoluteTarget, ctx.cwd, policy)) {
        const decision = await cwdBoundaryDecision(policy.cwdBoundaryWriteMode, "write", targetPath, event);
        if (decision) return decision;
      }
      return undefined;
    }

    if (event.toolName === "bash") {
      const command = extractCommand(event.input);
      if (!command) return undefined;
      const sensitiveReadTarget = sensitiveBashReadTarget(command, ctx.cwd, policy, repoRoot);
      if (sensitiveReadTarget) {
        return accessDecisionForAsk(
          event,
          "read",
          sensitiveReadTarget,
          `Access requires participant decision for sensitive path read via bash command: ${sensitiveReadTarget}`,
        );
      }
      if (matchesAnyCommandPattern(command, policy.bashDenyPatterns)) {
        return {
          block: true,
          reason: `Access blocked bash command: ${command}`,
        };
      }
      if (matchesAnyCommandPattern(command, policy.bashAskPatterns)) {
        return accessDecisionForAsk(event, "bash", command, `Access requires approval for bash command: ${command}`);
      }
      if (
        policy.denyBashByDefault &&
        !matchesAnyCommandPattern(command, policy.bashAllowPatterns)
      ) {
        return {
          block: true,
          reason: `Access blocked bash command by default-deny policy: ${command}`,
        };
      }
    }

    return undefined;
  });
}

type GuardDecision = { block: true; reason: string };

async function accessDecisionForAsk(
  event: ToolCallEvent,
  action: "read" | "write" | "bash",
  resource: string,
  reason: string,
): Promise<GuardDecision | undefined> {
  const context = runtimeAccessContext();
  if (!context) {
    return { block: true, reason };
  }

  try {
    const response = await fetch(new URL(
      `/api/companies/${encodeURIComponent(context.companyId)}/access/tool-call`,
      context.apiBaseUrl,
    ), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: context.companyId,
        memberId: context.memberId,
        action,
        resource,
        reason,
        contextKind: context.contextKind,
        contextId: context.contextId,
        sessionKey: context.sessionKey,
        requestedInputSnapshot: {
          toolName: event.toolName,
          input: event.input,
        },
      }),
    });
    if (!response.ok) {
      return { block: true, reason };
    }

    const body = await response.json() as { decision?: unknown; reason?: unknown };
    if (body.decision === "allow") {
      return undefined;
    }
    return {
      block: true,
      reason: typeof body.reason === "string" && body.reason.trim() ? body.reason : reason,
    };
  } catch {
    return { block: true, reason };
  }
}

function runtimeAccessContext(): {
  apiBaseUrl: string;
  companyId: string;
  memberId: string;
  contextKind: "dm_thread" | "channel_topic" | "work_run" | "intake_event";
  contextId: string;
  sessionKey: string;
} | undefined {
  const apiBaseUrl = process.env[accessApiBaseUrlEnvName]?.trim();
  const memberId = process.env[accessMemberIdEnvName]?.trim();
  const rawConversationContext = process.env[conversationContextEnvName];
  if (!apiBaseUrl || !memberId || !rawConversationContext) return undefined;

  let context: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawConversationContext) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    context = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const companyId = process.env[accessCompanyIdEnvName]?.trim() || stringValue(context.companyId);
  const sessionKey = stringValue(context.sessionKey);
  const accessContext = accessContextKindAndId(context);
  if (!companyId || !sessionKey || !accessContext) return undefined;

  return {
    apiBaseUrl,
    companyId,
    memberId,
    sessionKey,
    ...accessContext,
  };
}

function accessContextKindAndId(context: Record<string, unknown>): {
  contextKind: "dm_thread" | "channel_topic" | "work_run" | "intake_event";
  contextId: string;
} | undefined {
  const workRunId = stringValue(context.workRunId);
  if (workRunId) return { contextKind: "work_run", contextId: workRunId };

  const intakeEventId = stringValue(context.intakeEventId);
  if (intakeEventId) return { contextKind: "intake_event", contextId: intakeEventId };

  const channelTopicId = stringValue(context.channelTopicId);
  if (channelTopicId) return { contextKind: "channel_topic", contextId: channelTopicId };

  const dmThreadId = stringValue(context.threadId) ||
    stringValue(context.conversationId) ||
    stringValue(context.roomId) ||
    stringValue(context.chatEntryId);
  return dmThreadId ? { contextKind: "dm_thread", contextId: dmThreadId } : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function loadPolicy(cwd: string): ToolGuardPolicy {
  void cwd;
  const rawPolicy = process.env[policyEnvName];
  if (!rawPolicy) return defaultToolGuardPolicy;
  try {
    const parsed = JSON.parse(rawPolicy) as unknown;
    return normalizeToolGuardPolicy(parsed);
  } catch {
    return defaultToolGuardPolicy;
  }
}

function findRepoRoot(cwd: string): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    if (
      existsSync(path.join(current, "company")) &&
      existsSync(path.join(current, "companies"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function extractPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const candidates = [record.path, record.filePath, record.cwd, record.directory];
  const value = candidates.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value : undefined;
}

function extractCommand(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" && command.trim() ? command : undefined;
}

function resolveTarget(cwd: string, targetPath: string): string {
  return path.resolve(cwd, targetPath);
}

function isAllowedExternalWrite(targetPath: string, cwd: string, policy: ToolGuardPolicy): boolean {
  return policy.externalWriteAllowPaths.some((allowPath) => {
    const absoluteAllowPath = resolveTarget(cwd, allowPath);
    return isInside(absoluteAllowPath, targetPath);
  });
}

async function cwdBoundaryDecision(
  mode: CwdBoundaryMode,
  kind: "read" | "write",
  targetPath: string,
  event: ToolCallEvent,
): Promise<GuardDecision | undefined> {
  if (mode === "allow") return undefined;
  if (mode === "ask") {
    return accessDecisionForAsk(event, kind, targetPath, `Access requires approval for cwd-external ${kind}: ${targetPath}`);
  }
  return {
    block: true,
    reason: `Access blocked cwd-external ${kind}: ${targetPath}`,
  };
}


function matchesAnyPathPattern(absolutePath: string, cwd: string, patterns: string[], repoRoot?: string): boolean {
  const normalizedAbsolute = toPosix(absolutePath);
  const normalizedRelative = toPosix(path.relative(cwd, absolutePath));
  const normalizedRepoRelative = repoRoot ? toPosix(path.relative(repoRoot, absolutePath)) : "";
  const basename = path.basename(absolutePath);
  return patterns.some((pattern) => {
    const normalizedPattern = toPosix(pattern.trim());
    if (!normalizedPattern) return false;
    if (normalizedPattern.includes("/")) {
      return globMatches(normalizedPattern, normalizedAbsolute) ||
        globMatches(normalizedPattern, normalizedRelative) ||
        Boolean(normalizedRepoRelative && globMatches(normalizedPattern, normalizedRepoRelative));
    }
    return globMatches(normalizedPattern, basename) ||
      globMatches(normalizedPattern, normalizedRelative) ||
      Boolean(normalizedRepoRelative && globMatches(normalizedPattern, normalizedRepoRelative));
  });
}

function matchesAnyCommandPattern(command: string, patterns: string[]): boolean {
  const normalizedCommand = command.trim().replace(/\s+/g, " ");
  return patterns.some((pattern) => globMatches(pattern.trim(), normalizedCommand));
}

function sensitiveBashReadTarget(
  command: string,
  cwd: string,
  policy: ToolGuardPolicy,
  repoRoot?: string,
): string | undefined {
  const candidates = bashPathCandidates(command);
  return candidates.find((candidate) =>
    matchesAnyPathPattern(resolveTarget(cwd, candidate), cwd, policy.sensitivePathPatterns, repoRoot)
  );
}

function bashPathCandidates(command: string): string[] {
  const values = new Set<string>();
  const pathLike = /(?:^|[^A-Za-z0-9_./\\-])((?:\.{1,2}[\/\\])?[A-Za-z0-9_.@()[\]{}+~:=,\/\\-]+)(?=$|[^A-Za-z0-9_./\\-])/g;
  for (const match of command.matchAll(pathLike)) {
    const candidate = stripShellPathPunctuation(match[1] || "");
    if (candidate && looksPathLike(candidate)) {
      values.add(candidate);
    }
  }
  return [...values];
}

function stripShellPathPunctuation(value: string): string {
  return value.replace(/^[("'`]+/, "").replace(/[)"'`,;|&]+$/, "");
}

function looksPathLike(value: string): boolean {
  return value.includes("/") ||
    value.includes("\\") ||
    value.startsWith(".") ||
    value.includes(".");
}

function pathParts(targetPath: string): string[] {
  return toPosix(targetPath).split("/").filter(Boolean).map((part) => part.toLowerCase());
}

function scopedPath(cwd: string, absolutePath: string): string {
  const relative = path.relative(path.resolve(cwd), path.resolve(absolutePath));
  return relative.startsWith("..") || path.isAbsolute(relative) ? absolutePath : relative;
}

function isRuntimeConfigPath(cwd: string, absolutePath: string): boolean {
  const checkedPath = scopedPath(cwd, absolutePath);
  const parts = pathParts(checkedPath);
  const fileName = path.basename(checkedPath).toLowerCase();

  if (runtimeConfigFileNames.has(fileName)) return true;
  if (parts.includes("config") && /(?:^|[-_.])env\.(?:[cm]?[jt]sx?)$/.test(fileName)) return true;
  if (/(?:^|[-_.])runtime[-_.]?config\.(?:[cm]?[jt]sx?)$/.test(fileName)) return true;
  if (!runtimeConfigFileExtensions.has(path.extname(fileName))) return false;
  if (runtimeConfigFileNamePattern.test(fileName)) return true;
  return parts.some((part) => runtimeConfigDirectoryNames.has(part));
}

function isRuntimeConfigContentCandidate(cwd: string, absolutePath: string): boolean {
  const checkedPath = scopedPath(cwd, absolutePath);
  const parts = pathParts(checkedPath);
  const fileName = path.basename(checkedPath).toLowerCase();
  return parts.some((part) => runtimeConfigDirectoryNames.has(part)) || runtimeConfigContentFileNamePattern.test(fileName);
}

function getMutationText(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";

  if (toolName === "write") {
    const content = (input as Record<string, unknown>).content;
    return typeof content === "string" ? content : "";
  }

  if (toolName === "edit") {
    const edits = (input as Record<string, unknown>).edits;
    if (!Array.isArray(edits)) return "";
    return edits
      .map((edit) => {
        if (!edit || typeof edit !== "object" || Array.isArray(edit)) return "";
        const record = edit as Record<string, unknown>;
        return [record.oldText, record.newText].filter((text): text is string => typeof text === "string").join("\n");
      })
      .join("\n");
  }

  return "";
}

function getRuntimeConfigReason(cwd: string, toolName: string, absolutePath: string, input: unknown): string | undefined {
  if (isRuntimeConfigPath(cwd, absolutePath)) return "runtime config path";
  if (!isRuntimeConfigContentCandidate(cwd, absolutePath)) return undefined;

  const mutationText = getMutationText(toolName, input);
  if (!mutationText) return undefined;

  const matchedPattern = runtimeConfigContentPatterns.find(({ pattern }) => pattern.test(mutationText));
  return matchedPattern ? `runtime config-like content ${matchedPattern.label}` : undefined;
}

function globMatches(pattern: string, value: string): boolean {
  const regex = new RegExp(`^${globToRegexSource(pattern)}$`, "i");
  return regex.test(value);
}

function globToRegexSource(pattern: string): string {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return source;
}

function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
