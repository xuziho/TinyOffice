import type { AppView } from "./navigationRoutes";

export type NavigationItem = {
  view: AppView;
  label: string;
};

export type PageSection = {
  title: string;
  description: string;
  items: readonly NavigationItem[];
};

export const workforceNavigation: readonly NavigationItem[] = [
  { view: "employees", label: "Employees" },
  { view: "skills", label: "Company Skills" },
];

export const organizationNavigation: readonly NavigationItem[] = [{ view: "company", label: "Organization" }];

export const integrationsNavigation: readonly NavigationItem[] = [{ view: "integrations", label: "Integrations" }];

export const aiRuntimeNavigation: readonly NavigationItem[] = [
  { view: "system-ai", label: "System AI" },
  { view: "prompt", label: "Prompt" },
  { view: "access", label: "Access" },
  { view: "capabilities", label: "Capabilities" },
];

export const operationsNavigation: readonly NavigationItem[] = [
  { view: "sessions", label: "Runtime Sessions" },
  { view: "doctor", label: "Health" },
  { view: "backup", label: "Backup & Restore" },
  { view: "updates", label: "Updates" },
];

export const pageSections: readonly PageSection[] = [
  {
    title: "Workforce",
    description: "People and shared working knowledge",
    items: workforceNavigation,
  },
  {
    title: "AI & Runtime",
    description: "Models, prompts, access rules, and runtime contracts",
    items: aiRuntimeNavigation,
  },
  {
    title: "Operations",
    description: "Runtime evidence, system health, recovery, and product maintenance",
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
