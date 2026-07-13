import { loadToolGuardPolicy, saveToolGuardPolicy } from "./access-policy-persistence.js";
import { buildToolSafetyViewModel } from "./access-view-model.js";
import type { ToolSafetyCompanyOptions, ToolSafetyViewModel } from "./access-policy.js";

export {
  defaultToolGuardPolicy,
  normalizeToolGuardPolicy,
  TOOL_GUARD_POLICY_SOURCE,
} from "./access-policy.js";
export type {
  CwdBoundaryMode,
  ToolGuardAdminState,
  ToolGuardPolicy,
  ToolSafetyCapabilityGroup,
  ToolSafetyCompanyOptions,
  ToolSafetyDecision,
  ToolSafetyDecisionPreview,
  ToolSafetyOperation,
  ToolSafetyPreviewInput,
  ToolSafetyReadPolicyKey,
  ToolSafetyResourcePattern,
  ToolSafetyViewModel,
  ToolSafetyWritePolicyKey,
} from "./access-policy.js";
export {
  loadToolGuardAdminState,
  loadToolGuardPolicy,
  saveToolGuardPolicy,
} from "./access-policy-persistence.js";
export { previewToolSafetyDecision } from "./access-safety-preview.js";

export async function loadToolSafetyViewModel(
  repoRoot: string,
  options: ToolSafetyCompanyOptions,
): Promise<ToolSafetyViewModel> {
  return buildToolSafetyViewModel(await loadToolGuardPolicy(repoRoot, options));
}

export async function saveToolSafetyPolicy(input: {
  repoRoot: string;
  policy: unknown;
  companyId: string;
}): Promise<ToolSafetyViewModel> {
  const state = await saveToolGuardPolicy(input);
  return buildToolSafetyViewModel(state.policy);
}
