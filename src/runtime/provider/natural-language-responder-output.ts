import type { PromptInputPackage } from "./prompt-input-package.js";

export function normalizeProviderReplyResult(
  result: string | { message: string; promptInputPackage: PromptInputPackage },
  fallbackPromptInputPackage: PromptInputPackage,
): { message: string; promptInputPackage: PromptInputPackage } {
  if (typeof result === "string") {
    return {
      message: result,
      promptInputPackage: fallbackPromptInputPackage,
    };
  }
  return result;
}

export function shouldRejectEmptyReplyBeforeStructuredReplay(input: {
  reply: string;
  sceneType: "dm_thread" | "channel_thread" | "work_run_execution" | "intake_event";
  replayableStructuredActionCount: number;
}): boolean {
  if (input.reply.trim()) {
    return false;
  }
  if (input.sceneType === "channel_thread") {
    return false;
  }
  return true;
}
