import type { MouseEvent } from "react";

export type AppView = "access" | "backup" | "capabilities" | "chat" | "company" | "doctor" | "employees" | "integrations" | "prompt" | "sessions" | "settings" | "skills" | "system-ai" | "tasks" | "updates";

const appViewByPathSegment: Readonly<Record<string, AppView>> = {
  access: "access",
  backup: "backup",
  capabilities: "capabilities",
  chat: "chat",
  company: "company",
  doctor: "doctor",
  employees: "employees",
  integrations: "integrations",
  prompt: "prompt",
  sessions: "sessions",
  settings: "settings",
  skills: "skills",
  "system-ai": "system-ai",
  tasks: "tasks",
  updates: "updates",
};

export type ChatSurfaceRoute = "direct" | "channel";

export type NavigationTarget =
  | { kind: "app"; view: AppView }
  | { kind: "chat-room"; roomId: string; surface?: ChatSurfaceRoute }
  | ({ kind: "session" } & SessionRouteFocus)
  | ({ kind: "task" } & TaskRouteFocus);

export interface NavigationReturnContext {
  label: string;
  target: NavigationTarget;
}

export interface TinyOfficeNavigationState {
  tinyofficeReturn?: NavigationReturnContext;
}

export interface SessionRouteFocus {
  employeeId?: string;
  sessionId?: string;
  query?: string;
}

export interface TaskRouteFocus {
  taskId?: string;
}

export function appViewHref(view: AppView): string {
  switch (view) {
    case "access":
      return "/access";
    case "capabilities":
      return "/capabilities";
    case "company":
      return "/company";
    case "doctor":
      return "/doctor";
    case "backup":
      return "/backup";
    case "employees":
      return "/employees";
    case "integrations":
      return "/integrations";
    case "prompt":
      return "/prompt";
    case "sessions":
      return "/sessions";
    case "settings":
      return "/settings";
    case "skills":
      return "/skills";
    case "system-ai":
      return "/system-ai";
    case "tasks":
      return "/tasks";
    case "updates":
      return "/updates";
    case "chat":
      return "/chat";
  }
}

export function appViewFromPathname(pathname: string): AppView {
  const firstSegment = pathname.split("/").filter(Boolean)[0] ?? "chat";
  return appViewByPathSegment[firstSegment] ?? "chat";
}

export function chatRoomHref(input: { roomId: string; surface?: ChatSurfaceRoute }): string {
  const params = new URLSearchParams();
  params.set("roomId", input.roomId);
  if (input.surface) {
    params.set("surface", input.surface);
  }
  return `/chat?${params.toString()}`;
}

export function sessionsHref(focus: SessionRouteFocus = {}): string {
  const params = new URLSearchParams();
  if (focus.employeeId) {
    params.set("employeeId", focus.employeeId);
  }
  if (focus.sessionId) {
    params.set("sessionId", focus.sessionId);
  }
  if (focus.query) {
    params.set("q", focus.query);
  }
  const query = params.toString();
  return query ? `/sessions?${query}` : "/sessions";
}

export function tasksHref(focus: TaskRouteFocus = {}): string {
  if (!focus.taskId) {
    return "/tasks";
  }
  const params = new URLSearchParams();
  params.set("taskId", focus.taskId);
  return `/tasks?${params.toString()}`;
}

export function navigationHref(target: NavigationTarget): string {
  switch (target.kind) {
    case "app":
      return appViewHref(target.view);
    case "chat-room":
      return chatRoomHref(target);
    case "session":
      return sessionsHref(target);
    case "task":
      return tasksHref(target);
  }
}

export function navigationViewForTarget(target: NavigationTarget): AppView {
  switch (target.kind) {
    case "app":
      return target.view;
    case "chat-room":
      return "chat";
    case "session":
      return "sessions";
    case "task":
      return "tasks";
  }
}

export function navigationStateWithReturn(input: { from?: NavigationReturnContext } = {}): TinyOfficeNavigationState {
  return input.from ? { tinyofficeReturn: input.from } : {};
}

export function navigationReturnContextFromState(state: unknown): NavigationReturnContext | undefined {
  if (!isRecord(state)) {
    return undefined;
  }
  const candidate = state.tinyofficeReturn;
  if (!isRecord(candidate) || typeof candidate.label !== "string" || !candidate.label.trim()) {
    return undefined;
  }
  const target = parseNavigationTarget(candidate.target);
  return target ? { label: candidate.label, target } : undefined;
}

export function shouldUseClientNavigation(event: MouseEvent<HTMLElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function parseNavigationTarget(value: unknown): NavigationTarget | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }
  if (value.kind === "app" && typeof value.view === "string" && isAppView(value.view)) {
    return { kind: "app", view: value.view };
  }
  if (value.kind === "chat-room" && typeof value.roomId === "string") {
    return {
      kind: "chat-room",
      roomId: value.roomId,
      ...(isChatSurface(value.surface) ? { surface: value.surface } : {}),
    };
  }
  if (value.kind === "session") {
    return {
      kind: "session",
      ...(typeof value.employeeId === "string" ? { employeeId: value.employeeId } : {}),
      ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
      ...(typeof value.query === "string" ? { query: value.query } : {}),
    };
  }
  if (value.kind === "task") {
    return {
      kind: "task",
      ...(typeof value.taskId === "string" ? { taskId: value.taskId } : {}),
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAppView(value: string): value is AppView {
  return ["access", "backup", "capabilities", "chat", "company", "doctor", "employees", "integrations", "prompt", "sessions", "settings", "skills", "system-ai", "tasks", "updates"].includes(value);
}

function isChatSurface(value: unknown): value is ChatSurfaceRoute {
  return value === "direct" || value === "channel";
}

