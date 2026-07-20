import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("MCP configuration is AI-managed while the Owner surface remains read-only", () => {
  const page = readFileSync("apps/tinyoffice-web-shadcn/src/mcp/McpPage.tsx", "utf8");
  const client = readFileSync("apps/tinyoffice-web-shadcn/src/api/mcpClient.ts", "utf8");
  const routes = readFileSync("src/api/tinyoffice-api/mcp-routes.ts", "utf8");
  const registry = readFileSync("src/runtime/capabilities/capability-registry.ts", "utf8");

  assert.doesNotMatch(page, /<form\b|<Input\b|<Select\b|saveMcp|deleteMcp/);
  assert.doesNotMatch(client, /method:\s*["'](?:PUT|POST|PATCH|DELETE)["']/);
  assert.doesNotMatch(routes, /app\.(?:put|patch|delete)\(["'][^"']*\/mcp/);
  assert.match(registry, /id:\s*"mcp\.admin\.describe"/);
  assert.match(registry, /id:\s*"mcp\.admin\.configure"/);
  assert.match(registry, /confirmationPolicy:\s*\{\s*required:\s*true/);
});
