import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import {
  handleCompanyDirectoryApiRequest,
  projectCompanyDirectoryMembers,
  type CompanyDirectoryApiSource,
  type CompanyDirectoryDto,
} from "../../src/collaboration/api/company-directory-api-routes.js";

class FakeCompanyDirectoryApiSource implements CompanyDirectoryApiSource {
  readonly calls: string[] = [];

  async loadCompanyDirectory(companyId: string): Promise<CompanyDirectoryDto> {
    this.calls.push(companyId);
    return {
      schema: "company-directory",
      version: 1,
      companyId,
      directoryMembers: [
        {
          schema: "company-directory-member-entry",
          version: 1,
          companyId,
          memberId: "xuziho",
          selector: { kind: "member", memberId: "xuziho" },
          displayName: "Xu Ziho",
          role: "boss",
          summary: "Human company owner.",
          hasRuntimeProfile: false,
        },
        {
          schema: "company-directory-member-entry",
          version: 1,
          companyId,
          memberId: "nora-automation",
          selector: { kind: "member", memberId: "nora-automation" },
          displayName: "Nora Automation",
          role: "automation",
          summary: "Runtime capability: resident",
          hasRuntimeProfile: true,
          runtimeCapability: {
            presenceMode: "resident",
            model: {
              thinkingLevel: "minimal",
            },
          },
        },
      ],
    };
  }
}

async function withServer(run: (baseUrl: string, source: FakeCompanyDirectoryApiSource) => Promise<void>): Promise<void> {
  const source = new FakeCompanyDirectoryApiSource();
  const server = http.createServer(async (req, res) => {
    const handled = await handleCompanyDirectoryApiRequest(req, res, { directorySource: source });
    if (!handled) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`, source);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("company directory API exposes only the member-first directory product DTO", async () => {
  await withServer(async (baseUrl, source) => {
    const response = await fetch(`${baseUrl}/api/companies/tinyoffice/directory`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    const directory = await response.json() as CompanyDirectoryDto;
    assert.equal(directory.schema, "company-directory");
    assert.equal(directory.companyId, "tinyoffice");
    assert.deepEqual(directory.directoryMembers.map((member) => [
      member.memberId,
      member.selector.kind,
      member.displayName,
      member.role,
      member.hasRuntimeProfile,
    ]), [
      ["xuziho", "member", "Xu Ziho", "boss", false],
      ["nora-automation", "member", "Nora Automation", "automation", true],
    ]);
    assert.equal(directory.directoryMembers[0]?.employeeId, undefined);
    assert.equal(directory.directoryMembers[1]?.employeeId, undefined);
    assert.equal(directory.directoryMembers[1]?.runtimeCapability?.presenceMode, "resident");
    assert.equal(Object.hasOwn(directory, "members"), false);
    assert.equal(Object.hasOwn(directory, "employees"), false);
    assert.doesNotMatch(JSON.stringify(directory), /mattermost|teamId|channelId|postId|userId|actorEmployeeId/i);
    assert.deepEqual(source.calls, ["tinyoffice"]);
  });
});

test("company directory API requires explicit company context", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/companies/%20/directory`);

    assert.equal(response.status, 400);
    assert.match(await response.text(), /explicit companyId is required/);
  });
});

test("company directory projection creates one member-first directory from members and runtime selectors", () => {
  const directoryMembers = projectCompanyDirectoryMembers(
    "tinyoffice",
    [{
      id: "xuziho",
      displayName: "Xu Ziho",
      role: "boss",
      summary: "Company owner.",
      isDefaultRequester: true,
      isFinalReportTarget: true,
      isApprovalAuthority: true,
      hasRuntimeProfile: false,
    }, {
      id: "nora-automation",
      displayName: "Nora Automation",
      role: "automation",
      summary: "Owns recurring office automation.",
      isEmployee: true,
      employeeId: "nora-automation",
      hasRuntimeProfile: true,
    }, {
      id: "inactive-analyst",
      displayName: "Inactive Analyst",
      role: "analytics",
      summary: "Preserved inactive runtime identity.",
      isEmployee: true,
      employeeId: "inactive-analyst",
      hasRuntimeProfile: true,
    }],
    [{
      employeeId: "nora-automation",
      enabled: true,
      profile: {
        employeeId: "nora-automation",
        displayName: "Nora Automation",
        role: "automation",
        presenceMode: "resident",
      },
      resourcePolicy: {
        version: 1,
        resources: [],
      },
      runtime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-mini",
        thinkingLevel: "minimal",
      },
    }, {
      employeeId: "inactive-analyst",
      enabled: false,
      profile: {
        employeeId: "inactive-analyst",
        displayName: "Inactive Analyst",
        role: "analytics",
        presenceMode: "resident",
      },
      resourcePolicy: {
        version: 1,
        resources: [],
      },
      runtime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-mini",
        thinkingLevel: "minimal",
      },
    }, {
      employeeId: "orphan-loader-runtime",
      enabled: true,
      profile: {
        employeeId: "orphan-loader-runtime",
        displayName: "Loader Runtime",
        role: "automation",
        presenceMode: "resident",
      },
      resourcePolicy: {
        version: 1,
        resources: [],
      },
      runtime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-mini",
        thinkingLevel: "minimal",
      },
    }],
    {
      availableModels: [{
        provider: "openai",
        id: "gpt-5-mini",
        name: "GPT-5 Mini",
        reasoning: true,
        input: ["text", "image"],
        supportsImageInput: true,
      }],
    },
  );

  assert.deepEqual(directoryMembers.map((member) => [
    member.memberId,
    member.selector.kind,
    member.employeeId,
    member.displayName,
    member.role,
    member.hasRuntimeProfile,
  ]), [
    ["xuziho", "member", undefined, "Xu Ziho", "boss", false],
    ["nora-automation", "member", undefined, "Nora Automation", "automation", true],
  ]);
  assert.deepEqual(directoryMembers[1]?.runtimeCapability, {
    presenceMode: "resident",
    model: {
      provider: "openai",
      id: "gpt-5-mini",
      thinkingLevel: "minimal",
      input: ["text", "image"],
      supportsImageInput: true,
    },
  });
  assert.equal(directoryMembers.some((member) => member.memberId === "orphan-loader-runtime"), false);
  assert.equal(directoryMembers.some((member) => member.memberId === "inactive-analyst"), false);
  assert.equal(directoryMembers.some((member) => /AI Employee|Company Member/.test(member.displayName ?? "")), false);
});
