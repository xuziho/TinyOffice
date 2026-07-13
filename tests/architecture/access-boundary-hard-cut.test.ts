import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("Access does not keep retired broad permission engines", async () => {
  const retiredFiles = [
    "src/governance/permission-engine.ts",
    "src/governance/capability-gate.ts",
    "src/governance/capability-types.ts",
    "src/security/tool-safety.ts",
  ];

  for (const file of retiredFiles) {
    assert.equal(existsSync(path.join(repoRoot, file)), false, `${file} should be hard-deleted`);
  }

  const governanceIndex = await readFile(path.join(repoRoot, "src/governance/index.ts"), "utf8");
  assert.doesNotMatch(governanceIndex, /permission-engine|capability-gate|capability-types/);

  const accessTechnicalDoc = await readFile(path.join(repoRoot, "docs/technical/tool-safety.md"), "utf8");
  assert.doesNotMatch(accessTechnicalDoc, /capability-gate|business action permission/i);
});

test("employee resource policy stays filesystem-only", async () => {
  const resourcePolicySource = await readFile(path.join(repoRoot, "src/runtime/company-config/resource-policy.ts"), "utf8");
  assert.doesNotMatch(resourcePolicySource, /credentials|sideEffects/);
});

test("pi tool guard reuses the TinyOffice Access policy contract", async () => {
  const guardSource = await readFile(path.join(repoRoot, "packages/pi-tool-guard/src/index.ts"), "utf8");

  assert.match(guardSource, /from "\.\.\/\.\.\/\.\.\/src\/runtime\/company-config\/access-policy\.js"/);
  assert.doesNotMatch(guardSource, /export interface ToolGuardPolicy/);
  assert.doesNotMatch(guardSource, /export const defaultToolGuardPolicy/);
});
