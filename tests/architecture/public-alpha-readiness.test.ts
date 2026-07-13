import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public Alpha setup installs both runtime and standalone frontend dependencies", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    version?: string;
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.version, "0.1.0-alpha.1");
  assert.match(packageJson.scripts?.setup ?? "", /npm ci/);
  assert.match(packageJson.scripts?.setup ?? "", /--prefix apps\/tinyoffice-web-shadcn/);
  assert.match(packageJson.scripts?.["setup:ci"] ?? "", /--ignore-scripts/);
});

test("public Alpha documentation describes the canonical public repository and supported setup", async () => {
  const [readme, distribution, readiness] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("docs/product/open-source-distribution.md", "utf8"),
    readFile("docs/status/public-release-code-readiness.md", "utf8"),
  ]);

  assert.match(readme, /npm run setup/);
  assert.match(readme, /Node\.js 22\.19 or newer/);
  assert.match(readme, /canonical public TinyOffice repository/);
  assert.doesNotMatch(readme, /Until that transition is complete/);
  assert.match(distribution, /github\.com\/xuziho\/TinyOffice/);
  assert.match(readiness, /clean-install acceptance/);
});
