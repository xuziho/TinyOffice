import assert from "node:assert/strict";
import test from "node:test";
import {
  adminNavigation,
  isAdminView,
  isWorkforceView,
  pageSectionForView,
  workforceNavigation,
} from "./navigationStructure";

test("workforce navigation contains only people and company skills", () => {
  assert.deepEqual(workforceNavigation, [
    { view: "employees", label: "Employees" },
    { view: "skills", label: "Company Skills" },
  ]);
  assert.equal(isWorkforceView("employees"), true);
  assert.equal(isWorkforceView("skills"), true);
  assert.equal(isWorkforceView("company"), false);
});

test("admin navigation groups existing routes by product responsibility", () => {
  assert.deepEqual(adminNavigation.map((group) => ({
    label: group.label,
    views: group.items.map((item) => item.view),
  })), [
    { label: "Organization", views: ["company"] },
    { label: "Automation", views: ["integrations"] },
    { label: "AI & Runtime", views: ["system-ai", "prompt", "access", "capabilities"] },
    { label: "Operations", views: ["sessions", "doctor", "backup", "updates"] },
  ]);
  assert.equal(isAdminView("sessions"), true);
  assert.equal(isAdminView("doctor"), true);
  assert.equal(isAdminView("chat"), false);
  assert.equal(isAdminView("settings"), false);
});

test("page sections expose sibling navigation without merging product routes", () => {
  assert.deepEqual(pageSectionForView("skills")?.items.map((item) => item.view), ["employees", "skills"]);
  assert.deepEqual(pageSectionForView("access")?.items.map((item) => item.view), ["system-ai", "prompt", "access", "capabilities"]);
  assert.deepEqual(pageSectionForView("updates")?.items.map((item) => item.view), ["sessions", "doctor", "backup", "updates"]);
  assert.equal(pageSectionForView("company"), undefined);
  assert.equal(pageSectionForView("integrations"), undefined);
  assert.equal(pageSectionForView("settings"), undefined);
});
