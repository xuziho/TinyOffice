import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import pg from "pg";
import { extract } from "tar";

const { Client } = pg;
const root = process.cwd();
const adminDatabaseUrl = process.env.TINYOFFICE_PRODUCTION_SMOKE_ADMIN_DATABASE_URL?.trim();
if (!adminDatabaseUrl) {
  throw new Error("TINYOFFICE_PRODUCTION_SMOKE_ADMIN_DATABASE_URL is required.");
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const gitCommit = checkedOutput("git", ["rev-parse", "HEAD"]);
const releaseId = `${packageJson.version}-${gitCommit.slice(0, 12)}`;
const stagingName = `tinyoffice-${releaseId}`;
const archive = path.join(root, ".release", `${stagingName}.tgz`);
const extractRoot = path.join(root, ".scratch", "production-release-smoke");
const releaseRoot = path.join(extractRoot, stagingName);
const databaseName = `tinyoffice_release_smoke_${process.pid}`;
const targetDatabaseUrl = databaseUrlFor(adminDatabaseUrl, databaseName);
const runtimePort = 18000 + (process.pid % 1000);
let runtime;
let runtimeLog = "";

try {
  checked(npm, ["run", "build:production-release"], root, {
    ...process.env,
    TINYOFFICE_ALLOW_DIRTY_RELEASE: "1",
  });
  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });
  await extract({ cwd: extractRoot, file: archive });
  await mkdir(path.join(releaseRoot, "companies"), { recursive: true });
  await mkdir(path.join(releaseRoot, ".data"), { recursive: true });

  checked(npm, ["ci", "--omit=dev"], releaseRoot, process.env);
  await recreateDatabase(adminDatabaseUrl, databaseName);
  checked(node, ["--import", "tsx", "scripts/runtime/init-tinyoffice-postgres-schema.ts"], releaseRoot, {
    ...process.env,
    TINYOFFICE_DATABASE_URL: targetDatabaseUrl,
  });

  runtime = spawn(node, ["--import", "tsx", "scripts/runtime/run-tinyoffice-production.ts"], {
    cwd: releaseRoot,
    env: {
      ...process.env,
      TINYOFFICE_DEPLOYMENT_MODE: "production",
      TINYOFFICE_DATABASE_URL: targetDatabaseUrl,
      TINYOFFICE_PUBLIC_ORIGIN: "https://office.example.test",
      TINYOFFICE_AUTH_SECRET: "production-release-smoke-secret-production-release-smoke-secret",
      TINYOFFICE_RUNTIME_PORT: String(runtimePort),
      TINYOFFICE_BIND_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  runtime.stdout.setEncoding("utf8");
  runtime.stderr.setEncoding("utf8");
  runtime.stdout.on("data", (chunk) => {
    runtimeLog += chunk;
  });
  runtime.stderr.on("data", (chunk) => {
    runtimeLog += chunk;
  });

  await waitForProductionReadiness(runtime, runtimePort, () => runtimeLog);
  if (!/Open once: https:\/\/office\.example\.test\/\?bootstrap=\S+/.test(runtimeLog)) {
    throw new Error(`Production startup did not print the Owner bootstrap URL.\n${redact(runtimeLog)}`);
  }
  console.log(`Production Release smoke passed for ${releaseId}.`);
} finally {
  if (runtime && runtime.exitCode === null) {
    runtime.kill("SIGTERM");
    await Promise.race([once(runtime, "exit"), delay(10_000)]);
  }
  await dropDatabase(adminDatabaseUrl, databaseName).catch(() => undefined);
  await rm(extractRoot, { recursive: true, force: true });
}

function checked(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
}

function checkedOutput(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed.`);
  return result.stdout.trim();
}

async function recreateDatabase(connectionString, databaseName) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(connectionString, databaseName) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

function databaseUrlFor(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function waitForProductionReadiness(child, port, readLog) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Production runtime exited with code ${child.exitCode}.\n${redact(readLog())}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`);
      if (response.ok) return;
    } catch {
      // The packaged runtime may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Production runtime did not become ready.\n${redact(readLog())}`);
}

function redact(value) {
  return value.replace(/([?&](?:bootstrap|localAccess)=)[^\s]+/g, "$1<redacted>");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
