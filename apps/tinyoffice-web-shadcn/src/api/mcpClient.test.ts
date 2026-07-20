import assert from "node:assert/strict";
import test from "node:test";

import { getMcpState } from "./mcpClient";

test("MCP client exposes only the company-scoped read model", async () => {
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
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.deepEqual(requests.map((request) => [request.url, request.init?.method ?? "GET"]), [
    ["http://127.0.0.1:5175/api/companies/acme/mcp", "GET"],
  ]);
});
