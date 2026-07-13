import {
  TOOL_GUARD_POLICY_SOURCE,
  type ToolGuardPolicy,
  type ToolSafetyCapabilityGroup,
  type ToolSafetyDecision,
  type ToolSafetyOperation,
  type ToolSafetyReadPolicyKey,
  type ToolSafetyResourcePattern,
  type ToolSafetyViewModel,
  type ToolSafetyWritePolicyKey,
} from "./access-policy.js";
import { normalizePathForMatch, previewToolSafetyDecision } from "./access-safety-preview.js";
export function buildToolSafetyViewModel(policy: ToolGuardPolicy): ToolSafetyViewModel {
  const accessPath = "/api/companies/:companyId/access";
  return {
    contract: {
      name: "access",
      version: 1,
      boundary: "runtime-access-policy",
    },
    routes: {
      htmlPath: "/config/access",
      viewModelJsonPath: accessPath,
      savePolicyPath: accessPath,
      previewPath: `${accessPath}/preview`,
    },
    policy,
    policyPath: TOOL_GUARD_POLICY_SOURCE,
    capabilityGroups: buildCapabilityGroups(policy),
    previewExamples: [
      buildPreviewExample("Sensitive read", policy, { operation: "read", targetPath: ".env" }),
      buildPreviewExample("Protected write", policy, { operation: "write", targetPath: ".env" }),
      buildPreviewExample("Destructive command", policy, { operation: "bash", command: "rm -rf build" }),
      buildPreviewExample("Ordinary search", policy, { operation: "bash", command: "rg TODO src" }),
    ],
    advancedEditor: {
      policyJson: JSON.stringify(policy, null, 2),
    },
  };
}

