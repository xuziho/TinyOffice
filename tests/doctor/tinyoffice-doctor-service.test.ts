import assert from "node:assert/strict";
import test from "node:test";

import { createTinyOfficeDoctorService } from "../../src/runtime/doctor/tinyoffice-doctor-service.js";

test("doctor service reports system configuration and excludes business work outcomes", async () => {
  const service = createTinyOfficeDoctorService({
    now: () => "2026-07-09T08:00:00.000Z",
    async loadCompanies() {
      return {
        contract: { name: "companies-admin", version: 1 },
        companies: [{
          companyId: "acme",
          displayName: "Acme",
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z",
        }],
        availableModels: [],
        systemAiSettings: [],
      } as never;
    },
    async loadMemberRuntime() {
      return {
        employees: [{
          employeeId: "avery",
          enabled: true,
          profile: {
            employeeId: "avery",
            displayName: "Avery",
            role: "automation",
            presenceMode: "resident",
          },
          resourcePolicy: {
            version: 1,
            filesystem: {
              ownWorkspace: "allow",
              otherEmployeeWorkspace: "approval",
              repo: "approval",
              secrets: "approval",
            },
          },
          runtime: {
            version: 1,
            modelProvider: "openai",
            modelId: "gpt-test",
            thinkingLevel: "medium",
          },
          localAssets: {
            homePath: "/companies/acme/employees/avery",
            workspacePath: "/companies/acme/employees/avery/workspace",
            skillPaths: [],
            instructionFiles: [{
              location: "employee_home",
              name: "AGENTS.md",
              path: "/companies/acme/employees/avery/AGENTS.md",
              relativePath: "AGENTS.md",
              exists: true,
              content: "You are Avery.",
              editable: true,
            }],
          },
        }],
        availableModels: [],
        presenceModes: ["resident", "auto_exit_idle"],
        thinkingLevels: ["medium"],
      } as never;
    },
    async loadRuntimeModels() {
      return {
        schema: "tinyoffice-runtime-models",
        version: 1,
        availableModels: [{
          provider: "openai",
          id: "gpt-test",
          name: "GPT Test",
        }],
        thinkingLevels: ["medium"],
      } as never;
    },
    async loadAccess() {
      return {
        contract: { name: "access", version: 1, boundary: "runtime-access-policy" },
        policy: { version: 1 },
      } as never;
    },
  });

  const report = await service.loadDoctorReport("acme");
  assert.equal(report.overallStatus, "ok");
  assert.deepEqual(report.sections.map((section) => section.id), ["company", "employees", "runtime", "access"]);
  assert.equal(report.sections.some((section) => section.id === "work"), false);
  assert.equal(report.nextSteps.length, 0);
});

test("doctor service reports the same runtime compatibility and approval-source degradation as Updates", async () => {
  const service = createTinyOfficeDoctorService({
    async loadUpdateStatus() {
      return {
        schema: "tinyoffice-update-status",
        version: 1,
        checkedAt: "2026-07-13T00:00:00.000Z",
        channel: "stable",
        tinyOfficeVersion: "0.1.0",
        runtime: { nodeVersion: "22.14.0", minimumNodeVersion: "22.19.0", compatible: false },
        pi: {
          packageName: "@earendil-works/pi-coding-agent",
          installedVersion: "0.80.6",
          npmLatestVersion: "0.80.6",
          approvedVersion: "0.80.6",
          state: "check_failed",
          installedModels: [], approvedModels: [], addedModels: [], removedModels: [],
        },
        installation: { enabled: false, reason: "Update sources could not be checked.", requiresBackup: true, requiresRestart: true },
        sources: {
          npmRegistry: "https://registry.npmjs.org",
          approvalManifest: "https://updates.invalid/stable.json",
          approvalManifestSource: "local",
          warnings: ["Approval manifest could not be refreshed: 404 Not Found"],
        },
      };
    },
  });

  const report = await service.loadDoctorReport("acme");
  const runtime = report.sections.find((section) => section.id === "runtime");
  assert.equal(report.overallStatus, "fail");
  assert.equal(runtime?.checks.find((check) => check.id === "runtime.node")?.status, "warn");
  assert.equal(runtime?.checks.find((check) => check.id === "runtime.update-approval")?.status, "warn");
});
