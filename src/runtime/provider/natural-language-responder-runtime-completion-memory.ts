import { upsertSessionCompletionMemory } from "../memory/runtime-memory-service.js";
import { RuntimeSessionRepository } from "../storage/runtime-session-repository.js";
import type { NaturalLanguageResponseInput } from "./natural-language-responder-contracts.js";
import { nowIso } from "./natural-language-responder-trace.js";

export async function updateRuntimeSessionCompletionMemory(input: {
  responseInput: NaturalLanguageResponseInput;
  repoRoot: string;
  sessionRecordId: string;
}) {
  const completionRepository = input.responseInput.runtimeSessionRepository ||
    await RuntimeSessionRepository.open(input.repoRoot, {
      companyId: input.responseInput.employee.companyId,
      domains: ["sessions", "memory"],
    });
  try {
    upsertSessionCompletionMemory(completionRepository, {
      sessionRecordId: input.sessionRecordId,
      now: nowIso,
    });
    await completionRepository.save();
  } finally {
    if (!input.responseInput.runtimeSessionRepository) {
      completionRepository.close();
    }
  }
}
