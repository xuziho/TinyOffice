import assert from "node:assert/strict";
import test from "node:test";

import { getDoctorReport } from "./doctorClient";

test("doctor client reads the company-scoped doctor endpoint", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/doctor") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "tinyoffice-doctor-report",
      version: 1,
      companyId: "ziho-e-com",
      generatedAt: "2026-07-09T00:00:00.000Z",
      overallStatus: "ok",
      counts: { fail: 0, warn: 0, ok: 1, info: 0 },
      sections: [],
      nextSteps: [],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const report = await getDoctorReport({ companyId: "ziho-e-com" });
    assert.equal(report.companyId, "ziho-e-com");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/doctor");
  assert.deepEqual(requests[0]?.init, { headers: { Accept: "application/json" } });
});
