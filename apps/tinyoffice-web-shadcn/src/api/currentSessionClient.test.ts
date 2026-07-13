import assert from "node:assert/strict";
import test from "node:test";

import { switchCurrentCompany } from "./currentSessionClient";

test("switchCurrentCompany writes the authoritative TinyOffice session company", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "tinyoffice-current-session",
      version: 1,
      authMode: "development-preview",
      user: { id: "xuziho", displayName: "Xu Ziho" },
      currentCompanyId: "globex",
      companyId: "globex",
      member: { memberId: "xuziho", displayName: "Xu Ziho", role: "admin" },
      needsInitialization: false,
      source: "development-preview",
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await switchCurrentCompany({ companyId: "globex" });
    assert.equal(result.currentCompanyId, "globex");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/tinyoffice/session/current-company");
  assert.equal(request.init.method, "PUT");
  assert.deepEqual(JSON.parse(String(request.init.body)), { companyId: "globex" });
});
