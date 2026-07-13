import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { companyEmployeeHomePath } from "../src/runtime/company-config/company-paths.js";
import toolGuard from "../packages/pi-tool-guard/src/index.ts";

type ToolCallEvent = {
  toolName: string;
  input: unknown;
};

type ToolCallHandler = (event: ToolCallEvent, ctx: GuardContext) => unknown;

type GuardContext = {
  cwd: string;
};

type PolicyOverrides = Record<string, unknown>;

function installGuard() {
  let toolCallHandler: ToolCallHandler | undefined;

  toolGuard({
    on(event: string, handler: unknown) {
      if (event === "tool_call") {
        toolCallHandler = handler as ToolCallHandler;
      }
    },
  } as never);

  assert.ok(toolCallHandler);
  return toolCallHandler;
}

async function withPolicy<T>(overrides: PolicyOverrides, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.PI_TOOL_GUARD_POLICY_JSON;
  process.env.PI_TOOL_GUARD_POLICY_JSON = JSON.stringify({
    version: 1,
    cwdBoundaryReadMode: "allow",
    cwdBoundaryWriteMode: "allow",
    sensitivePathPatterns: [".env"],
    blockedReadPathPatterns: [],
    protectedWritePathPatterns: [".env"],
    askReadPathPatterns: [],
    askWritePathPatterns: [],
    externalWriteAllowPaths: [],
    bashDenyPatterns: ["rm *-rf*"],
    bashAskPatterns: [],
    bashAllowPatterns: [],
    denyBashByDefault: false,
    ...overrides,
  });
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.PI_TOOL_GUARD_POLICY_JSON;
    } else {
      process.env.PI_TOOL_GUARD_POLICY_JSON = previous;
    }
  }
}

async function withAccessRuntimeBridge<T>(
  fetchImpl: typeof fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const previousBaseUrl = process.env.TINYOFFICE_API_BASE_URL;
  const previousCompanyId = process.env.TINYOFFICE_COMPANY_ID;
  const previousEmployeeId = process.env.PI_EMPLOYEE_ID;
  const previousConversationContext = process.env.PI_CONVERSATION_CONTEXT_JSON;
  const previousFetch = globalThis.fetch;

  process.env.TINYOFFICE_API_BASE_URL = "http://127.0.0.1:8095";
  process.env.TINYOFFICE_COMPANY_ID = "tinyoffice";
  process.env.PI_EMPLOYEE_ID = "mira-hr";
  process.env.PI_CONVERSATION_CONTEXT_JSON = JSON.stringify({
    companyId: "tinyoffice",
    channelTopicId: "room-1",
    sessionKey: "mira-hr|channel_topic|room-1",
  });
  globalThis.fetch = fetchImpl;

  try {
    return await fn();
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.TINYOFFICE_API_BASE_URL;
    } else {
      process.env.TINYOFFICE_API_BASE_URL = previousBaseUrl;
    }
    if (previousCompanyId === undefined) {
      delete process.env.TINYOFFICE_COMPANY_ID;
    } else {
      process.env.TINYOFFICE_COMPANY_ID = previousCompanyId;
    }
    if (previousEmployeeId === undefined) {
      delete process.env.PI_EMPLOYEE_ID;
    } else {
      process.env.PI_EMPLOYEE_ID = previousEmployeeId;
    }
    if (previousConversationContext === undefined) {
      delete process.env.PI_CONVERSATION_CONTEXT_JSON;
    } else {
      process.env.PI_CONVERSATION_CONTEXT_JSON = previousConversationContext;
    }
    globalThis.fetch = previousFetch;
  }
}

async function createCtx() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "pi-tool-guard-repo-"));
  const cwd = path.join(
    companyEmployeeHomePath({
      repoRoot,
      companyId: "tinyoffice",
      employeeId: "mira-hr",
    }),
    "workspace",
  );
  const companyDir = path.join(repoRoot, "company");
  await mkdir(cwd, { recursive: true });
  await mkdir(companyDir, { recursive: true });
  return {
    repoRoot,
    companyDir,
    ctx: { cwd } satisfies GuardContext,
  };
}

test("pi-tool-guard allows ordinary reads outside cwd", async () => {
  const handler = installGuard();
  const { companyDir, ctx } = await createCtx();
  const docPath = path.join(companyDir, "policy-note.md");
  await writeFile(docPath, "{}\n", "utf8");

  const result = await handler({ toolName: "read", input: { path: docPath } }, ctx);

  assert.equal(result, undefined);
});

