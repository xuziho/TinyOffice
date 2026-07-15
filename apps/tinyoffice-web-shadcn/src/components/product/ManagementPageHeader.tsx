import { cn } from "@/lib/utils";
import type { ReactElement, ReactNode } from "react";

export function ManagementPageHeader({
  title,
  context,
  actions,
  className,
}: {
  title: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <header className={cn("tiny-room-header tiny-management-page-header border-b", className)}>
      <div className="min-w-0">
        <div className="tiny-room-title truncate">{title}</div>
        {context ? <div className="tiny-room-subtitle truncate">{context}</div> : null}
      </div>
      {actions ? <div className="tiny-management-page-actions">{actions}</div> : null}
    </header>
  );
}

