import { Button } from "@/components/ui/button";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { appViewHref, type AppView } from "./navigationRoutes";
import type { PageSection } from "./navigationStructure";

export function SectionNavigation({
  activeView,
  section,
  onSelect,
  onPreload,
}: {
  activeView: AppView;
  section: PageSection;
  onSelect(view: AppView): void;
  onPreload?(view: AppView): void;
}): ReactElement {
  const { t } = useTranslation();
  const sectionTitle = t(section.titleKey);
  return (
    <header className="tiny-section-navigation min-w-0 border-b bg-background">
      <div className="min-w-0 px-5 py-3 sm:px-7">
        <h1 className="text-base font-semibold leading-tight">{sectionTitle}</h1>
      </div>
      <nav className="tiny-section-tabs flex min-w-0 items-stretch gap-2 overflow-x-auto overflow-y-hidden border-t px-5 sm:px-7" aria-label={t("nav.pages", { section: sectionTitle })}>
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
              onPointerEnter={() => onPreload?.(item.view)}
              onFocus={() => onPreload?.(item.view)}
              onClick={(event) => {
                event.preventDefault();
                onSelect(item.view);
              }}
            >
              {t(item.labelKey)}
            </a>
          </Button>
        ))}
      </nav>
    </header>
  );
}
