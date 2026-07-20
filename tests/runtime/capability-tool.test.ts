import assert from "node:assert/strict";
import test from "node:test";

import { executeTinyOfficeCapabilityCallTool } from "../../src/runtime/capabilities/capability-tool.js";

test("Intake integration contract is machine-readable to AI employees", async () => {
  const call = await executeTinyOfficeCapabilityCallTool({
    repoRoot: process.cwd(),
    companyId: "ziho-e-com",
    capabilityId: "intake.integration.describe",
    input: { companyId: "ziho-e-com" },
    conversationId: "conversation-1",
  });

  assert.equal(call.status, "allowed");
  assert.equal(call.capabilityId, "intake.integration.describe");
  const contract = call.result as Record<string, unknown>;
  assert.equal(contract.schema, "tinyoffice-intake-integration-contract");
  assert.equal(contract.method, "POST");
  assert.equal(contract.endpointPath, "/api/companies/ziho-e-com/intake/events");
  assert.equal(contract.targetSelectionCapabilityId, "company.member.directory.list");
  assert.match(JSON.stringify(contract), /targetMemberId/);
  assert.match(JSON.stringify(contract), /sourceEventId/);
});

test("MCP configuration requires explicit operator confirmation before any host definition changes", async () => {
  await assert.rejects(
    () => executeTinyOfficeCapabilityCallTool({
      repoRoot: process.cwd(), companyId: "ziho-e-com", capabilityId: "mcp.admin.configure",
      input: { companyId: "ziho-e-com", operation: "save_server", configuration: { serverId: "demo" } },
      conversationId: "conversation-1", runtimeEmployeeId: "mira",
    }),
    /requires operator confirmation/,
  );
});

test("MCP configuration applies an explicitly confirmed provider-neutral server definition", async () => {
  const call = await executeTinyOfficeCapabilityCallTool({
    repoRoot: process.cwd(), companyId: "ziho-e-com", capabilityId: "mcp.admin.configure",
    input: {
      companyId: "ziho-e-com",
      operation: "save_server",
      configuration: {
        serverId: "test-ai-config", displayName: "Test AI Config", transport: "stdio",
        command: "npx", args: ["-y", "@example/test-mcp"], enabled: false,
      },
    },
    confirmation: { accepted: true },
    conversationId: "conversation-1", runtimeEmployeeId: "mira",
  });
  assert.equal(call.status, "allowed");
  const result = call.result as { operation: string; state: { servers: Array<{ serverId: string; enabled: boolean }> } };
  assert.equal(result.operation, "save_server");
  assert.equal(result.state.servers.find((server) => server.serverId === "test-ai-config")?.enabled, false);
});
