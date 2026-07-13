import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { PermissionRule } from "../../src/collaboration/policy/permission-rule.js";
import type { EmployeeRuntimeConfig } from "../../src/collaboration/runtime/startup-contract.js";
import {
  createDbCompanyGovernanceServices,
  ApprovalService,
} from "../../src/governance/services/company-governance-services.js";
import { ApprovalRepository } from "../../src/governance/repositories/approval-repository.js";
import { PostgresCompanyGovernanceStore } from "../../src/governance/storage/postgres-company-governance-store.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresPoolLike,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";

class FakeGovernancePostgresClient implements CompanyPostgresClient {
  readonly rows = new Map<string, Record<string, unknown>>();
  readonly grantRows = new Map<string, Record<string, unknown>>();
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }> = [];
  released = false;

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }> {
    this.queries.push({ sql, params });
    const compactSql = sql.replace(/\s+/g, " ").trim();
    if (compactSql.startsWith("SELECT * FROM governance_approvals")) {
      return {
        rows: (Array.from(this.rows.values())
          .sort((left, right) =>
            String(left.created_at).localeCompare(String(right.created_at)) ||
            String(left.id).localeCompare(String(right.id)))) as T[],
      };
    }
    if (compactSql.startsWith("SELECT * FROM approval_grants")) {
      return {
        rows: (Array.from(this.grantRows.values())
          .sort((left, right) =>
            String(left.created_at).localeCompare(String(right.created_at)) ||
            String(left.id).localeCompare(String(right.id)))) as T[],
      };
    }
    if (compactSql.startsWith("INSERT INTO governance_approvals")) {
      const [
        companyId,
        id,
        contextKind,
        contextId,
        sessionKey,
        requestedByMemberId,
        requestedApproverMemberId,
        requestedAction,
        requestedResource,
        requestedInputSnapshot,
        status,
        reason,
        decisionNote,
        resolvedByMemberId,
        createdAt,
        updatedAt,
        resolvedAt,
      ] = params || [];
      this.rows.set(String(id), {
        company_id: companyId,
        id,
        context_kind: contextKind,
        context_id: contextId,
        session_key: sessionKey,
        requested_by_member_id: requestedByMemberId,
        requested_approver_member_id: requestedApproverMemberId,
        requested_action: requestedAction,
        requested_resource: requestedResource,
        requested_input_snapshot_json: requestedInputSnapshot,
        status,
        reason,
        decision_note: decisionNote,
        resolved_by_member_id: resolvedByMemberId,
        created_at: createdAt,
        updated_at: updatedAt,
        resolved_at: resolvedAt,
      });
    }
    if (compactSql.startsWith("INSERT INTO approval_grants")) {
      const [
        companyId,
        id,
        approvalId,
        memberId,
        action,
        resource,
        scope,
        contextKind,
        contextId,
        expiresAt,
        consumedAt,
        createdAt,
      ] = params || [];
      this.grantRows.set(String(id), {
        company_id: companyId,
        id,
        approval_id: approvalId,
        member_id: memberId,
        action,
        resource,
        scope,
        context_kind: contextKind,
        context_id: contextId,
        expires_at: expiresAt,
        consumed_at: consumedAt,
        created_at: createdAt,
      });
      return { rows: [] };
    }
    if (compactSql.startsWith("DELETE FROM approval_grants")) {
      this.grantRows.clear();
      return { rows: [] };
    }
    if (compactSql.startsWith("DELETE FROM governance_approvals")) {
      this.rows.clear();
    }
    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

class FakeGovernancePostgresPool implements CompanyPostgresPoolLike {
  ended = false;

  constructor(readonly client = new FakeGovernancePostgresClient()) {}

  async connect(): Promise<CompanyPostgresClient> {
    return this.client;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }> {
    return this.client.query<T>(sql, params);
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

test("db governance policy boundary reads employees through admin state", async () => {
  const serviceSource = await readFile(
    "src/governance/services/company-governance-services.ts",
    "utf8",
  );
  const repositorySource = await readFile(
    "src/governance/repositories/admin-employee-policy-repository.ts",
    "utf8",
  );

  assert.match(serviceSource, /AdminEmployeePolicyRepository/);
  assert.doesNotMatch(serviceSource, /DirectoryEmployeePolicyRepository/);
  assert.match(repositorySource, /loadEmployeesAdminState/);
  assert.doesNotMatch(repositorySource, /CompanyDirectoryRepository/);
});

test("db governance reads employee identity from employees admin state without action permissions", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-db-governance-directory-policy-"));
  await mkdir(path.join(repoRoot, ".data"), { recursive: true });
  const repository = await CompanyDirectoryRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    await repository.upsertEmployee({
      employeeId: "nora-automation",
      enabled: true,
      profile: {
        employeeId: "nora-automation",
        role: "automation",
        displayName: "Nora",
        presenceMode: "resident",
      },
      resourcePolicy: { version: 1, filesystem: { ownWorkspace: "allow", otherEmployeeWorkspace: "allow", repo: "allow", secrets: "deny" } },
      runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
    });
    await repository.save();
  } finally {
    repository.close();
  }

  const pool = new FakeGovernancePostgresPool();
  const governance = await createDbCompanyGovernanceServices(
    repoRoot,
    {
      env: {
        TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
      },
      companyId: DEFAULT_COMPANY_ID,
      createPostgresPool: () => pool,
    },
  );
  const runtime: EmployeeRuntimeConfig = {
    employeeId: "nora-automation",
    role: "automation",
    presenceMode: "resident",
    mountedActions: ["handoff"],
  };

  const permission = await governance.permissionService.evaluate(
    runtime,
    "handoff",
    [
      {
        employeeId: "nora-automation",
        actionName: "handoff",
        decision: "deny",
      },
    ],
  );

  assert.equal(permission.decision, "deny");
  const policies = await governance.employeePolicyRepository.list();
  const noraPolicy = policies.find((policy) => policy.employeeId === "nora-automation");
  assert.ok(noraPolicy);
  assert.deepEqual(noraPolicy.permissionRules, []);
});

test("db governance default backend fails fast without database url", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-db-governance-default-"));
  await mkdir(path.join(repoRoot, ".data"), { recursive: true });
  await assert.rejects(
    () =>
      createDbCompanyGovernanceServices(
        repoRoot,
        { env: {}, companyId: DEFAULT_COMPANY_ID },
      ),
    /TINYOFFICE_DATABASE_URL is required for the default PostgreSQL runtime backend/,
  );
});

