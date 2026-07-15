import type { AppView } from "./navigationRoutes";

export type NavigationItem = {
  view: AppView;
  labelKey: string;
};

export type PageSection = {
  titleKey: string;
  items: readonly NavigationItem[];
};

export const workforceNavigation: readonly NavigationItem[] = [
  { view: "employees", labelKey: "nav.employees" },
  { view: "skills", labelKey: "nav.companySkills" },
];

export const organizationNavigation: readonly NavigationItem[] = [{ view: "company", labelKey: "nav.organization" }];

export const integrationsNavigation: readonly NavigationItem[] = [{ view: "integrations", labelKey: "nav.integrations" }];

export const aiRuntimeNavigation: readonly NavigationItem[] = [
  { view: "system-ai", labelKey: "nav.systemAi" },
  { view: "prompt", labelKey: "nav.prompt" },
  { view: "access", labelKey: "nav.access" },
  { view: "capabilities", labelKey: "nav.capabilities" },
];

export const operationsNavigation: readonly NavigationItem[] = [
  { view: "sessions", labelKey: "nav.runtimeSessions" },
  { view: "doctor", labelKey: "nav.health" },
  { view: "backup", labelKey: "nav.backupRestore" },
  { view: "updates", labelKey: "nav.updates" },
];

export const pageSections: readonly PageSection[] = [
  {
    titleKey: "nav.workforce",
    items: workforceNavigation,
  },
  {
    titleKey: "nav.aiRuntime",
    items: aiRuntimeNavigation,
  },
  {
    titleKey: "nav.operations",
    items: operationsNavigation,
  },
];

export function pageSectionForView(view: AppView): PageSection | undefined {
  return pageSections.find((section) => section.items.some((item) => item.view === view));
}

export function isWorkforceView(view: AppView): boolean {
  return workforceNavigation.some((item) => item.view === view);
}

export function isAiRuntimeView(view: AppView): boolean {
  return aiRuntimeNavigation.some((item) => item.view === view);
}

export function isOperationsView(view: AppView): boolean {
  return operationsNavigation.some((item) => item.view === view);
}
