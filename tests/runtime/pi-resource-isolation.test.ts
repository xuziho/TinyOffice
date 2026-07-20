import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APPROVED_RUNTIME_EXTENSIONS,
  assertApprovedRuntimeExtensions,
  createEmployeeResourceLoader,
  createSystemAiResourceLoader,
} from "../../src/runtime/pi/pi-resource-isolation.js";

async function createPoisonedPiEnvironment() {
  const root = await mkdtemp(path.join(tmpdir(), "tinyoffice-pi-isolation-"));
  const cwd = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  const globalExtensions = path.join(agentDir, "extensions");
  const projectExtensions = path.join(cwd, ".pi", "extensions");
  await mkdir(globalExtensions, { recursive: true });
  await mkdir(projectExtensions, { recursive: true });
  const poisonSource = [
    "export default function poison(pi) {",
    "  pi.registerTool({",
    "    name: 'host_poison',",
    "    label: 'Host poison',",
    "    description: 'Must never enter TinyOffice.',",
    "    parameters: { type: 'object', properties: {} },",
    "    async execute() { return { content: [{ type: 'text', text: 'poison' }] }; },",
    "  });",
    "}",
  ].join("\n");
  await writeFile(path.join(globalExtensions, "global-poison.ts"), poisonSource, "utf8");
  await writeFile(path.join(projectExtensions, "project-poison.ts"), poisonSource, "utf8");
  return { cwd, agentDir };
}

test("employee PI resources ignore host extensions and load only approved TinyOffice factories", async () => {
  const { cwd, agentDir } = await createPoisonedPiEnvironment();
  const repoRoot = path.resolve(".");
  const loader = createEmployeeResourceLoader({
    cwd,
    agentDir,
    repoRoot,
    skillPaths: [],
    systemPrompt: "employee-system-prompt",
    appendSystemPrompt: ["company-scene"],
  });

  await loader.reload();
  const extensions = loader.getExtensions();
  assertApprovedRuntimeExtensions(extensions, repoRoot);
  assert.deepEqual(
    extensions.extensions.map((extension) => extension.resolvedPath).sort(),
    APPROVED_RUNTIME_EXTENSIONS.map((extension) => extension.relativePath
      ? path.resolve(repoRoot, extension.relativePath)
      : `<inline:${extension.id}>`).sort(),
  );
  assert.equal(
    extensions.extensions.some((extension) => extension.tools.has("host_poison")),
    false,
  );
  assert.equal(loader.getSystemPrompt(), "employee-system-prompt");
  assert.deepEqual(loader.getAppendSystemPrompt(), ["company-scene"]);
  assert.deepEqual(loader.getPrompts().prompts, []);
  assert.deepEqual(loader.getThemes().themes, []);
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
});

test("System AI PI resources are isolated from every host and employee resource", async () => {
  const { cwd, agentDir } = await createPoisonedPiEnvironment();
  const loader = createSystemAiResourceLoader({
    cwd,
    agentDir,
    systemPrompt: "system-ai-only",
  });

  await loader.reload();
  assert.deepEqual(loader.getExtensions().extensions, []);
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.deepEqual(loader.getSkills().skills, []);
  assert.deepEqual(loader.getPrompts().prompts, []);
  assert.deepEqual(loader.getThemes().themes, []);
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
  assert.equal(loader.getSystemPrompt(), "system-ai-only");
  assert.deepEqual(loader.getAppendSystemPrompt(), []);
});
