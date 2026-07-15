import type { AppView } from "./navigationRoutes";

export type NavigationItem = {
  view: AppView;
  label: string;
};

export type NavigationGroup = {
  label: string;
  items: readonly NavigationItem[];
};

export const workforceNavigation: readonly NavigationItem[] = [
  { view: "employees", label: "Employees" },
  { view: "skills", label: "Company Skills" },
];

export const adminNavigation: readonly NavigationGroup[] = [
  {
    label: "Company",
    items: [
      { view: "company", label: "Organization" },
      { view: "integrations", label: "Integrations" },
    ],
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
    label: "System",
    items: [
      { view: "sessions", label: "Sessions" },
      { view: "doctor", label: "Health" },
      { view: "backup", label: "Backup & Restore" },
    ],
  },
];

export function isWorkforceView(view: AppView): boolean {
  return workforceNavigation.some((item) => item.view === view);
}

export function isAdminView(view: AppView): boolean {
  return adminNavigation.some((group) => group.items.some((item) => item.view === view));
}
