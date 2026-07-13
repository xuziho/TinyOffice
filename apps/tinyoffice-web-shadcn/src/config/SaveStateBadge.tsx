import { Badge } from "@/components/ui/badge";
import type { ReactElement } from "react";

export function SaveStateBadge({ dirty, saving = false }: { dirty: boolean; saving?: boolean }): ReactElement {
  if (saving) {
    return <Badge variant="secondary">Saving…</Badge>;
  }
  return dirty
    ? <Badge variant="outline">Unsaved changes</Badge>
    : <Badge variant="secondary">Saved</Badge>;
}
