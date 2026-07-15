import assert from "node:assert/strict";
import test from "node:test";
import {
  aiRuntimeNavigation,
  integrationsNavigation,
  isAiRuntimeView,
  isOperationsView,
  isWorkforceView,
  operationsNavigation,
  organizationNavigation,
  pageSectionForView,
  workforceNavigation,
} from "./navigationStructure";

test("workforce navigation contains only people and company skills", () => {
  assert.deepEqual(workforceNavigation, [
    { view: "employees", labelKey: "nav.employees" },
    { view: "skills", labelKey: "nav.companySkills" },
  ]);
  assert.equal(isWorkforceView("employees"), true);
  assert.equal(isWorkforceView("skills"), true);
  assert.equal(isWorkforceView("company"), false);
});

test("console rail destinations keep standalone and grouped responsibilities explicit", () => {
  assert.deepEqual(organizationNavigation, [{ view: "company", labelKey: "nav.organization" }]);
  assert.deepEqual(integrationsNavigation, [{ view: "integrations", labelKey: "nav.integrations" }]);
  assert.deepEqual(aiRuntimeNavigation.map((item) => item.view), ["system-ai", "prompt", "access", "capabilities"]);
  assert.deepEqual(operationsNavigation.map((item) => item.view), ["sessions", "doctor", "backup", "updates"]);
  assert.equal(isAiRuntimeView("access"), true);
  assert.equal(isAiRuntimeView("sessions"), false);
  assert.equal(isOperationsView("doctor"), true);
  assert.equal(isOperationsView("settings"), false);
});

test("page sections expose sibling navigation without merging product routes", () => {
  assert.deepEqual(pageSectionForView("skills")?.items.map((item) => item.view), ["employees", "skills"]);
  assert.deepEqual(pageSectionForView("access")?.items.map((item) => item.view), ["system-ai", "prompt", "access", "capabilities"]);
  assert.deepEqual(pageSectionForView("updates")?.items.map((item) => item.view), ["sessions", "doctor", "backup", "updates"]);
  assert.equal(pageSectionForView("company"), undefined);
  assert.equal(pageSectionForView("integrations"), undefined);
  assert.equal(pageSectionForView("settings"), undefined);
});
