import assert from "node:assert/strict";
import test from "node:test";

import { deleteMcpAssignment, getMcpState, saveMcpAssignment, saveMcpConnection, saveMcpServer } from "./mcpClient";

test("MCP client uses the company-scoped management boundary", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = { location: new URL("http://127.0.0.1:5175/mcp") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "tinyoffice-mcp-admin", version: 1, companyId: "acme",
      servers: [], connections: [], assignments: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await getMcpState({ companyId: "acme" });
    await saveMcpServer({ companyId: "acme", body: { serverId: "demo" } });
    await saveMcpConnection({ companyId: "acme", body: { connectionId: "demo-main" } });
    await saveMcpAssignment({ companyId: "acme", body: { connectionId: "demo-main" } });
    await deleteMcpAssignment({ companyId: "acme", assignmentId: "assignment/1" });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.deepEqual(requests.map((request) => [request.url, request.init?.method ?? "GET"]), [
    ["http://127.0.0.1:5175/api/companies/acme/mcp", "GET"],
    ["http://127.0.0.1:5175/api/companies/acme/mcp/servers", "PUT"],
    ["http://127.0.0.1:5175/api/companies/acme/mcp/connections", "PUT"],
    ["http://127.0.0.1:5175/api/companies/acme/mcp/assignments", "PUT"],
    ["http://127.0.0.1:5175/api/companies/acme/mcp/assignments/assignment%2F1", "DELETE"],
  ]);
});
