import { Button } from "@/components/ui/button";
import type { ReactElement } from "react";

import { appViewHref, type AppView } from "./navigationRoutes";
import type { PageSection } from "./navigationStructure";

export function SectionNavigation({
  activeView,
  section,
  onSelect,
}: {
  activeView: AppView;
  section: PageSection;
  onSelect(view: AppView): void;
}): ReactElement {
  return (
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b bg-background px-5 py-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{section.title}</div>
        <div className="truncate text-xs text-muted-foreground">{section.description}</div>
      </div>
      <nav className="flex min-w-0 flex-wrap items-center gap-1" aria-label={`${section.title} pages`}>
        {section.items.map((item) => (
          <Button
            key={item.view}
            asChild
            size="sm"
            variant={item.view === activeView ? "default" : "ghost"}
          >
            <a
              href={appViewHref(item.view)}
              aria-current={item.view === activeView ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                onSelect(item.view);
              }}
            >
              {item.label}
            </a>
          </Button>
        ))}
      </nav>
    </header>
  );
}
