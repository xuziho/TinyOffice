import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  CHAT_CHANNEL_ACTIVE_TOOL_NAMES,
  CHAT_DM_ACTIVE_TOOL_NAMES,
  TINYOFFICE_RUNTIME_TOOL_BOUNDARIES,
  TINYOFFICE_RUNTIME_TOOL_NAMES,
  WORK_RUN_ACTIVE_TOOL_NAMES,
} from "../../src/runtime/provider/runtime-tool-contracts.js";

const repoRoot = process.cwd();

test("every TinyOffice runtime tool declares an execution boundary", () => {
  const names = TINYOFFICE_RUNTIME_TOOL_NAMES;
  const boundaryNames = TINYOFFICE_RUNTIME_TOOL_BOUNDARIES.map((boundary) => boundary.toolName);

  assert.deepEqual(boundaryNames, names);
  assert.equal(new Set(boundaryNames).size, boundaryNames.length);
});

test("low-level OS tools are explicitly guarded by pi-tool-guard", () => {
  const guardedTools = TINYOFFICE_RUNTIME_TOOL_BOUNDARIES
    .filter((boundary) => boundary.kind === "guarded_os_tool")
    .map((boundary) => boundary.toolName)
    .sort();

  assert.deepEqual(guardedTools, [
    "bash",
    "edit",
    "find",
    "grep",
    "ls",
    "read",
    "write",
  ]);
  for (const boundary of TINYOFFICE_RUNTIME_TOOL_BOUNDARIES.filter((item) => item.kind === "guarded_os_tool")) {
    assert.equal(boundary.guard, "pi-tool-guard");
  }
});

test("scene active tool lists are derived from the runtime boundary contract", () => {
  assert.deepEqual(CHAT_DM_ACTIVE_TOOL_NAMES, [
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "webfetch",
    "websearch",
    "recall_memory",
    "tinyoffice_capability_list",
    "tinyoffice_capability_describe",
    "tinyoffice_capability_call",
  ]);
  assert.deepEqual(CHAT_CHANNEL_ACTIVE_TOOL_NAMES, [
    ...CHAT_DM_ACTIVE_TOOL_NAMES,
    "handoff_topic_turn",
  ]);
  assert.deepEqual(WORK_RUN_ACTIVE_TOOL_NAMES, [
    "bash",
    "edit",
    "find",
    "grep",
    "ls",
    "read",
    "recall_memory",
    "tinyoffice_capability_list",
    "tinyoffice_capability_describe",
    "tinyoffice_capability_call",
    "webfetch",
    "websearch",
    "write",
    "finish_work_turn",
  ]);
});

test("business, protocol, memory, and network tools stay out of Access OS guard classification", () => {
  const byName = new Map(TINYOFFICE_RUNTIME_TOOL_BOUNDARIES.map((boundary) => [boundary.toolName, boundary]));

  assert.equal(byName.get("tinyoffice_capability_list")?.kind, "tinyoffice_capability_tool");
  assert.equal(byName.get("tinyoffice_capability_describe")?.kind, "tinyoffice_capability_tool");
  assert.equal(byName.get("tinyoffice_capability_call")?.kind, "tinyoffice_capability_tool");
  assert.equal(byName.has("tinyoffice_api_request"), false);
  assert.equal(byName.get("recall_memory")?.kind, "read_only_memory_tool");
  assert.equal(byName.get("webfetch")?.kind, "network_tool");
  assert.equal(byName.get("websearch")?.kind, "network_tool");
  assert.equal(byName.get("handoff_topic_turn")?.kind, "protocol_tool");
  assert.equal(byName.get("finish_work_turn")?.kind, "protocol_tool");
  assert.equal(byName.get("finish_intake_turn")?.kind, "protocol_tool");
});

test("locally registered PI tools are declared in the runtime boundary contract", async () => {
  const sources = await Promise.all([
    readFile(path.join(repoRoot, "src/collaboration/pi/collaboration-actions-extension.ts"), "utf8"),
    readFile(path.join(repoRoot, "packages/pi-web-tools/extensions/webfetch.ts"), "utf8"),
    readFile(path.join(repoRoot, "packages/pi-web-tools/extensions/websearch.ts"), "utf8"),
  ]);
  const registeredToolNames = sources
    .flatMap((source) => Array.from(source.matchAll(/registerTool\(\{\s*name:\s*"([^"]+)"/g)))
    .map((match) => match[1])
    .sort();
  const boundaryNames = new Set(TINYOFFICE_RUNTIME_TOOL_NAMES);

  for (const toolName of registeredToolNames) {
    assert.equal(boundaryNames.has(toolName), true, `${toolName} must declare a runtime execution boundary`);
  }
});

test("host-owned collaboration tools use PI inline extension factories", async () => {
  const transportSource = await readFile(
    path.join(repoRoot, "src/runtime/pi/persistent-pi-session-transport.ts"),
    "utf8",
  );
  const employeeHomeSource = await readFile(
    path.join(repoRoot, "src/runtime/registry/employee-home.ts"),
    "utf8",
  );

  assert.match(transportSource, /extensionFactories:\s*\[\{[\s\S]*?tinyoffice-collaboration-actions[\s\S]*?collaborationActionsExtension/);
  assert.doesNotMatch(employeeHomeSource, /tinyoffice-collaboration-actions/);
});
