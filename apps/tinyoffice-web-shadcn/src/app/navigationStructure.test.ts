import assert from "node:assert/strict";
import test from "node:test";
import {
  adminNavigation,
  isAdminView,
  isWorkforceView,
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
    { label: "Company", views: ["company", "integrations"] },
    { label: "AI & Runtime", views: ["system-ai", "prompt", "access", "capabilities"] },
    { label: "System", views: ["sessions", "doctor", "backup"] },
  ]);
  assert.equal(isAdminView("sessions"), true);
  assert.equal(isAdminView("doctor"), true);
  assert.equal(isAdminView("chat"), false);
  assert.equal(isAdminView("settings"), false);
});
