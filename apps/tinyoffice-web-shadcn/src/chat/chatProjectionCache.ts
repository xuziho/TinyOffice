import type { ChatProjectionPage, CreateChatEntryResponse } from "tinyoffice/frontend-api-contracts";

export function projectionWithCreatedEntry(
  projection: ChatProjectionPage | undefined,
  created: CreateChatEntryResponse,
): ChatProjectionPage {
  const existingContainers = projection?.containers ?? [];
  const existingEntries = projection?.entries ?? [];
  return {
    containers: upsertBy(
      existingContainers,
      created.container,
      (container) => container.containerId,
    ),
    entries: upsertBy(
      existingEntries,
      created.entry,
      (entry) => entry.entryId,
    ),
    ...(projection?.nextCursor ? { nextCursor: projection.nextCursor } : {}),
  };
}

function upsertBy<T>(items: T[], next: T, keyFor: (item: T) => string): T[] {
  const nextKey = keyFor(next);
  const existingIndex = items.findIndex((item) => keyFor(item) === nextKey);
  if (existingIndex < 0) {
    return [...items, next];
  }
  return items.map((item, index) => index === existingIndex ? next : item);
}
