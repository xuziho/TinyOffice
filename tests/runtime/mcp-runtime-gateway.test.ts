import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

import type { McpResolvedConnection } from "../../src/mcp/domain.js";
import { McpAdminService } from "../../src/mcp/mcp-admin-service.js";
import { McpRuntimeGateway } from "../../src/mcp/mcp-runtime-gateway.js";

const connection: McpResolvedConnection = {
  connectionId: "demo-main", serverId: "demo", displayName: "Demo", envRefs: {}, headerRefs: {}, enabled: true,
  createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z",
  server: { serverId: "demo", displayName: "Demo", transport: "stdio", command: "unused", args: [], enabled: true,
    createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z" },
};

async function connectedDemoServer(): Promise<{ server: McpServer; clientTransport: InMemoryTransport }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "demo", version: "1.0.0" });
  server.registerTool("echo", {
    description: "Echo a value",
    inputSchema: z.object({ value: z.string(), apiToken: z.string().optional() }),
  }, async ({ value }) => ({ content: [{ type: "text", text: value }] }));
  await server.connect(serverTransport);
  return { server, clientTransport };
}

test("MCP runtime gateway discovers only assigned tools with explicit connection identity", async () => {
  const { server, clientTransport } = await connectedDemoServer();
  let closed = false;
  const gateway = new McpRuntimeGateway("unused", {
    openRepository: async () => ({
      close: () => { closed = true; },
      listAssignedConnections: async () => [connection],
      getAssignedConnection: async () => connection,
      beginAudit: async () => ({ eventId: "event", startedAt: Date.now() }),
      completeAudit: async () => undefined,
    }),
    createTransport: () => clientTransport,
  });
  try {
    const tools = await gateway.listAssignedTools({ companyId: "acme", memberId: "avery" });
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.connectionId, "demo-main");
    assert.equal(tools[0]?.name, "echo");
    assert.match(JSON.stringify(tools[0]?.inputSchema), /apiToken/);
    assert.equal(closed, true);
  } finally { await server.close(); }
});

test("MCP runtime gateway calls an assigned tool and redacts sensitive audit fields", async () => {
  const { server, clientTransport } = await connectedDemoServer();
  const audits: Array<Record<string, unknown>> = [];
  const gateway = new McpRuntimeGateway("unused", {
    openRepository: async () => ({
      close: () => undefined,
      listAssignedConnections: async () => [connection],
      getAssignedConnection: async (_companyId, _memberId, connectionId) => {
        if (connectionId !== connection.connectionId) throw new Error("unassigned");
        return connection;
      },
      beginAudit: async (input) => { audits.push(input); return { eventId: "event", startedAt: Date.now() }; },
      completeAudit: async (input) => { audits.push(input); },
    }),
    createTransport: () => clientTransport,
  });
  try {
    const result = await gateway.callAssignedTool({
      companyId: "acme", memberId: "avery", connectionId: "demo-main", toolName: "echo",
      arguments: { value: "hello", apiToken: "do-not-store" }, sessionKey: "session-1",
    });
    assert.match(JSON.stringify(result), /hello/);
    assert.doesNotMatch(JSON.stringify(audits), /do-not-store/);
    assert.match(JSON.stringify(audits), /"sensitiveArgumentKeys":\["apiToken"\]/);
    assert.match(JSON.stringify(audits), /"contentTypes":\["text"\]/);
    assert.equal(audits[1]?.status, "succeeded");
  } finally { await server.close(); }
});

test("MCP discovery keeps working connections available when another assigned connection fails", async () => {
  const { server, clientTransport } = await connectedDemoServer();
  const unavailable = { ...connection, connectionId: "broken-main", displayName: "Broken" };
  const failingTransport: Transport = {
    start: async () => { throw new Error("connection unavailable"); },
    send: async () => undefined,
    close: async () => undefined,
  };
  const gateway = new McpRuntimeGateway("unused", {
    openRepository: async () => ({
      close: () => undefined,
      listAssignedConnections: async () => [connection, unavailable],
      getAssignedConnection: async () => connection,
      beginAudit: async () => ({ eventId: "event", startedAt: Date.now() }),
      completeAudit: async () => undefined,
    }),
    createTransport: (candidate) => candidate.connectionId === unavailable.connectionId ? failingTransport : clientTransport,
  });
  try {
    const discovery = await gateway.discoverAssignedTools({ companyId: "acme", memberId: "avery" });
    assert.deepEqual(discovery.tools.map((tool) => tool.name), ["echo"]);
    assert.deepEqual(discovery.unavailableConnections, [{
      connectionId: "broken-main", connectionName: "Broken", error: "connection unavailable",
    }]);
  } finally { await server.close(); }
});

test("MCP runtime gateway uses the official stdio transport for a real child server", async () => {
  const stdioConnection: McpResolvedConnection = {
    ...connection,
    connectionId: "stdio-main",
    displayName: "Stdio",
    server: {
      ...connection.server,
      serverId: "stdio",
      command: process.execPath,
      args: ["--import", "tsx", "tests/fixtures/mcp-stdio-server.ts"],
    },
  };
  const gateway = new McpRuntimeGateway(process.cwd(), {
    openRepository: async () => ({
      close: () => undefined,
      listAssignedConnections: async () => [stdioConnection],
      getAssignedConnection: async () => stdioConnection,
      beginAudit: async () => ({ eventId: "event", startedAt: Date.now() }),
      completeAudit: async () => undefined,
    }),
  });
  const tools = await gateway.listAssignedTools({ companyId: "acme", memberId: "avery", timeoutMs: 10_000 });
  assert.deepEqual(tools.map((tool) => tool.name), ["echo"]);
  const result = await gateway.callAssignedTool({
    companyId: "acme", memberId: "avery", connectionId: "stdio-main", toolName: "echo",
    arguments: { value: "stdio-ok" }, timeoutMs: 10_000,
  });
  assert.match(JSON.stringify(result), /stdio-ok/);
});

test("MCP administration rejects inline credentials before persistence", async () => {
  const service = new McpAdminService(process.cwd());
  await assert.rejects(() => service.saveServer({
    serverId: "unsafe-stdio", displayName: "Unsafe", transport: "stdio", command: "npx",
    args: ["--token", "do-not-store"],
  }), /cannot contain credential flags or values/);
  await assert.rejects(() => service.saveServer({
    serverId: "unsafe-http", displayName: "Unsafe", transport: "streamable_http",
    url: "https://user:password@example.com/mcp",
  }), /cannot contain credentials/);
});
