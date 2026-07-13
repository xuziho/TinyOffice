import assert from "node:assert/strict";
import test from "node:test";
import { reconcileAccessPolicyEditor } from "./AccessPage";

test("initializes the Access editor from the first server policy", () => {
  assert.deepEqual(reconcileAccessPolicyEditor(undefined, "company-a", "{\"version\":1}"), {
    companyId: "company-a",
    serverJson: "{\"version\":1}",
    draftJson: "{\"version\":1}",
  });
});

test("updates a clean Access editor when the server policy refreshes", () => {
  const current = reconcileAccessPolicyEditor(undefined, "company-a", "old");
  assert.deepEqual(reconcileAccessPolicyEditor(current, "company-a", "new"), {
    companyId: "company-a",
    serverJson: "new",
    draftJson: "new",
  });
});

test("preserves a user edit when the server policy refreshes", () => {
  const current = { companyId: "company-a", serverJson: "old", draftJson: "user edit" };
  assert.deepEqual(reconcileAccessPolicyEditor(current, "company-a", "new"), {
    companyId: "company-a",
    serverJson: "new",
    draftJson: "user edit",
  });
});

test("initializes from the new Company when Company context changes", () => {
  const current = { companyId: "company-a", serverJson: "old", draftJson: "user edit" };
  assert.deepEqual(reconcileAccessPolicyEditor(current, "company-b", "company b policy"), {
    companyId: "company-b",
    serverJson: "company b policy",
    draftJson: "company b policy",
  });
});
