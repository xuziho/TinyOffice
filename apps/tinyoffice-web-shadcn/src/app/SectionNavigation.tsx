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
    <header className="tiny-section-navigation min-w-0 border-b bg-background">
      <div className="min-w-0 px-5 pb-2 pt-3 sm:px-7">
        <h1 className="text-base font-semibold leading-tight">{section.title}</h1>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{section.description}</div>
      </div>
      <nav className="tiny-section-tabs flex min-w-0 items-stretch gap-2 overflow-x-auto overflow-y-hidden border-t px-5 sm:px-7" aria-label={`${section.title} pages`}>
        {section.items.map((item) => (
          <Button
            key={item.view}
            asChild
            size="sm"
            variant="ghost"
            className="tiny-section-tab relative h-10 shrink-0 rounded-none px-3 text-muted-foreground shadow-none hover:text-foreground data-[active=true]:font-semibold"
            data-active={item.view === activeView}
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
