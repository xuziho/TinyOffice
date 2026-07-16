import assert from "node:assert/strict";
import test from "node:test";

import { getUpdateStatus, installApprovedUpdate } from "./updateClient";

test("update client checks status and starts only the controlled update endpoint", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  globalThis.window = { location: new URL("http://127.0.0.1:5175/settings") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(init?.method === "POST" ? {
      schema: "tinyoffice-update-job",
      version: 2,
      jobId: "update-1",
      targetReleaseId: "0.1.1-aaaaaaaaaaaa",
      status: "accepted",
      startedAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    } : {
      schema: "tinyoffice-update-status",
      version: 2,
      pi: { installedVersion: "0.80.6" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    assert.equal((await getUpdateStatus()).pi.installedVersion, "0.80.6");
    assert.equal((await installApprovedUpdate()).targetReleaseId, "0.1.1-aaaaaaaaaaaa");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/tinyoffice/updates");
  assert.equal(requests[1]?.url, "http://127.0.0.1:5175/api/tinyoffice/updates");
  assert.equal(requests[1]?.init?.method, "POST");
});
