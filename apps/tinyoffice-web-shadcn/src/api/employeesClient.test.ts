import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmployee,
  getEmployeePrivateSkill,
  getEmployeePrivateSkills,
  getEmployees,
  reloadAllEmployees,
  reloadEmployee,
  reloadEmployeeRuntimeIfAvailable,
  saveEmployee,
  saveEmployeePrivateSkill,
} from "./employeesClient";

const employee = {
  employeeId: "avery",
  enabled: true,
  profile: {
    employeeId: "avery",
    avatarSeed: "avery",
    displayName: "Avery",
    role: "automation",
    presenceMode: "resident" as const,
  },
  resourcePolicy: {
    version: 1 as const,
    filesystem: {
      ownWorkspace: "allow" as const,
      otherEmployeeWorkspace: "approval" as const,
      repo: "approval" as const,
      secrets: "deny" as const,
    },
  },
  runtime: {
    version: 1 as const,
    modelProvider: "openai-codex",
    modelId: "gpt-5.5",
    thinkingLevel: "medium" as const,
  },
  localAssets: {
    homePath: "/companies/ziho-e-com/employees/avery",
    workspacePath: "/companies/ziho-e-com/employees/avery/workspace",
    skillPaths: [],
    instructionFiles: [{
      location: "employee_home" as const,
      name: "AGENTS.md",
      path: "/companies/ziho-e-com/employees/avery/AGENTS.md",
      relativePath: "AGENTS.md",
      exists: true,
      content: "You are Avery.\n",
      editable: true,
    }],
  },
};

test("employees client uses company-scoped member runtime endpoints", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/employees") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      employees: [employee],
      availableModels: [],
      presenceModes: ["resident", "auto_exit_idle"],
      thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await getEmployees({ companyId: "ziho-e-com" });
    await saveEmployee({ companyId: "ziho-e-com", employee });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/member-runtime");
  assert.deepEqual(requests[0]?.init, { headers: { Accept: "application/json" } });
  assert.equal(requests[1]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/member-runtime/members/avery");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    companyId: "ziho-e-com",
    memberId: "avery",
    profile: employee.profile,
    resourcePolicy: employee.resourcePolicy,
    runtime: employee.runtime,
    instructionFiles: [{
      path: "/companies/ziho-e-com/employees/avery/AGENTS.md",
      content: "You are Avery.\n",
    }],
  });
});

test("employees client posts create and reload actions", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/employees") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ reloadedCount: 1, sessionKeys: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await createEmployee({
      companyId: "ziho-e-com",
      displayName: "Avery",
      role: "automation",
      summary: "Automates weekly operations.",
      runtime: employee.runtime,
      instructionContent: "You are Avery.\n",
    });
    await reloadEmployee({ companyId: "ziho-e-com", memberId: "avery" });
    await reloadAllEmployees({ companyId: "ziho-e-com" });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/employees");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    companyId: "ziho-e-com",
    displayName: "Avery",
    role: "automation",
    summary: "Automates weekly operations.",
    runtime: employee.runtime,
    instructionContent: "You are Avery.\n",
  });
  assert.equal(requests[1]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/member-runtime/members/avery/reload");
  assert.equal(requests[1]?.init?.method, "POST");
  assert.equal(requests[2]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/member-runtime/reload");
  assert.equal(requests[2]?.init?.method, "POST");
});

test("employees client manages existing employee-private skill files", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/employees") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      schema: "employee-private-skill",
      version: 1,
      companyId: "ziho-e-com",
      memberId: "avery",
      skillId: "weekly-audit",
      name: "weekly-audit",
      path: "/companies/ziho-e-com/employees/avery/skills/weekly-audit/SKILL.md",
      relativePath: "weekly-audit/SKILL.md",
      exists: true,
      content: "Audit weekly work.\n",
      editable: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    await getEmployeePrivateSkills({ companyId: "ziho-e-com", memberId: "avery" });
    await getEmployeePrivateSkill({ companyId: "ziho-e-com", memberId: "avery", skillId: "weekly-audit" });
    await saveEmployeePrivateSkill({
      companyId: "ziho-e-com",
      memberId: "avery",
      skillId: "weekly-audit",
      content: "Audit weekly work.\n",
    });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/member-runtime/members/avery/skills");
  assert.equal(requests[1]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/member-runtime/members/avery/skills/weekly-audit");
  assert.equal(requests[2]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/member-runtime/members/avery/skills/weekly-audit");
  assert.equal(requests[2]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), {
    companyId: "ziho-e-com",
    memberId: "avery",
    skillId: "weekly-audit",
    content: "Audit weekly work.\n",
  });
});

test("employees client treats unavailable runtime reload as an optional post-save effect", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;

  globalThis.window = { location: new URL("http://127.0.0.1:5175/employees") } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ message: "member runtime reload is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await reloadEmployeeRuntimeIfAvailable({ companyId: "ziho-e-com", memberId: "avery" });
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }

  assert.equal(requests[0]?.url, "http://127.0.0.1:5175/api/companies/ziho-e-com/member-runtime/members/avery/reload");
  assert.equal(requests[0]?.init?.method, "POST");
});