test("pi-tool-guard can require approval for cwd-external reads", async () => {
  const handler = installGuard();
  const { companyDir, ctx } = await createCtx();
  await withPolicy({
      cwdBoundaryReadMode: "ask",
    },
    async () => {
      const docPath = path.join(companyDir, "policy-note.md");

      const result = await handler({ toolName: "read", input: { path: docPath } }, ctx);

      assert.deepEqual(result, {
        block: true,
        reason: `Access requires approval for cwd-external read: ${docPath}`,
      });
    },
  );
});

test("pi-tool-guard can block cwd-external reads", async () => {
  const handler = installGuard();
  const { companyDir, ctx } = await createCtx();
  await withPolicy({
      cwdBoundaryReadMode: "deny",
    },
    async () => {
      const docPath = path.join(companyDir, "policy-note.md");

      const result = await handler({ toolName: "read", input: { path: docPath } }, ctx);

      assert.deepEqual(result, {
        block: true,
        reason: `Access blocked cwd-external read: ${docPath}`,
      });
    },
  );
});

test("pi-tool-guard blocks sensitive reads", async () => {
  const handler = installGuard();
  const { repoRoot, ctx } = await createCtx();
  const envPath = path.join(repoRoot, ".env");
  await writeFile(envPath, "TOKEN=secret\n", "utf8");

  const result = await handler({ toolName: "read", input: { path: envPath } }, ctx);

  assert.deepEqual(result, {
    block: true,
    reason: `Access requires participant decision for sensitive path read: ${envPath}`,
  });
});

