import type { AppView } from "./navigationRoutes";

export type NavigationItem = {
  view: AppView;
  label: string;
};

export type NavigationGroup = {
  label: string;
  items: readonly NavigationItem[];
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

export const adminNavigation: readonly NavigationGroup[] = [
  {
    label: "Organization",
    items: [{ view: "company", label: "Organization" }],
  },
  {
    label: "Automation",
    items: [{ view: "integrations", label: "Integrations" }],
  },
  {
    label: "AI & Runtime",
    items: [
      { view: "system-ai", label: "System AI" },
      { view: "prompt", label: "Prompt" },
      { view: "access", label: "Access" },
      { view: "capabilities", label: "Capabilities" },
    ],
  },
  {
    label: "Operations",
    items: [
      { view: "sessions", label: "Runtime Sessions" },
      { view: "doctor", label: "Health" },
      { view: "backup", label: "Backup & Restore" },
      { view: "updates", label: "Updates" },
    ],
  },
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
    items: adminNavigation.find((group) => group.label === "AI & Runtime")?.items ?? [],
  },
  {
    title: "Operations",
    description: "Runtime evidence, system health, recovery, and product maintenance",
    items: adminNavigation.find((group) => group.label === "Operations")?.items ?? [],
  },
];

export function pageSectionForView(view: AppView): PageSection | undefined {
  return pageSections.find((section) => section.items.some((item) => item.view === view));
}

export function isWorkforceView(view: AppView): boolean {
  return workforceNavigation.some((item) => item.view === view);
}

export function isAdminView(view: AppView): boolean {
  return adminNavigation.some((group) => group.items.some((item) => item.view === view));
}
