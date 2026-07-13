import type { RuntimeSessionMetadata } from "../storage/runtime-session-repository.js";
import type { NaturalLanguageResponseInput } from "./natural-language-responder-contracts.js";

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
    .sort((left, right) => left.localeCompare(right));
}

export function buildInitialRuntimeSessionMetadata(input: NaturalLanguageResponseInput): RuntimeSessionMetadata {
  const modelProvider = input.employee.runtime?.modelProvider;
  const modelId = input.employee.runtime?.modelId;
  const activeToolNames = uniqueSorted(input.activeToolNames || []);
  return {
    model: modelProvider && modelId
      ? {
          state: "recorded",
          provider: modelProvider,
          id: modelId,
          source: "employee.runtime",
        }
      : {
          state: "not_recorded",
          source: "employee.runtime",
          diagnostic: "No explicit employee runtime model was configured.",
        },
    cwd: input.employee.workspacePath
      ? {
          state: "recorded",
          value: input.employee.workspacePath,
          source: "employee.workspacePath",
        }
      : {
          state: "not_recorded",
          source: "employee.workspacePath",
          diagnostic: "Employee workspace path was not available when the session started.",
        },
    tools: {
      state: activeToolNames.length > 0 ? "partial" : "not_observed",
      source: "natural_language_response_input",
      activeToolNames,
      diagnostic: activeToolNames.length > 0
        ? "Active tools were requested for this reply."
        : "No narrowed active tool set was requested for this reply.",
    },
  };
}
