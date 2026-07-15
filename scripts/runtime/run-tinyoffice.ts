import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

import { createTinyOfficeServer } from "../../src/runtime/realtime/tinyoffice-server.js";
import { defaultRuntimeProvider } from "../../src/runtime/provider/pi-runtime-provider.js";
import { createRuntimeShutdownCoordinator } from "./runtime-shutdown-coordinator.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimePort = Number(process.env.TINYOFFICE_RUNTIME_PORT || "8095");
const webPort = Number(process.env.TINYOFFICE_WEB_PORT || "5175");
const companyId = process.env.TINYOFFICE_COMPANY_ID?.trim() || undefined;
const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim()
  || "postgresql://tinyoffice:tinyoffice_dev@127.0.0.1:55432/tinyoffice?sslmode=disable";
const publicOrigin = process.env.TINYOFFICE_PUBLIC_ORIGIN?.trim() || `http://localhost:${webPort}`;

process.env.TINYOFFICE_DATABASE_URL = databaseUrl;

function spawnWeb(): ChildProcess {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(executable, ["run", "dev", "--prefix", "apps/tinyoffice-web-shadcn", "--", "--host", "localhost", "--port", String(webPort), "--strictPort"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      TINYOFFICE_RUNTIME_ORIGIN: `http://127.0.0.1:${runtimePort}`,
    },
  });
}

const runtime = await createTinyOfficeServer({
  repoRoot,
  databaseUrl,
  publicOrigin,
  ...(process.env.TINYOFFICE_AUTH_SECRET?.trim() ? { authSecret: process.env.TINYOFFICE_AUTH_SECRET.trim() } : {}),
  runtimeProvider: defaultRuntimeProvider,
  ...(companyId ? { companyId } : {}),
});

runtime.server.listen(runtimePort, "127.0.0.1");
await once(runtime.server, "listening");

console.log(`TinyOffice runtime API: http://127.0.0.1:${runtimePort}`);
console.log(`Company worker scope: ${runtime.companyId ?? "selected by Owner session"}`);
if (runtime.bootstrapToken) {
  console.log("\nTinyOffice needs its first Owner passkey.");
  console.log(`Open once: ${publicOrigin}/?bootstrap=${encodeURIComponent(runtime.bootstrapToken)}\n`);
} else if (runtime.localAccessTicket) {
  console.log("\nTinyOffice local Owner access is ready.");
  console.log(`Open once: ${publicOrigin}/?localAccess=${encodeURIComponent(runtime.localAccessTicket)}\n`);
} else {
  console.log(`Open: ${publicOrigin}/`);
}

const web = spawnWeb();

const shutdownCoordinator = createRuntimeShutdownCoordinator({
  terminateWeb: () => {
    web.kill();
  },
  closeRuntime: (onClosed) => {
    runtime.server.close(onClosed);
  },
  exit: (exitCode) => {
    process.exit(exitCode);
  },
});

process.once("SIGINT", () => shutdownCoordinator.shutdown({ exitCode: 0, terminateWeb: true }));
process.once("SIGTERM", () => shutdownCoordinator.shutdown({ exitCode: 0, terminateWeb: true }));
web.once("exit", (code) => shutdownCoordinator.shutdown({ exitCode: code ?? 0, terminateWeb: false }));