test("db governance uses postgres backend for approval create, list, and resolve", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-db-governance-postgres-"));
  const pool = new FakeGovernancePostgresPool();
  const governance = await createDbCompanyGovernanceServices(
    repoRoot,
    {
      env: {
        COMPANY_DATABASE_BACKEND: "postgres",
        TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
      },
      companyId: DEFAULT_COMPANY_ID,
      createPostgresPool: (databaseUrl) => {
        assert.equal(databaseUrl, "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice");
        return pool;
      },
    },
  );

  const approval = await governance.approvalService.createApproval({
    contextKind: "channel_topic",
    contextId: "topic-postgres-approval",
    sessionKey: "nora-automation|channel_thread|topic-postgres-approval",
    requestedByMemberId: "nora-automation",
    requestedAction: "office_tool.post",
    requestedResource: "owned_chat.channel",
    reason: "Need approval before posting to a channel.",
  });
  const listed = await governance.approvalRepository.list();
  const resolved = await governance.approvalService.resolveApproval(
    approval.id,
    "approved",
    { grantScope: "one_time" },
  );

  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.contextKind, "channel_topic");
  assert.equal(listed[0]?.requestedAction, "office_tool.post");
  assert.equal(resolved?.approval.status, "approved");
  assert.equal(resolved?.grant?.action, "office_tool.post");
  assert.equal(resolved?.grant?.scope, "one_time");
  assert.equal(pool.client.released, false);
  assert.equal(pool.ended, false);
  assert.equal(
    pool.client.queries.some((query) =>
      query.sql.includes("INSERT INTO governance_approvals")),
    true,
  );

  governance.store.close();
  assert.equal(pool.client.released, true);
  assert.equal(pool.ended, true);
});

