import type { ReactElement } from "react";

export function SystemMessage({ text, tone = "default" }: { text: string; tone?: "default" | "error" }): ReactElement {
  return (
    <div className={tone === "error" ? "tiny-chat-system-message tiny-chat-system-message-error rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive" : "tiny-chat-system-message rounded-md border px-3 py-2 text-sm text-muted-foreground"}>
      {text}
    </div>
  );
}
