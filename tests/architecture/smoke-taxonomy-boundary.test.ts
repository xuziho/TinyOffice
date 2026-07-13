import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

async function readText(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

test("product smoke scripts default to TinyOffice-owned no-carrier and standalone frontend paths", async () => {
  const packageJson = JSON.parse(await readText("package.json")) as { scripts: Record<string, string> };
  const scriptNames = Object.keys(packageJson.scripts);

  assert.match(packageJson.scripts["smoke:no-carrier-chat"], /smoke-no-carrier-chat\.ts/);
  assert.match(
    packageJson.scripts["smoke:standalone-frontend-browser"],
    /run-smoke-standalone-frontend-browser\.ts/,
  );

  for (const forbiddenName of [
    "dogfood:update-mattermost-plugin",
    "smoke:capability-approval-flow",
    "run:realtime-intake",
    "run:stage5:realtime-intake",
    "build:mattermost-webapp",
    "build:mattermost-server",
    "build:mattermost-plugin",
    "package:mattermost-plugin",
    "verify:mattermost-plugin-package",
    "install:mattermost-plugin",
    "validate:mattermost-plugin",
    "test:mattermost-server",
  ]) {
    assert.equal(packageJson.scripts[forbiddenName], undefined, `${forbiddenName} must not be a product script`);
  }

  assert.deepEqual(scriptNames.filter((name) => name.includes("mattermost")), []);
});

test("runbooks point product smoke at TinyOffice-owned runtime and keep old carrier as external reference only", async () => {
  const mainSmoke = await readText("docs/developer/runbooks/main-smoke.md");
  const dashboard = await readText("docs/status/dashboard.md");
  const externalReference = await readText("docs/product/external-mattermost-reference.md");
  const combined = `${mainSmoke}\n${dashboard}\n${externalReference}`;

  assert.match(mainSmoke, /Default TinyOffice product smoke uses the TinyOffice-owned no-carrier Chat path/);
  assert.match(mainSmoke, /smoke:no-carrier-chat/);
  assert.match(mainSmoke, /smoke:standalone-frontend-browser/);
  assert.match(dashboard, /TinyOffice-owned Chat\/Message/);
  assert.match(externalReference, /separately checked-out Mattermost fork is an external historical reference only/);
  assert.match(externalReference, /filesystem location is operator-specific and is not part of the TinyOffice repository contract/);
  assert.doesNotMatch(externalReference, /[A-Z]:\\\\/);
  assert.match(externalReference, /Do not import Mattermost Team\/User\/Channel\/Post APIs/);
  assert.doesNotMatch(combined, /adapter:mattermost:/);
});
