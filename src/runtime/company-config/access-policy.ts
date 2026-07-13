export interface ToolGuardPolicy {
  version: 1;
  cwdBoundaryReadMode: CwdBoundaryMode;
  cwdBoundaryWriteMode: CwdBoundaryMode;
  sensitivePathPatterns: string[];
  blockedReadPathPatterns: string[];
  protectedWritePathPatterns: string[];
  askReadPathPatterns: string[];
  askWritePathPatterns: string[];
  externalWriteAllowPaths: string[];
  bashDenyPatterns: string[];
  bashAskPatterns: string[];
  bashAllowPatterns: string[];
  denyBashByDefault: boolean;
}

export type CwdBoundaryMode = "allow" | "ask" | "deny";

export interface ToolGuardAdminState {
  policy: ToolGuardPolicy;
  policyPath: string;
}

export type ToolSafetyOperation = "read" | "write" | "bash";
export type ToolSafetyDecision = "allow" | "ask" | "deny";
export type ToolSafetyReadPolicyKey = "sensitivePathPatterns" | "blockedReadPathPatterns" | "askReadPathPatterns";
export type ToolSafetyWritePolicyKey = "protectedWritePathPatterns" | "askWritePathPatterns";

export interface ToolSafetyResourcePattern {
  pattern: string;
  readRule: ToolSafetyDecision;
  readPolicyKey?: ToolSafetyReadPolicyKey;
  writeRule: Exclude<ToolSafetyDecision, "deny">;
  writePolicyKey?: ToolSafetyWritePolicyKey;
}

export interface ToolSafetyPreviewInput {
  policy?: unknown;
  operation?: unknown;
  targetPath?: unknown;
  command?: unknown;
  cwd?: unknown;
}

export interface ToolSafetyDecisionPreview {
  operation: ToolSafetyOperation;
  target: string;
  decision: ToolSafetyDecision;
  matchedPolicy: string;
  reason: string;
}

export interface ToolSafetyCapabilityGroup {
  id:
    | "environment-config"
    | "secrets-credentials"
    | "deployment-runtime-config"
    | "generated-dependency-dirs"
    | "dangerous-commands";
  label: string;
  summary: string;
  kind: "resource" | "command";
  examples: string[];
  patterns: string[];
  resourcePatterns?: ToolSafetyResourcePattern[];
  readRule?: ToolSafetyDecision;
  writeRule?: Exclude<ToolSafetyDecision, "deny">;
  commandRule?: ToolSafetyDecision;
  defaultDenyBash?: boolean;
  commandPatterns?: {
    deny: string[];
    ask: string[];
    allow: string[];
  };
  readAskPolicyKey?: "sensitivePathPatterns" | "askReadPathPatterns";
  writeAskPolicyKey?: "protectedWritePathPatterns" | "askWritePathPatterns";
  policyKeys: Array<keyof ToolGuardPolicy>;
}

export interface ToolSafetyViewModel {
  contract: {
    name: "access";
    version: 1;
    boundary: "runtime-access-policy";
  };
  routes: {
    htmlPath: string;
    viewModelJsonPath: string;
    savePolicyPath: string;
    previewPath: string;
  };
  policy: ToolGuardPolicy;
  policyPath: string;
  capabilityGroups: ToolSafetyCapabilityGroup[];
  previewExamples: Array<{
    label: string;
    input: Required<Pick<ToolSafetyPreviewInput, "operation">> & Pick<ToolSafetyPreviewInput, "targetPath" | "command">;
    result: ToolSafetyDecisionPreview;
  }>;
  advancedEditor: {
    policyJson: string;
  };
}

export interface ToolSafetyCompanyOptions {
  companyId: string;
}

export const TOOL_GUARD_POLICY_SOURCE = "PostgreSQL:tool_safety_policies/default";

