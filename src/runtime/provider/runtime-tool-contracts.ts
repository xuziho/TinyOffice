export type RuntimeToolBoundaryKind =
  | "guarded_os_tool"
  | "tinyoffice_capability_tool"
  | "protocol_tool"
  | "read_only_memory_tool"
  | "network_tool";

export type RuntimeToolEffect =
  | "filesystem_read"
  | "filesystem_write"
  | "shell"
  | "network"
  | "database_read"
  | "database_write"
  | "runtime_protocol";

export type RuntimeToolScene = "chat_dm" | "chat_channel" | "work_run" | "intake_event";

export interface RuntimeToolBoundary {
  toolName: string;
  kind: RuntimeToolBoundaryKind;
  effect: RuntimeToolEffect;
  guard?: "pi-tool-guard";
  sceneOrder: Partial<Record<RuntimeToolScene, number>>;
}

export const TINYOFFICE_RUNTIME_TOOL_BOUNDARIES = [
  {
    toolName: "read",
    kind: "guarded_os_tool",
    effect: "filesystem_read",
    guard: "pi-tool-guard",
    sceneOrder: { chat_dm: 10, chat_channel: 10, work_run: 60 },
  },
  {
    toolName: "bash",
    kind: "guarded_os_tool",
    effect: "shell",
    guard: "pi-tool-guard",
    sceneOrder: { chat_dm: 20, chat_channel: 20, work_run: 10 },
  },
  {
    toolName: "edit",
    kind: "guarded_os_tool",
    effect: "filesystem_write",
    guard: "pi-tool-guard",
    sceneOrder: { chat_dm: 30, chat_channel: 30, work_run: 20 },
  },
  {
    toolName: "write",
    kind: "guarded_os_tool",
    effect: "filesystem_write",
    guard: "pi-tool-guard",
    sceneOrder: { chat_dm: 40, chat_channel: 40, work_run: 110 },
  },
  {
    toolName: "grep",
    kind: "guarded_os_tool",
    effect: "filesystem_read",
    guard: "pi-tool-guard",
    sceneOrder: { chat_dm: 50, chat_channel: 50, work_run: 40 },
  },
  {
    toolName: "find",
    kind: "guarded_os_tool",
    effect: "filesystem_read",
    guard: "pi-tool-guard",
    sceneOrder: { chat_dm: 60, chat_channel: 60, work_run: 30 },
  },
  {
    toolName: "ls",
    kind: "guarded_os_tool",
    effect: "filesystem_read",
    guard: "pi-tool-guard",
    sceneOrder: { chat_dm: 70, chat_channel: 70, work_run: 50 },
  },
  {
    toolName: "webfetch",
    kind: "network_tool",
    effect: "network",
    sceneOrder: { chat_dm: 80, chat_channel: 80, work_run: 90 },
  },
  {
    toolName: "websearch",
    kind: "network_tool",
    effect: "network",
    sceneOrder: { chat_dm: 90, chat_channel: 90, work_run: 100 },
  },
  {
    toolName: "recall_memory",
    kind: "read_only_memory_tool",
    effect: "database_read",
    sceneOrder: { chat_dm: 100, chat_channel: 100, work_run: 70 },
  },
  {
    toolName: "tinyoffice_capability_list",
    kind: "tinyoffice_capability_tool",
    effect: "database_read",
    sceneOrder: { chat_dm: 110, chat_channel: 110, work_run: 80 },
  },
  {
    toolName: "tinyoffice_capability_describe",
    kind: "tinyoffice_capability_tool",
    effect: "database_read",
    sceneOrder: { chat_dm: 120, chat_channel: 120, work_run: 85 },
  },
  {
    toolName: "tinyoffice_capability_call",
    kind: "tinyoffice_capability_tool",
    effect: "database_write",
    sceneOrder: { chat_dm: 130, chat_channel: 130, work_run: 88 },
  },
  {
    toolName: "handoff_topic_turn",
    kind: "protocol_tool",
    effect: "runtime_protocol",
    sceneOrder: { chat_channel: 140 },
  },
  {
    toolName: "finish_work_turn",
    kind: "protocol_tool",
    effect: "runtime_protocol",
    sceneOrder: { work_run: 140 },
  },
  {
    toolName: "finish_intake_turn",
    kind: "protocol_tool",
    effect: "runtime_protocol",
    sceneOrder: { intake_event: 10 },
  },
] as const satisfies readonly RuntimeToolBoundary[];

export type TinyOfficeRuntimeToolName = (typeof TINYOFFICE_RUNTIME_TOOL_BOUNDARIES)[number]["toolName"];

export const TINYOFFICE_RUNTIME_TOOL_NAMES = TINYOFFICE_RUNTIME_TOOL_BOUNDARIES
  .map((boundary) => boundary.toolName);

function activeToolNamesForScene(scene: RuntimeToolScene): TinyOfficeRuntimeToolName[] {
  const boundaries: readonly RuntimeToolBoundary[] = TINYOFFICE_RUNTIME_TOOL_BOUNDARIES;
  return boundaries
    .filter((boundary) => boundary.sceneOrder[scene] !== undefined)
    .sort((left, right) => (left.sceneOrder[scene] || 0) - (right.sceneOrder[scene] || 0))
    .map((boundary) => boundary.toolName as TinyOfficeRuntimeToolName);
}

export const CHAT_DM_ACTIVE_TOOL_NAMES = activeToolNamesForScene("chat_dm");
export const CHAT_CHANNEL_ACTIVE_TOOL_NAMES = activeToolNamesForScene("chat_channel");
export const WORK_RUN_ACTIVE_TOOL_NAMES = activeToolNamesForScene("work_run");
export const INTAKE_EVENT_ACTIVE_TOOL_NAMES = activeToolNamesForScene("intake_event");
