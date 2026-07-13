import assert from "node:assert/strict";
import test from "node:test";

import { createCompany, deleteCompany, listCompanies, saveCompanySystemAiSettings } from "./companyClient";

test("listCompanies reads the TinyOffice company lifecycle API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/chat") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      contract: { name: "company-lifecycle", version: 1, boundary: "company-lifecycle" },
      routes: {
        htmlPath: "/company",
        companiesJsonPath: "/api/companies",
        createCompanyPath: "/api/companies",
        deleteCompanyPath: "/api/companies/:companyId",
      },
      companies: [{ companyId: "ziho-co", displayName: "Ziho Co", createdAt: "2026-07-04T00:00:00.000Z", updatedAt: "2026-07-04T00:00:00.000Z" }],
      availableModels: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await listCompanies();
    assert.equal(result.companies[0]?.companyId, "ziho-co");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies");
  assert.deepEqual(requests[0]?.init, {
    headers: {
      Accept: "application/json",
    },
  });
});

test("createCompany posts company, HR, and System AI setup details to the lifecycle API", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/company") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      company: { companyId: "ziho-co", displayName: "Ziho Co", createdAt: "2026-07-04T00:00:00.000Z", updatedAt: "2026-07-04T00:00:00.000Z" },
      owner: { memberId: "xuziho", displayName: "Xuziho", role: "boss" },
      hr: { hrEmployeeId: "employee-hr", hrEmployeeDisplayName: "Mira" },
      viewModel: { companies: [], availableModels: [] },
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };

  try {
    await createCompany({
      displayName: "Ziho Co",
      hrEmployeeDisplayName: "Mira",
      hrRuntime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-codex",
        thinkingLevel: "medium",
      },
      systemAiRuntime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5.5",
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    displayName: "Ziho Co",
    hrEmployeeDisplayName: "Mira",
    hrRuntime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-codex",
      thinkingLevel: "medium",
    },
    systemAiRuntime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5.5",
    },
  });
});

test("deleteCompany sends the required Company delete confirmation without employee identity", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/company") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      companyId: "ziho-co",
      deletedAssetPath: "D:/AI/Codex/Tiny Office/companies/ziho-co",
      viewModel: { companies: [], availableModels: [] },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await deleteCompany({ companyId: "ziho-co", confirmationText: "DELETE" });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co");
  assert.equal(request.init.method, "DELETE");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    companyId: "ziho-co",
    confirmation: { intent: "DELETE" },
  });
});

test("saveCompanySystemAiSettings stores company-level System AI models", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/company") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      companies: [],
      availableModels: [],
      systemAiSettings: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await saveCompanySystemAiSettings({
      companyId: "ziho-co",
      chatTitleGeneration: {
        modelProvider: "openai",
        modelId: "gpt-5-mini",
      },
      chatTopicSummary: {
        modelProvider: "openai",
        modelId: "gpt-5",
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  const request = requests[0];
  assert.ok(request?.init);
  assert.equal(request.url, "http://127.0.0.1:5175/api/companies/ziho-co/system-ai");
  assert.equal(request.init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    chatTitleGeneration: {
      modelProvider: "openai",
      modelId: "gpt-5-mini",
    },
    chatTopicSummary: {
      modelProvider: "openai",
      modelId: "gpt-5",
    },
  });
});
