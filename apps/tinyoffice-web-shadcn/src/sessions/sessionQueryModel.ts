import type { SessionExplorerViewModel } from "tinyoffice/frontend-api-contracts";

export function sessionQueryPlaceholderData(
  previousData: SessionExplorerViewModel | undefined,
): SessionExplorerViewModel | undefined {
  return previousData;
}
