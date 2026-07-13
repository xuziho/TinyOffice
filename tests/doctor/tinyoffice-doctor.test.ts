import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTinyOfficeDoctorReport,
  renderTinyOfficeDoctorReport,
} from "../../src/runtime/doctor/tinyoffice-doctor.js";

const generatedAt = "2026-07-09T08:00:00.000Z";

test("doctor report rolls section status up and keeps actionable checks", () => {
  const report = buildTinyOfficeDoctorReport({
    companyId: "acme",
    generatedAt,
    sections: [{
      id: "runtime",
      label: "Runtime",
      checks: [{
        id: "runtime.models",
        label: "Runtime models",
        status: "fail",
        summary: "No runtime models are available.",
        action: {
          label: "Configure runtime models",
          href: "/employees",
        },
      }, {
        id: "runtime.employees",
        label: "Runtime employees",
        status: "ok",
        summary: "1 runtime-capable employee.",
      }],
    }, {
      id: "access",
      label: "Access",
      checks: [{
        id: "access.policy",
        label: "Access policy",
        status: "warn",
        summary: "Access policy loaded with pending approval rules.",
      }],
    }],
  });

  assert.equal(report.schema, "tinyoffice-doctor-report");
  assert.equal(report.version, 1);
  assert.equal(report.companyId, "acme");
  assert.equal(report.generatedAt, generatedAt);
  assert.equal(report.overallStatus, "fail");
  assert.equal(report.sections[0]?.status, "fail");
  assert.equal(report.sections[1]?.status, "warn");
  assert.deepEqual(report.nextSteps, [{
    checkId: "runtime.models",
    label: "Configure runtime models",
    href: "/employees",
  }]);
});

test("doctor report renders a compact CLI summary", () => {
  const report = buildTinyOfficeDoctorReport({
    companyId: "acme",
    generatedAt,
    sections: [{
      id: "core",
      label: "Core",
      checks: [{
        id: "core.api",
        label: "Runtime API",
        status: "ok",
        summary: "Runtime API is reachable.",
      }],
    }],
  });

  assert.equal(
    renderTinyOfficeDoctorReport(report),
    [
      "TinyOffice doctor: fail=0 warn=0 ok=1 info=0",
      "Company: acme",
      "",
      "Core [ok]",
      "  [ok] Runtime API - Runtime API is reachable.",
    ].join("\n"),
  );
});
