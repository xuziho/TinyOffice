import assert from "node:assert/strict";
import test from "node:test";

import {
  getAccessPolicy,
  getAccessRequests,
  previewAccessDecision,
  resolveAccessRequest,
  saveAccessPolicy,
} from "./accessClient";
import type { ToolGuardPolicy } from "tinyoffice/frontend-api-contracts";

const policy: ToolGuardPolicy = {
  version: 1,
  cwdBoundaryReadMode: "allow",
  cwdBoundaryWriteMode: "ask",
  sensitivePathPatterns: [".env"],
  blockedReadPathPatterns: [],
  protectedWritePathPatterns: [".env"],
  askReadPathPatterns: [],
  askWritePathPatterns: ["src/runtime/**"],
  externalWriteAllowPaths: [],
  bashDenyPatterns: ["rm *-rf*"],
  bashAskPatterns: ["npm install *"],
  bashAllowPatterns: ["rg *"],
  denyBashByDefault: false,
};

function accessResponse() {
  return {
    contract: { name: "access", version: 1, boundary: "runtime-access-policy" },
    routes: {
      htmlPath: "/config/access",
      viewModelJsonPath: "/api/companies/ziho-e-com/access",
      savePolicyPath: "/api/companies/ziho-e-com/access",
      previewPath: "/api/companies/ziho-e-com/access/preview",
    },
    policy,
    policyPath: "PostgreSQL:tool_safety_policies/default",
    capabilityGroups: [],
    previewExamples: [],
    advancedEditor: {
      policyJson: JSON.stringify(policy, null, 2),
    },
  };
}

test("access client uses company-scoped policy and preview endpoints", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/access") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(accessResponse()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await getAccessPolicy({ companyId: "ziho-e-com" });
    await saveAccessPolicy({ companyId: "ziho-e-com", policy });
    await previewAccessDecision({
      companyId: "ziho-e-com",
      policy,
      operation: "write",
      targetPath: ".env",
      cwd: "D:/workspace",
    });
    await getAccessRequests({ companyId: "ziho-e-com" });
    await resolveAccessRequest({
      companyId: "ziho-e-com",
      approvalId: "approval-1",
      decision: "allow_in_context",
      note: "Only for this connector setup.",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/access");
  assert.deepEqual(requests[0]?.init, { headers: { Accept: "application/json" } });
  assert.equal(requests[1]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/access");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    companyId: "ziho-e-com",
    policy,
  });
  assert.equal(requests[2]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/access/preview");
  assert.equal(requests[2]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), {
    companyId: "ziho-e-com",
    policy,
    operation: "write",
    targetPath: ".env",
    cwd: "D:/workspace",
  });
  assert.equal(requests[3]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/access/requests");
  assert.deepEqual(requests[3]?.init, { headers: { Accept: "application/json" } });
  assert.equal(requests[4]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/access/requests/approval-1/resolve");
  assert.equal(requests[4]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[4]?.init?.body)), {
    companyId: "ziho-e-com",
    decision: "allow_in_context",
    note: "Only for this connector setup.",
  });
});
