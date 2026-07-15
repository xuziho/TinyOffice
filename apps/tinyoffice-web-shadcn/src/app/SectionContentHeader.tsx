import type { ReactElement, ReactNode } from "react";

export function SectionContentHeader({
  title,
  description,
  actions,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  return (
    <header className="tiny-section-content-header flex min-w-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3 sm:px-7">
      {title || description ? <div className="min-w-0">
        {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : null}
        {description ? <div className={title ? "mt-0.5 truncate text-xs text-muted-foreground" : "truncate text-sm text-muted-foreground"}>
          {description}
        </div> : null}
      </div> : null}
      {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
