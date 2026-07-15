import { cn } from "@/lib/utils";
import type { ReactElement, ReactNode } from "react";

export function PanelNote({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <div className={cn("tiny-panel-note", className)}>{children}</div>;
}

