export type ResourcePolicyDecision = "allow" | "approval" | "deny";

export interface FilesystemResourcePolicy {
  ownWorkspace: ResourcePolicyDecision;
  otherEmployeeWorkspace: ResourcePolicyDecision;
  repo: ResourcePolicyDecision;
  secrets: ResourcePolicyDecision;
}

export interface EmployeeResourcePolicy {
  version: 1;
  filesystem: FilesystemResourcePolicy;
}

export const DEFAULT_RESOURCE_POLICY: EmployeeResourcePolicy = {
  version: 1,
  filesystem: {
    ownWorkspace: "allow",
    otherEmployeeWorkspace: "allow",
    repo: "allow",
    secrets: "deny",
  },
};

const DECISIONS = new Set<ResourcePolicyDecision>(["allow", "approval", "deny"]);

function normalizeDecision(value: unknown, fallback: ResourcePolicyDecision): ResourcePolicyDecision {
  return typeof value === "string" && DECISIONS.has(value as ResourcePolicyDecision)
    ? (value as ResourcePolicyDecision)
    : fallback;
}

export function normalizeResourcePolicy(value: unknown): EmployeeResourcePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_RESOURCE_POLICY;
  }

  const candidate = value as Partial<EmployeeResourcePolicy>;
  const filesystem =
    candidate.filesystem && typeof candidate.filesystem === "object" && !Array.isArray(candidate.filesystem)
      ? (candidate.filesystem as Partial<FilesystemResourcePolicy>)
      : {};

  return {
    version: 1,
    filesystem: {
      ownWorkspace: normalizeDecision(
        filesystem.ownWorkspace,
        DEFAULT_RESOURCE_POLICY.filesystem.ownWorkspace,
      ),
      otherEmployeeWorkspace: normalizeDecision(
        filesystem.otherEmployeeWorkspace,
        DEFAULT_RESOURCE_POLICY.filesystem.otherEmployeeWorkspace,
      ),
      repo: normalizeDecision(filesystem.repo, DEFAULT_RESOURCE_POLICY.filesystem.repo),
      secrets: normalizeDecision(
        filesystem.secrets,
        DEFAULT_RESOURCE_POLICY.filesystem.secrets,
      ),
    },
  };
}