test("pi-tool-guard allows an approval-required read when the runtime Access bridge returns allow", async () => {
  const handler = installGuard();
  const { repoRoot, ctx } = await createCtx();
  const envPath = path.join(repoRoot, ".env");
  await writeFile(envPath, "TOKEN=secret\n", "utf8");
  let postedUrl = "";
  let postedBody: unknown;

  await withAccessRuntimeBridge(
    (async (input, init) => {
      postedUrl = String(input);
      postedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ decision: "allow" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
    async () => {
      const result = await handler({ toolName: "read", input: { path: envPath } }, ctx);

      assert.equal(result, undefined);
      assert.equal(postedUrl, "http://127.0.0.1:8095/api/companies/tinyoffice/access/tool-call");
      assert.deepEqual(postedBody, {
        companyId: "tinyoffice",
        memberId: "mira-hr",
        action: "read",
        resource: envPath,
        reason: `Access requires participant decision for sensitive path read: ${envPath}`,
        contextKind: "channel_topic",
        contextId: "room-1",
        sessionKey: "mira-hr|channel_topic|room-1",
        requestedInputSnapshot: { toolName: "read", input: { path: envPath } },
      });
    },
  );
});

test("pi-tool-guard blocks and returns the approval request reason when the runtime Access bridge returns block", async () => {
  const handler = installGuard();
  const { ctx } = await createCtx();
  const runtimeConfigPath = path.join(ctx.cwd, "docker-compose.yml");

  await withAccessRuntimeBridge(
    (async () => new Response(JSON.stringify({
      decision: "block",
      reason: "Access request approval-tool-call-1 is pending.",
      request: { id: "approval-tool-call-1" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch,
    async () => {
      const result = await handler(
        { toolName: "write", input: { path: runtimeConfigPath, content: "services: {}\n" } },
        ctx,
      );

      assert.deepEqual(result, {
        block: true,
        reason: "Access request approval-tool-call-1 is pending.",
      });
    },
  );
});

test("pi-tool-guard allows ordinary cwd-external writes by default", async () => {
  const handler = installGuard();
  const { companyDir, ctx } = await createCtx();
  const docPath = path.join(companyDir, "note.md");

  const result = await handler(
    { toolName: "write", input: { path: docPath, content: "hello\n" } },
    ctx,
  );

  assert.equal(result, undefined);
});

test("pi-tool-guard can require approval for cwd-external writes", async () => {
  const handler = installGuard();
  const { companyDir, ctx } = await createCtx();
  await withPolicy({
      cwdBoundaryWriteMode: "ask",
    },
    async () => {
      const docPath = path.join(companyDir, "note.md");

      const result = await handler(
        { toolName: "write", input: { path: docPath, content: "hello\n" } },
        ctx,
      );

      assert.deepEqual(result, {
        block: true,
        reason: `Access requires approval for cwd-external write: ${docPath}`,
      });
    },
  );
});

test("pi-tool-guard can block cwd-external writes", async () => {
  const handler = installGuard();
  const { companyDir, ctx } = await createCtx();
  await withPolicy({
      cwdBoundaryWriteMode: "deny",
    },
    async () => {
      const docPath = path.join(companyDir, "note.md");

      const result = await handler(
        { toolName: "write", input: { path: docPath, content: "hello\n" } },
        ctx,
      );

      assert.deepEqual(result, {
        block: true,
        reason: `Access blocked cwd-external write: ${docPath}`,
      });
    },
  );
});

test("pi-tool-guard allows configured cwd-external write roots", async () => {
  const handler = installGuard();
  const { repoRoot, companyDir, ctx } = await createCtx();
  await withPolicy({
      cwdBoundaryWriteMode: "deny",
      externalWriteAllowPaths: [companyDir],
    },
    async () => {
      const docPath = path.join(repoRoot, "company", "note.md");

      const result = await handler(
        { toolName: "write", input: { path: docPath, content: "hello\n" } },
        ctx,
      );

      assert.equal(result, undefined);
    },
  );
});

test("pi-tool-guard requires participant decision for runtime config writes", async () => {
  const handler = installGuard();
  const { ctx } = await createCtx();
  const runtimeConfigPath = path.join(ctx.cwd, "docker-compose.yml");

  const result = await handler(
    { toolName: "write", input: { path: runtimeConfigPath, content: "services: {}\n" } },
    ctx,
  );

  assert.deepEqual(result, {
    block: true,
    reason: `Access requires participant decision for runtime config write (runtime config path): ${runtimeConfigPath}`,
  });
});

test("pi-tool-guard detects runtime config-like content in config files", async () => {
  const handler = installGuard();
  const { ctx } = await createCtx();
  const configDir = path.join(ctx.cwd, "src");
  await mkdir(configDir, { recursive: true });
  const constantsPath = path.join(configDir, "constants.ts");

  const result = await handler(
    {
      toolName: "write",
      input: { path: constantsPath, content: 'export const API_TOKEN = process.env.API_TOKEN;\n' },
    },
    ctx,
  );

  assert.deepEqual(result, {
    block: true,
    reason: `Access requires participant decision for runtime config write (runtime config-like content *_TOKEN): ${constantsPath}`,
  });
});

test("pi-tool-guard allows ordinary workspace writes", async () => {
  const handler = installGuard();
  const { ctx } = await createCtx();
  const notePath = path.join(ctx.cwd, "notes", "todo.md");

  const result = await handler(
    { toolName: "write", input: { path: notePath, content: "- normal note\n" } },
    ctx,
  );

  assert.equal(result, undefined);
});

test("pi-tool-guard blocks denied bash patterns", async () => {
  const handler = installGuard();
  const { ctx } = await createCtx();

  const result = await handler({ toolName: "bash", input: { command: "rm -rf build" } }, ctx);

  assert.deepEqual(result, {
    block: true,
    reason: "Access blocked bash command: rm -rf build",
  });
});

test("pi-tool-guard requires approval when bash reads a sensitive path", async () => {
  const handler = installGuard();
  const { ctx } = await createCtx();

  const result = await handler(
    { toolName: "bash", input: { command: "sed -n 's/=.*/=<redacted>/p' .env.local | nl -ba" } },
    ctx,
  );

  assert.deepEqual(result, {
    block: true,
    reason: "Access requires participant decision for sensitive path read via bash command: .env.local",
  });
});

test("pi-tool-guard can require approval for configured reads, writes, and bash", async () => {
  const handler = installGuard();
  const { repoRoot, companyDir, ctx } = await createCtx();
  await withPolicy({
      askReadPathPatterns: ["company/**"],
      askWritePathPatterns: ["src/**"],
      bashAskPatterns: ["npm install *"],
    },
    async () => {
      assert.deepEqual(
        await handler({ toolName: "read", input: { path: path.join(companyDir, "note.md") } }, ctx),
        {
          block: true,
          reason: `Access requires approval for read: ${path.join(companyDir, "note.md")}`,
        },
      );
      assert.deepEqual(
        await handler({ toolName: "write", input: { path: path.join(repoRoot, "src", "index.ts") } }, ctx),
        {
          block: true,
          reason: `Access requires approval for write: ${path.join(repoRoot, "src", "index.ts")}`,
        },
      );
      assert.deepEqual(
        await handler({ toolName: "bash", input: { command: "npm install left-pad" } }, ctx),
        {
          block: true,
          reason: "Access requires approval for bash command: npm install left-pad",
        },
      );
    },
  );
});

test("pi-tool-guard allows normal bash by default", async () => {
  const handler = installGuard();
  const { ctx } = await createCtx();

  const result = await handler({ toolName: "bash", input: { command: "rg todo src" } }, ctx);

  assert.equal(result, undefined);
});