test("approval service cancels every pending Access request for a terminal WorkRun context", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-db-governance-terminal-work-"));
  const pool = new FakeGovernancePostgresPool();
  const governance = await createDbCompanyGovernanceServices(repoRoot, {
    env: {
      COMPANY_DATABASE_BACKEND: "postgres",
      TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
    },
    companyId: DEFAULT_COMPANY_ID,
    createPostgresPool: () => pool,
  });
  try {
    await governance.approvalService.createApproval({
      contextKind: "work_run",
      contextId: "work-run-terminal",
      sessionKey: "employee|work_run_execution|work-run-terminal",
      requestedByMemberId: "employee",
      requestedAction: "read.file",
      requestedResource: ".env",
      reason: "Read the requested file.",
    });
    await governance.approvalService.createApproval({
      contextKind: "work_run",
      contextId: "work-run-terminal",
      sessionKey: "employee|work_run_execution|work-run-terminal",
      requestedByMemberId: "employee",
      requestedAction: "bash.command",
      requestedResource: ".env",
      reason: "Inspect the requested file through a command.",
    });
    await governance.approvalService.createApproval({
      contextKind: "channel_topic",
      contextId: "topic-still-open",
      sessionKey: "employee|channel_topic|topic-still-open",
      requestedByMemberId: "employee",
      requestedAction: "write.message",
      reason: "Post a topic message.",
    });

    const canceled = await governance.approvalService.cancelPendingApprovalsForContext({
      contextKind: "work_run",
      contextId: "work-run-terminal",
      reason: "WorkRun entered terminal status failed.",
    });
    const approvals = await governance.approvalRepository.list();

    assert.equal(canceled.length, 2);
    assert.deepEqual(
      approvals.map((approval) => [approval.contextId, approval.status]),
      [
        ["work-run-terminal", "canceled"],
        ["work-run-terminal", "canceled"],
        ["topic-still-open", "pending"],
      ],
    );
  } finally {
    governance.store.close?.();
  }
});

test("approval service cancels pending requests and revokes grants when a runtime member is deactivated", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-db-governance-member-lifecycle-"));
  const pool = new FakeGovernancePostgresPool();
  const governance = await createDbCompanyGovernanceServices(repoRoot, {
    env: {
      COMPANY_DATABASE_BACKEND: "postgres",
      TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
    },
    companyId: DEFAULT_COMPANY_ID,
    createPostgresPool: () => pool,
  });
  try {
    const approval = await governance.approvalService.createApproval({
      contextKind: "channel_topic",
      contextId: "topic-member-lifecycle",
      sessionKey: "employee|channel_topic|topic-member-lifecycle",
      requestedByMemberId: "employee",
      requestedAction: "write.message",
      reason: "Post a topic message.",
    });
    await governance.approvalService.resolveApproval(approval.id, "approved", { grantScope: "session" });
    await governance.approvalService.createApproval({
      contextKind: "dm_thread",
      contextId: "dm-member-lifecycle",
      sessionKey: "employee|dm_thread|dm-member-lifecycle",
      requestedByMemberId: "employee",
      requestedAction: "read.file",
      reason: "Read a local file.",
    });
    await governance.approvalService.createApproval({
      contextKind: "dm_thread",
      contextId: "dm-other-member",
      sessionKey: "other|dm_thread|dm-other-member",
      requestedByMemberId: "other",
      requestedAction: "read.file",
      reason: "Read another local file.",
    });

    const canceled = await governance.approvalService.cancelPendingApprovalsForMember({
      memberId: "employee",
      reason: "Runtime member was deactivated.",
    });
    const revoked = await governance.approvalService.revokeGrantsForMember("employee");

    assert.equal(canceled.length, 1);
    assert.equal(revoked, 1);
    assert.equal((await governance.approvalRepository.listGrants()).length, 0);
    assert.equal(
      (await governance.approvalRepository.list()).find((item) => item.contextId === "dm-other-member")?.status,
      "pending",
    );
  } finally {
    governance.store.close?.();
  }
});

