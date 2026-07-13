import assert from "node:assert/strict";
import test from "node:test";

import {
  getPromptPolicy,
  resetPromptPolicyBlock,
  resetPromptPolicyTemplate,
  savePromptPolicyBlock,
  savePromptPolicyTemplate,
} from "./promptPolicyClient";

function promptPolicyResponse() {
  return {
    contract: { name: "prompt-policy", version: 1, boundary: "scene-runtime-contract" },
    routes: {
      htmlPath: "/config/prompt-policy",
      viewModelJsonPath: "/api/companies/ziho-e-com/prompt-policy",
      saveBlockPath: "/api/companies/ziho-e-com/prompt-policy/blocks/:blockPath",
      resetBlockPath: "/api/companies/ziho-e-com/prompt-policy/blocks/:blockPath/reset",
      saveTemplatePath: "/api/companies/ziho-e-com/prompt-policy/templates/:templateId",
      resetTemplatePath: "/api/companies/ziho-e-com/prompt-policy/templates/:templateId/reset",
    },
    config: {
      version: 1,
      always: [],
      scenes: {
        dm_thread: [],
        channel_thread: [],
        intake_event: [],
        work_run_execution: [],
      },
    },
    templates: [],
    scenes: [],
    availableBlocks: [],
    diagnostics: { errors: [], warnings: [], unmountedBlocks: [] },
  };
}

test("prompt policy client uses company-scoped template and block endpoints", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/prompt") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(promptPolicyResponse()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await getPromptPolicy({ companyId: "ziho-e-com" });
    await savePromptPolicyTemplate({
      companyId: "ziho-e-com",
      templateId: "base-system-prompt",
      content: "Base prompt\n",
    });
    await resetPromptPolicyTemplate({
      companyId: "ziho-e-com",
      templateId: "runtime-prompt-template",
    });
    await savePromptPolicyBlock({
      companyId: "ziho-e-com",
      path: "dm-scene",
      content: "DM prompt\n",
    });
    await resetPromptPolicyBlock({
      companyId: "ziho-e-com",
      path: "workrun-scene",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/prompt-policy");
  assert.deepEqual(requests[0]?.init, { headers: { Accept: "application/json" } });
  assert.equal(requests[1]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/prompt-policy/templates/base-system-prompt");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    companyId: "ziho-e-com",
    templateId: "base-system-prompt",
    content: "Base prompt\n",
  });
  assert.equal(requests[2]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/prompt-policy/templates/runtime-prompt-template/reset");
  assert.equal(requests[2]?.init?.method, "POST");
  assert.equal(requests[3]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/prompt-policy/blocks/dm-scene");
  assert.equal(requests[3]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[3]?.init?.body)), {
    companyId: "ziho-e-com",
    path: "dm-scene",
    content: "DM prompt\n",
  });
  assert.equal(requests[4]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/prompt-policy/blocks/workrun-scene/reset");
  assert.equal(requests[4]?.init?.method, "POST");
});
