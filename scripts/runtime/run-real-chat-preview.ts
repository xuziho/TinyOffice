import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

import { createTinyOfficeChatPreviewServer } from "../../src/runtime/realtime/tinyoffice-chat-preview-server.js";
import { defaultRuntimeProvider } from "../../src/runtime/provider/pi-runtime-provider.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const runtimePort = Number(process.env.TINYOFFICE_RUNTIME_PREVIEW_PORT || "8095");
const webPort = Number(process.env.TINYOFFICE_WEB_PREVIEW_PORT || "5175");
const companyId = process.env.TINYOFFICE_PREVIEW_COMPANY_ID?.trim() || undefined;
const previewUserId = requiredEnv("TINYOFFICE_PREVIEW_USER_ID");
const previewUserDisplayName = process.env.TINYOFFICE_PREVIEW_USER_DISPLAY_NAME?.trim() || undefined;
const defaultDatabaseUrl = "postgresql://tinyoffice:tinyoffice_dev@127.0.0.1:55432/tinyoffice?sslmode=disable";

process.env.TINYOFFICE_DATABASE_URL = process.env.TINYOFFICE_DATABASE_URL?.trim() || defaultDatabaseUrl;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for real TinyOffice preview startup.`);
  }
  return value;
}

function previewUrl(): string {
  return `http://127.0.0.1:${webPort}/`;
}

function spawnWeb(): ChildProcess {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(executable, ["run", "dev", "--prefix", "apps/tinyoffice-web-shadcn", "--", "--port", String(webPort), "--strictPort"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      TINYOFFICE_RUNTIME_ORIGIN: `http://127.0.0.1:${runtimePort}`,
    },
  });
}

const preview = await createTinyOfficeChatPreviewServer({
  repoRoot,
  previewUserId,
  runtimeProvider: defaultRuntimeProvider,
  ...(companyId ? { companyId } : {}),
  ...(previewUserDisplayName ? { previewUserDisplayName } : {}),
});

preview.server.listen(runtimePort, "127.0.0.1");
await once(preview.server, "listening");

console.log(`TinyOffice Chat runtime preview API: http://127.0.0.1:${runtimePort}`);
console.log(`Company: ${preview.companyId ?? "not selected"}`);
console.log(`Preview user: ${preview.previewUserId}`);
console.log("Preview data seed: disabled");
console.log(`Open: ${previewUrl()}`);

const web = spawnWeb();

function shutdown(): void {
  web.kill();
  preview.server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
web.on("exit", (code) => {
  preview.server.close(() => process.exit(code ?? 0));
});
