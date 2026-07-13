import type { RuntimeSessionEvent } from "../storage/runtime-session-repository.js";
import type { SessionExplorerPromptInputPackage } from "./session-explorer-types.js";
import { uniqueSorted } from "./session-explorer-projection-utils.js";

export function splitRuntimePromptSections(input: {
  runtimePrompt: string;
  contextBlocks: Array<{ label?: string }>;
}) {
  const prompt = input.runtimePrompt || "";
  if (!prompt.trim()) {
    return { runtimeContext: "" };
  }
  const userMarker = "\n\nUser Message:\n";
  const userMarkerIndex = prompt.indexOf(userMarker);
  const beforeUserMessage = userMarkerIndex === -1
    ? prompt
    : prompt.slice(0, userMarkerIndex);
  const sectionMarkers = input.contextBlocks
    .map((block) => block.label?.trim())
    .filter((label): label is string => Boolean(label))
    .map((label) => `\n\n${label}:\n`);
  const firstStructuredMarker = sectionMarkers
    .map((marker) => beforeUserMessage.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const runtimeContext = firstStructuredMarker === undefined
    ? beforeUserMessage
    : beforeUserMessage.slice(0, firstStructuredMarker);
  return { runtimeContext };
}

export function buildPromptInputPackages(events: RuntimeSessionEvent[]): SessionExplorerPromptInputPackage[] {
  return events
    .filter((event) => event.kind === "prompt_input_package")
    .map((event) => {
      const payload = event.payload && typeof event.payload === "object"
        ? event.payload as {
          employeeId?: string;
          sessionKey?: string;
          sceneType?: string;
          createdAt?: string;
          systemPrompt?: { text?: string };
          runtimePrompt?: { userPrompt?: string };
          userMessage?: { text?: string };
          contextBlocks?: Array<{ role?: string; source?: string; label?: string; text?: string }>;
          promptBlocks?: Array<{ id?: string; path?: string; sha256?: string; content?: string }>;
          employeeInstructions?: Array<{ path?: string; sha256?: string; content?: string }>;
          tools?: Array<{ name?: string }>;
          skills?: Array<{ name?: string }>;
          cacheEvidence?: {
            fullInputSha256?: string;
            stablePrefixSha256?: string;
            estimatedStablePrefixChars?: number;
          };
        }
        : {};
      const runtimePrompt = payload.runtimePrompt?.userPrompt || event.preview || event.summary || "";
      const contextBlocks = (payload.contextBlocks || []).map((block) => ({
        role: block.role || "context",
        source: block.source || "unknown_source",
        label: block.label || "Context block",
        text: block.text || "",
      }));
      const splitPrompt = splitRuntimePromptSections({
        runtimePrompt,
        contextBlocks,
      });
      return {
        turnId: event.turnId,
        modelCallId: event.modelCallId,
        createdAt: payload.createdAt || event.timestamp,
        employeeId: payload.employeeId || "",
        sessionKey: payload.sessionKey,
        sceneType: payload.sceneType,
        systemPrompt: payload.systemPrompt?.text || "",
        runtimePrompt,
        runtimeContext: splitPrompt.runtimeContext,
        contextBlocks,
        triggerMessage: payload.userMessage?.text || "",
        userMessage: payload.userMessage?.text || "",
        promptBlocks: (payload.promptBlocks || []).map((block) => ({
          id: block.id || block.path || "prompt-block",
          sha256: block.sha256,
          content: block.content,
        })),
        employeeInstructions: (payload.employeeInstructions || []).map((file) => ({
          path: file.path || "employee-instruction",
          sha256: file.sha256,
          content: file.content,
        })),
        tools: uniqueSorted((payload.tools || []).map((tool) => tool.name || "").filter(Boolean)),
        skills: uniqueSorted((payload.skills || []).map((skill) => skill.name || "").filter(Boolean)),
        cacheEvidence: {
          fullInputSha256: payload.cacheEvidence?.fullInputSha256,
          stablePrefixSha256: payload.cacheEvidence?.stablePrefixSha256,
          estimatedStablePrefixChars: payload.cacheEvidence?.estimatedStablePrefixChars,
        },
      };
    });
}