test("postgres governance store round-trips loaded Date timestamps through approval service as ISO strings", async () => {
  const pool = new FakeGovernancePostgresPool();
  pool.client.rows.set("approval-existing", {
    id: "approval-existing",
    context_kind: "channel_topic",
    context_id: "launch-approval-thread",
    session_key: "campaign-ops|channel_topic|launch-approval-thread",
    requested_by_member_id: "campaign-ops",
    requested_approver_member_id: null,
    requested_action: "external.write",
    requested_resource: "external:channel:launch-ops",
    requested_input_snapshot_json: { channelName: "launch-ops" },
    status: "pending",
    reason: "Create launch coordination channel after approval.",
    decision_note: null,
    resolved_by_member_id: null,
    created_at: new Date("2026-06-21T03:46:53.000Z"),
    updated_at: new Date("2026-06-21T03:46:53.000Z"),
    resolved_at: null,
  });
  pool.client.grantRows.set("grant-existing", {
    id: "grant-existing",
    approval_id: "approval-existing",
    member_id: "campaign-ops",
    action: "external.write",
    resource: "external:channel:launch-planning",
    scope: "one_time",
    context_kind: "channel_topic",
    context_id: "launch-planning-thread",
    expires_at: new Date("2026-06-21T05:00:00.000Z"),
    consumed_at: new Date("2026-06-21T04:00:00.000Z"),
    created_at: new Date("2026-06-21T03:50:00.000Z"),
  });
  const store = await PostgresCompanyGovernanceStore.open({
    client: pool.client,
    pool,
    companyId: DEFAULT_COMPANY_ID,
  });
  const approvalService = new ApprovalService(new ApprovalRepository(store));

  const resolved = await approvalService.resolveApproval(
    "approval-existing",
    "rejected",
    {
      resolvedByMemberId: "xuziho",
      decisionNote: "  Launch ops channel is not needed yet.  ",
    },
  );

  const approvalInsert = pool.client.queries.findLast((query) =>
    query.sql.includes("INSERT INTO governance_approvals")
  );
  const grantInsert = pool.client.queries.findLast((query) =>
    query.sql.includes("INSERT INTO approval_grants")
  );

  assert.equal(resolved?.approval.status, "rejected");
  assert.equal(resolved?.approval.decisionNote, "Launch ops channel is not needed yet.");
  assert.equal(approvalInsert?.params?.[12], "Launch ops channel is not needed yet.");
  assert.equal(approvalInsert?.params?.[14], "2026-06-21T03:46:53.000Z");
  assert.equal(grantInsert?.params?.[9], "2026-06-21T05:00:00.000Z");
  assert.equal(grantInsert?.params?.[10], "2026-06-21T04:00:00.000Z");
  assert.equal(grantInsert?.params?.[11], "2026-06-21T03:50:00.000Z");

  store.close();
});

test("db governance postgres backend fails fast without database url", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-db-governance-postgres-url-"));

  await assert.rejects(
    () =>
      createDbCompanyGovernanceServices(
        repoRoot,
        {
          env: {
            COMPANY_DATABASE_BACKEND: "postgres",
          },
          companyId: DEFAULT_COMPANY_ID,
        },
      ),
    /TINYOFFICE_DATABASE_URL is required when COMPANY_DATABASE_BACKEND=postgres/,
  );
});

test("db governance approval repository only lists the requested company's approvals", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-db-governance-company-scope-"));
  const otherCompanyId = "support-governance";
  await createCompany({ repoRoot, companyId: otherCompanyId, displayName: "Support Governance" });

  const defaultGovernance = await createDbCompanyGovernanceServices(repoRoot, {
    companyId: DEFAULT_COMPANY_ID,
  });
  const otherGovernance = await createDbCompanyGovernanceServices(repoRoot, {
    companyId: otherCompanyId,
  });

  try {
    await defaultGovernance.approvalService.createApproval({
      contextKind: "channel_topic",
      contextId: "shared-root",
      sessionKey: "agent|channel_thread|shared-root",
      requestedByMemberId: "agent",
      requestedAction: "office_tool.post",
      requestedResource: "owned_chat.channel",
      reason: "Default company request.",
    });
    await otherGovernance.approvalService.createApproval({
      contextKind: "channel_topic",
      contextId: "shared-root",
      sessionKey: "agent|channel_thread|shared-root",
      requestedByMemberId: "agent",
      requestedAction: "office_tool.post",
      requestedResource: "owned_chat.channel",
      reason: "Support company request.",
    });

    assert.deepEqual(
      (await defaultGovernance.approvalRepository.list()).map((approval) => approval.reason),
      ["Default company request."],
    );
    assert.deepEqual(
      (await otherGovernance.approvalRepository.list()).map((approval) => approval.reason),
      ["Support company request."],
    );
  } finally {
    defaultGovernance.store.close();
    otherGovernance.store.close();
  }
});