export const defaultToolGuardPolicy: ToolGuardPolicy = {
  version: 1,
  cwdBoundaryReadMode: "allow",
  cwdBoundaryWriteMode: "allow",
  sensitivePathPatterns: [
    ".env",
    ".env.*",
    ".npmrc",
    ".pypirc",
    "id_rsa",
    "id_ed25519",
    "kubeconfig",
    ".kubeconfig",
    "secrets/**",
    ".secrets/**",
    "credentials/**",
    ".credentials/**",
    "secrets.json",
    "credentials.json",
    "client_secret.json",
    "service-account.json",
    "service-account-key.json",
    "firebase-service-account.json",
    "google-application-credentials.json",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.kubeconfig",
  ],
  blockedReadPathPatterns: [],
  protectedWritePathPatterns: [
    ".env",
    ".env.*",
    ".npmrc",
    ".pypirc",
    "id_rsa",
    "id_ed25519",
    "kubeconfig",
    ".kubeconfig",
    "secrets/**",
    ".secrets/**",
    "credentials/**",
    ".credentials/**",
    "secrets.json",
    "credentials.json",
    "client_secret.json",
    "service-account.json",
    "service-account-key.json",
    "firebase-service-account.json",
    "google-application-credentials.json",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.kubeconfig",
  ],
  askReadPathPatterns: [],
  askWritePathPatterns: [
    "node_modules/**",
    "dist/**",
    "build/**",
    "coverage/**",
    ".next/**",
    ".nuxt/**",
    "generated/**",
    ".generated/**",
  ],
  externalWriteAllowPaths: [],
  bashDenyPatterns: [
    "rm *-rf*",
    "rm *-fr*",
    "rm *--recursive*",
    "rm *--force*",
    "sudo*",
    "chmod *777*",
    "chmod *-R*",
    "chown *-R*",
    "git reset *--hard*",
    "git clean *-f*d*",
    "git clean *-d*f*",
  ],
  bashAskPatterns: [],
  bashAllowPatterns: [],
  denyBashByDefault: false,
};

export function normalizeToolGuardPolicy(value: unknown): ToolGuardPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tool guard policy must be a JSON object.");
  }
  const candidate = value as Partial<ToolGuardPolicy>;
  if (candidate.version !== 1) {
    throw new Error("tool guard policy requires version=1.");
  }
  return {
    version: 1,
    cwdBoundaryReadMode: normalizeCwdBoundaryMode(candidate.cwdBoundaryReadMode, "cwdBoundaryReadMode"),
    cwdBoundaryWriteMode: normalizeCwdBoundaryMode(candidate.cwdBoundaryWriteMode, "cwdBoundaryWriteMode"),
    sensitivePathPatterns: normalizeStringArray(candidate.sensitivePathPatterns, "sensitivePathPatterns"),
    blockedReadPathPatterns: normalizeStringArray(candidate.blockedReadPathPatterns, "blockedReadPathPatterns"),
    protectedWritePathPatterns: normalizeStringArray(candidate.protectedWritePathPatterns, "protectedWritePathPatterns"),
    askReadPathPatterns: normalizeStringArray(candidate.askReadPathPatterns, "askReadPathPatterns"),
    askWritePathPatterns: normalizeStringArray(candidate.askWritePathPatterns, "askWritePathPatterns"),
    externalWriteAllowPaths: normalizeStringArray(candidate.externalWriteAllowPaths, "externalWriteAllowPaths"),
    bashDenyPatterns: normalizeStringArray(candidate.bashDenyPatterns, "bashDenyPatterns"),
    bashAskPatterns: normalizeStringArray(candidate.bashAskPatterns, "bashAskPatterns"),
    bashAllowPatterns: normalizeStringArray(candidate.bashAllowPatterns, "bashAllowPatterns"),
    denyBashByDefault: candidate.denyBashByDefault === true,
  };
}

function normalizeCwdBoundaryMode(value: unknown, label: string): CwdBoundaryMode {
  if (value === undefined) return "allow";
  if (value === "allow" || value === "ask" || value === "deny") return value;
  throw new Error(`tool guard policy ${label} must be allow, ask, or deny.`);
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`tool guard policy ${label} must be an array of strings.`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`tool guard policy ${label} must be an array of strings.`);
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
