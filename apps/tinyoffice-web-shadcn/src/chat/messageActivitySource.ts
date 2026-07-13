import type { MessagePage } from "tinyoffice/frontend-api-contracts";

export type MessageActivitySource = {
  sourceMessageId: string;
};

export function activitySourceForMessage(message: MessagePage["messages"][number]): MessageActivitySource | undefined {
  const processTraceLink = message.runtimeLinks.find((link) => link.targetKind === "process_trace" && link.sourceMessageId?.trim());
  if (!processTraceLink?.sourceMessageId?.trim()) {
    return undefined;
  }
  return {
    sourceMessageId: processTraceLink.sourceMessageId.trim(),
  };
}

export function latestActivitySourceForMessages(messages: MessagePage["messages"]): MessageActivitySource | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const source = activitySourceForMessage(messages[index]);
    if (source) {
      return source;
    }
  }
  return undefined;
}