function buildCapabilityGroups(policy: ToolGuardPolicy): ToolSafetyCapabilityGroup[] {
  const environmentPatterns = uniquePatterns([
    ...filterPatterns(policy.sensitivePathPatterns, isEnvironmentPattern),
    ...filterPatterns(policy.blockedReadPathPatterns, isEnvironmentPattern),
    ...filterPatterns(policy.protectedWritePathPatterns, isEnvironmentPattern),
    ...filterPatterns(policy.askReadPathPatterns, isEnvironmentPattern),
    ...filterPatterns(policy.askWritePathPatterns, isEnvironmentPattern),
  ]);
  const runtimePatterns = uniquePatterns([
    ...filterPatterns(policy.blockedReadPathPatterns, isRuntimePolicyPattern),
    ...filterPatterns(policy.sensitivePathPatterns, isRuntimePolicyPattern),
    ...filterPatterns(policy.protectedWritePathPatterns, isRuntimePolicyPattern),
    ...filterPatterns(policy.askReadPathPatterns, isRuntimePolicyPattern),
    ...filterPatterns(policy.askWritePathPatterns, isRuntimePolicyPattern),
  ]);
  const generatedPatterns = uniquePatterns([
    ...filterPatterns(policy.blockedReadPathPatterns, isGeneratedDependencyPattern),
    ...filterPatterns(policy.sensitivePathPatterns, isGeneratedDependencyPattern),
    ...filterPatterns(policy.askReadPathPatterns, isGeneratedDependencyPattern),
    ...filterPatterns(policy.askWritePathPatterns, isGeneratedDependencyPattern),
    ...filterPatterns(policy.protectedWritePathPatterns, isGeneratedDependencyPattern),
  ]);
  const secretPatterns = uniquePatterns([
    ...policy.blockedReadPathPatterns,
    ...policy.sensitivePathPatterns,
    ...policy.protectedWritePathPatterns,
    ...policy.askReadPathPatterns,
    ...policy.askWritePathPatterns,
  ].filter((pattern) => !isEnvironmentPattern(pattern) && !isRuntimePolicyPattern(pattern) && !isGeneratedDependencyPattern(pattern)));

  return [
    {
      id: "environment-config",
      label: "Environment config",
      kind: "resource",
      summary: "Config files that often contain local secrets or runtime switches.",
      examples: [".env", ".env.*", ".npmrc"],
      patterns: environmentPatterns,
      resourcePatterns: buildResourcePatterns(policy, environmentPatterns),
      readRule: inferReadRule(policy, environmentPatterns, "ask"),
      writeRule: inferWriteRule(policy, environmentPatterns, "ask"),
      readAskPolicyKey: "sensitivePathPatterns",
      writeAskPolicyKey: "protectedWritePathPatterns",
      policyKeys: ["sensitivePathPatterns", "blockedReadPathPatterns", "protectedWritePathPatterns", "askReadPathPatterns", "askWritePathPatterns"],
    },
    {
      id: "secrets-credentials",
      label: "Secrets and credentials",
      kind: "resource",
      summary: "Credential files, private keys, token exports, and customer-sensitive files.",
      examples: ["credentials/**", "*.pem", "customer-exports/**"],
      patterns: secretPatterns,
      resourcePatterns: buildResourcePatterns(policy, secretPatterns),
      readRule: inferReadRule(policy, secretPatterns, "ask"),
      writeRule: inferWriteRule(policy, secretPatterns, "ask"),
      readAskPolicyKey: "sensitivePathPatterns",
      writeAskPolicyKey: "protectedWritePathPatterns",
      policyKeys: ["sensitivePathPatterns", "blockedReadPathPatterns", "protectedWritePathPatterns", "askReadPathPatterns", "askWritePathPatterns"],
    },
    {
      id: "deployment-runtime-config",
      label: "Deployment and runtime config",
      kind: "resource",
      summary: "Deployment manifests and runtime configuration. Built-in detection asks before matching writes.",
      examples: ["infra/example-deploy/**", "runtime-config.example.ts", "render.example.yaml"],
      patterns: runtimePatterns,
      resourcePatterns: buildResourcePatterns(policy, runtimePatterns),
      readRule: inferReadRule(policy, runtimePatterns, "allow"),
      writeRule: inferWriteRule(policy, runtimePatterns, "ask"),
      readAskPolicyKey: "askReadPathPatterns",
      writeAskPolicyKey: "askWritePathPatterns",
      policyKeys: ["sensitivePathPatterns", "blockedReadPathPatterns", "protectedWritePathPatterns", "askReadPathPatterns", "askWritePathPatterns"],
    },
    {
      id: "generated-dependency-dirs",
      label: "Generated and dependency dirs",
      kind: "resource",
      summary: "Generated output and dependency directories where writes should usually be confirmed.",
      examples: ["vendor-cache/example/**", "build-output/example/**", "generated-example/**"],
      patterns: generatedPatterns,
      resourcePatterns: buildResourcePatterns(policy, generatedPatterns),
      readRule: "allow",
      writeRule: inferWriteRule(policy, generatedPatterns, "ask"),
      readAskPolicyKey: "askReadPathPatterns",
      writeAskPolicyKey: "askWritePathPatterns",
      policyKeys: ["sensitivePathPatterns", "blockedReadPathPatterns", "protectedWritePathPatterns", "askReadPathPatterns", "askWritePathPatterns"],
    },
    {
      id: "dangerous-commands",
      label: "Dangerous commands",
      kind: "command",
      summary: "High-risk shell commands and the default policy for unmatched commands.",
      examples: ["rm *-rf*", "sudo*", "git reset *--hard*"],
      patterns: uniquePatterns([...policy.bashDenyPatterns, ...policy.bashAskPatterns, ...policy.bashAllowPatterns]),
      commandPatterns: {
        deny: policy.bashDenyPatterns,
        ask: policy.bashAskPatterns,
        allow: policy.bashAllowPatterns,
      },
      commandRule: policy.denyBashByDefault || policy.bashDenyPatterns.length > 0 ? "deny" : policy.bashAskPatterns.length > 0 ? "ask" : "allow",
      defaultDenyBash: policy.denyBashByDefault,
      policyKeys: ["bashDenyPatterns", "bashAskPatterns", "bashAllowPatterns", "denyBashByDefault"],
    },
  ];
}

function uniquePatterns(patterns: string[]): string[] {
  return [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))];
}

