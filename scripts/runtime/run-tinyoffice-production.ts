import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

import { createTinyOfficeServer } from "../../src/runtime/realtime/tinyoffice-server.js";
import { defaultRuntimeProvider } from "../../src/runtime/provider/pi-runtime-provider.js";
import { createRuntimeShutdownCoordinator } from "./runtime-shutdown-coordinator.js";

if (process.env.TINYOFFICE_DEPLOYMENT_MODE !== "production") {
  throw new Error("Production entry requires TINYOFFICE_DEPLOYMENT_MODE=production.");
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseManifest = JSON.parse(await readFile(path.join(repoRoot, "RELEASE.json"), "utf8")) as {
  schema?: unknown;
  releaseId?: unknown;
  tinyOfficeVersion?: unknown;
};
if (releaseManifest.schema !== "tinyoffice-production-release" || typeof releaseManifest.releaseId !== "string" || typeof releaseManifest.tinyOfficeVersion !== "string") {
  throw new Error("Production entry requires a valid RELEASE.json.");
}
process.env.TINYOFFICE_RELEASE_VERSION = releaseManifest.releaseId;
const staticWebRoot = path.resolve(process.env.TINYOFFICE_WEB_ROOT?.trim() || path.join(repoRoot, "public"));
await access(path.join(staticWebRoot, "index.html"));

const runtimePort = Number(process.env.TINYOFFICE_RUNTIME_PORT || "8095");
const bindHost = process.env.TINYOFFICE_BIND_HOST?.trim() || "127.0.0.1";
const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim();
const publicOrigin = process.env.TINYOFFICE_PUBLIC_ORIGIN?.trim();
if (!databaseUrl) throw new Error("Production entry requires TINYOFFICE_DATABASE_URL.");
if (!publicOrigin) throw new Error("Production entry requires TINYOFFICE_PUBLIC_ORIGIN.");

const runtime = await createTinyOfficeServer({
  repoRoot,
  databaseUrl,
  publicOrigin,
  staticWebRoot,
  ...(process.env.TINYOFFICE_AUTH_SECRET?.trim() ? { authSecret: process.env.TINYOFFICE_AUTH_SECRET.trim() } : {}),
  runtimeProvider: defaultRuntimeProvider,
});

runtime.server.listen(runtimePort, bindHost);
await once(runtime.server, "listening");
console.log(`TinyOffice production Release ${releaseManifest.releaseId}: ${publicOrigin}`);

const shutdownCoordinator = createRuntimeShutdownCoordinator({
  terminateWeb: () => undefined,
  closeRuntime: (onClosed) => runtime.server.close(onClosed),
  exit: (exitCode) => process.exit(exitCode),
});
process.once("SIGINT", () => shutdownCoordinator.shutdown({ exitCode: 0, terminateWeb: false }));
process.once("SIGTERM", () => shutdownCoordinator.shutdown({ exitCode: 0, terminateWeb: false }));
