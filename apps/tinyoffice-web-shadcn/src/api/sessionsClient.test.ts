import assert from "node:assert/strict";
import test from "node:test";

import { getSessionExplorerViewModel } from "./sessionsClient";

test("getSessionExplorerViewModel reads the company-scoped Session Explorer API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/sessions") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      contract: { name: "session-explorer", version: 1, runtimeBoundary: "runtime-session-inspector" },
      routes: {
        indexJsonPath: "/api/companies/ziho-co/sessions/view-model",
        detailJsonPath: "/api/companies/ziho-co/sessions/view-model",
        viewModelJsonPath: "/api/companies/ziho-co/sessions/view-model",
      },
      refresh: {
        strategy: "runtime-events",
        snapshotUses: ["initial-load", "manual-refresh", "reconnect-reconciliation"],
        eventSources: ["session", "employee", "process_trace"],
        expectsRunningSessions: true,
        expectsIncrementalDetailEvents: true,
      },
      filters: { query: "launch", employeeIdFilter: "alex" },
      index: { generatedAt: "2026-07-06T00:00:00.000Z", employeeCount: 0, sessionCount: 0, sessions: [] },
      selectedSession: null,
      list: { mode: "employee_grouped", sessions: [], queryMatchedSessionCount: 0, employeeFilters: [] },
      sections: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await getSessionExplorerViewModel({
      companyId: "ziho-co",
      employeeId: "alex",
      sessionId: "runtime-session-1",
      query: "launch",
      employeeIdFilter: "alex",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.url,
    "http://127.0.0.1:5175/api/companies/ziho-co/sessions/view-model?employeeId=alex&sessionId=runtime-session-1&q=launch&employeeIdFilter=alex",
  );
  assert.deepEqual(requests[0]?.init, {
    headers: {
      Accept: "application/json",
    },
  });
});