function buildResourcePatterns(policy: ToolGuardPolicy, patterns: string[]): ToolSafetyResourcePattern[] {
  return patterns.map((pattern) => {
    const readPolicyKey = getReadPolicyKey(policy, pattern);
    const writePolicyKey = getWritePolicyKey(policy, pattern);
    return {
      pattern,
      readRule: readPolicyKey === "blockedReadPathPatterns" ? "deny" : readPolicyKey ? "ask" : "allow",
      readPolicyKey,
      writeRule: writePolicyKey ? "ask" : "allow",
      writePolicyKey,
    };
  });
}

function getReadPolicyKey(policy: ToolGuardPolicy, pattern: string): ToolSafetyReadPolicyKey | undefined {
  if (policy.blockedReadPathPatterns.includes(pattern)) return "blockedReadPathPatterns";
  if (policy.sensitivePathPatterns.includes(pattern)) return "sensitivePathPatterns";
  if (policy.askReadPathPatterns.includes(pattern)) return "askReadPathPatterns";
  return undefined;
}

function getWritePolicyKey(policy: ToolGuardPolicy, pattern: string): ToolSafetyWritePolicyKey | undefined {
  if (policy.protectedWritePathPatterns.includes(pattern)) return "protectedWritePathPatterns";
  if (policy.askWritePathPatterns.includes(pattern)) return "askWritePathPatterns";
  return undefined;
}

function filterPatterns(patterns: string[], predicate: (pattern: string) => boolean): string[] {
  return uniquePatterns(patterns.filter(predicate));
}

function isEnvironmentPattern(pattern: string): boolean {
  const normalized = normalizePathForMatch(pattern).toLowerCase();
  return normalized === ".env" ||
    normalized.startsWith(".env.") ||
    normalized === ".npmrc" ||
    normalized === ".pypirc";
}

function isRuntimePolicyPattern(pattern: string): boolean {
  const normalized = normalizePathForMatch(pattern).toLowerCase();
  return normalized.includes("deploy") ||
    normalized.includes("runtime") ||
    normalized.includes("config") ||
    normalized.includes("infra") ||
    normalized.includes("k8s") ||
    normalized.includes("kubernetes") ||
    normalized.includes("helm") ||
    normalized === "render.yaml" ||
    normalized === "render.yml" ||
    normalized === "wrangler.toml" ||
    normalized === "netlify.toml" ||
    normalized === "docker-compose.yml" ||
    normalized === "docker-compose.yaml" ||
    normalized === "compose.yml" ||
    normalized === "compose.yaml";
}

function isGeneratedDependencyPattern(pattern: string): boolean {
  const normalized = normalizePathForMatch(pattern).toLowerCase();
  return normalized.includes("node_modules") ||
    normalized.includes("dist") ||
    normalized.includes("build") ||
    normalized.includes("coverage") ||
    normalized.includes("generated") ||
    normalized.includes(".next") ||
    normalized.includes(".nuxt");
}

function inferReadRule(
  policy: ToolGuardPolicy,
  patterns: string[],
  fallback: ToolSafetyDecision,
): ToolSafetyDecision {
  if (patterns.some((pattern) => policy.blockedReadPathPatterns.includes(pattern))) return "deny";
  if (patterns.some((pattern) => policy.sensitivePathPatterns.includes(pattern) || policy.askReadPathPatterns.includes(pattern))) {
    return "ask";
  }
  return patterns.length ? "allow" : fallback;
}

function inferWriteRule(
  policy: ToolGuardPolicy,
  patterns: string[],
  fallback: Exclude<ToolSafetyDecision, "deny">,
): Exclude<ToolSafetyDecision, "deny"> {
  if (patterns.some((pattern) => policy.protectedWritePathPatterns.includes(pattern) || policy.askWritePathPatterns.includes(pattern))) {
    return "ask";
  }
  return patterns.length ? "allow" : fallback;
}

function buildPreviewExample(
  label: string,
  policy: ToolGuardPolicy,
  input: { operation: ToolSafetyOperation; targetPath?: string; command?: string },
): ToolSafetyViewModel["previewExamples"][number] {
  return {
    label,
    input,
    result: previewToolSafetyDecision({ policy, ...input }),
  };
}
