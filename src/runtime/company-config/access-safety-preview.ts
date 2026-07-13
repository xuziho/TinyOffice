import path from "node:path";

import {
  normalizeToolGuardPolicy,
  type CwdBoundaryMode,
  type ToolGuardPolicy,
  type ToolSafetyDecision,
  type ToolSafetyDecisionPreview,
  type ToolSafetyOperation,
  type ToolSafetyPreviewInput,
} from "./access-policy.js";
export function previewToolSafetyDecision(input: ToolSafetyPreviewInput & {
  policy: unknown;
}): ToolSafetyDecisionPreview {
  const policy = normalizeToolGuardPolicy(input.policy);
  const operation = normalizeToolSafetyOperation(input.operation);
  const target = operation === "bash"
    ? normalizeOptionalString(input.command, "command")
    : normalizeOptionalString(input.targetPath, "targetPath");
  const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined;

  if (operation === "read") {
    return previewReadDecision(policy, target, cwd);
  }
  if (operation === "write") {
    return previewWriteDecision(policy, target, cwd);
  }
  return previewBashDecision(policy, target);
}

function previewReadDecision(policy: ToolGuardPolicy, target: string, cwd?: string): ToolSafetyDecisionPreview {
  const boundary = previewCwdBoundary(policy.cwdBoundaryReadMode, "read", target, cwd);
  if (boundary) return boundary;
  if (matchesAnyPathPattern(target, policy.blockedReadPathPatterns)) {
    return decisionPreview("read", target, "deny", "blockedReadPathPatterns", `Access blocks read: ${target}`);
  }
  if (matchesAnyPathPattern(target, policy.sensitivePathPatterns)) {
    return decisionPreview("read", target, "ask", "sensitivePathPatterns", `Access requires confirmation for sensitive path read: ${target}`);
  }
  if (matchesAnyPathPattern(target, policy.askReadPathPatterns)) {
    return decisionPreview("read", target, "ask", "askReadPathPatterns", `Access requires confirmation for read: ${target}`);
  }
  return decisionPreview("read", target, "allow", "default", `Access allows read: ${target}`);
}

function previewWriteDecision(policy: ToolGuardPolicy, target: string, cwd?: string): ToolSafetyDecisionPreview {
  const boundary = previewCwdBoundary(policy.cwdBoundaryWriteMode, "write", target, cwd);
  if (boundary) return boundary;
  if (matchesAnyPathPattern(target, policy.protectedWritePathPatterns)) {
    return decisionPreview("write", target, "ask", "protectedWritePathPatterns", `Access requires confirmation for protected write: ${target}`);
  }
  if (matchesRuntimeConfigPath(target)) {
    return decisionPreview("write", target, "ask", "runtimeConfig", `Access requires confirmation for runtime config write: ${target}`);
  }
  if (matchesAnyPathPattern(target, policy.askWritePathPatterns)) {
    return decisionPreview("write", target, "ask", "askWritePathPatterns", `Access requires confirmation for write: ${target}`);
  }
  return decisionPreview("write", target, "allow", "default", `Access allows write: ${target}`);
}

function previewBashDecision(policy: ToolGuardPolicy, command: string): ToolSafetyDecisionPreview {
  const sensitiveTarget = sensitiveBashReadTarget(command, policy);
  if (sensitiveTarget) {
    return decisionPreview(
      "bash",
      command,
      "ask",
      "sensitivePathPatterns",
      `Access requires confirmation for sensitive path read via bash command: ${sensitiveTarget}`,
    );
  }
  if (matchesAnyCommandPattern(command, policy.bashDenyPatterns)) {
    return decisionPreview("bash", command, "deny", "bashDenyPatterns", `Access blocks bash command: ${command}`);
  }
  if (matchesAnyCommandPattern(command, policy.bashAskPatterns)) {
    return decisionPreview("bash", command, "ask", "bashAskPatterns", `Access requires confirmation for bash command: ${command}`);
  }
  if (matchesAnyCommandPattern(command, policy.bashAllowPatterns)) {
    return decisionPreview("bash", command, "allow", "bashAllowPatterns", `Access allows bash command: ${command}`);
  }
  if (policy.denyBashByDefault) {
    return decisionPreview("bash", command, "deny", "denyBashByDefault", `Access blocks bash command by default: ${command}`);
  }
  return decisionPreview("bash", command, "allow", "default", `Access allows bash command: ${command}`);
}

function previewCwdBoundary(
  mode: CwdBoundaryMode,
  operation: "read" | "write",
  target: string,
  cwd?: string,
): ToolSafetyDecisionPreview | undefined {
  if (!cwd || mode === "allow") return undefined;
  const resolved = path.resolve(cwd, target);
  const relative = path.relative(cwd, resolved);
  const outside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!outside) return undefined;
  if (mode === "deny") {
    return decisionPreview(operation, target, "deny", operation === "read" ? "cwdBoundaryReadMode" : "cwdBoundaryWriteMode", `Access blocks cwd-external ${operation}: ${target}`);
  }
  return decisionPreview(operation, target, "ask", operation === "read" ? "cwdBoundaryReadMode" : "cwdBoundaryWriteMode", `Access requires confirmation for cwd-external ${operation}: ${target}`);
}

function decisionPreview(
  operation: ToolSafetyOperation,
  target: string,
  decision: ToolSafetyDecision,
  matchedPolicy: string,
  reason: string,
): ToolSafetyDecisionPreview {
  return { operation, target, decision, matchedPolicy, reason };
}

function normalizeToolSafetyOperation(value: unknown): ToolSafetyOperation {
  if (value === "read" || value === "write" || value === "bash") return value;
  throw new Error("tool safety preview operation must be read, write, or bash.");
}

function normalizeOptionalString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`tool safety preview ${label} is required.`);
  }
  return value.trim();
}

function matchesAnyPathPattern(target: string, patterns: string[]): boolean {
  const normalizedTarget = normalizePathForMatch(target);
  const basename = path.basename(normalizedTarget);
  return patterns.some((pattern) => {
    const normalizedPattern = normalizePathForMatch(pattern);
    return globToRegExp(normalizedPattern).test(normalizedTarget) ||
      (!normalizedPattern.includes("/") && globToRegExp(normalizedPattern).test(basename));
  });
}

function matchesAnyCommandPattern(command: string, patterns: string[]): boolean {
  const normalizedCommand = command.trim().replace(/\s+/g, " ");
  return patterns.some((pattern) => globToRegExp(pattern.trim().replace(/\s+/g, " ")).test(normalizedCommand));
}

function sensitiveBashReadTarget(command: string, policy: ToolGuardPolicy): string | undefined {
  return bashPathCandidates(command).find((candidate) => matchesAnyPathPattern(candidate, policy.sensitivePathPatterns));
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

function matchesRuntimeConfigPath(target: string): boolean {
  return matchesAnyPathPattern(target, [
    ".codex/**",
    ".runtime/**",
    "scripts/runtime/**",
    "src/runtime/company-config/**",
  ]);
}

export function normalizePathForMatch(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
