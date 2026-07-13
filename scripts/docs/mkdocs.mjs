import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mode = process.argv[2] || "serve";
const venvDir = path.join(repoRoot, ".scratch", "docs-venv");
const isWindows = process.platform === "win32";
const bootstrapPython = process.env.PYTHON || (isWindows ? "python" : "python3");
const pythonExe = path.join(
  venvDir,
  isWindows ? "Scripts" : "bin",
  isWindows ? "python.exe" : "python",
);
const requirementsPath = path.join(repoRoot, "docs", "requirements.txt");
const siteDir = path.join(repoRoot, ".scratch", "docs-site");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function ensureMkDocs() {
  await mkdir(path.join(repoRoot, ".scratch"), { recursive: true });
  if (!existsSync(pythonExe)) {
    run(bootstrapPython, ["-m", "venv", venvDir]);
  }
  run(pythonExe, ["-m", "pip", "install", "-r", requirementsPath]);
}

await ensureMkDocs();

if (mode === "serve") {
  run(pythonExe, ["-m", "mkdocs", "serve", "--dev-addr", "127.0.0.1:8001"]);
} else if (mode === "build" || mode === "sync") {
  run(pythonExe, ["-m", "mkdocs", "build", "--strict", "--site-dir", siteDir]);
} else {
  console.error(`Unknown docs mode: ${mode}`);
  console.error("Use one of: serve, build, sync");
  process.exit(1);
}
