import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";
import { Pool } from "pg";

import {
  createCompany,
  deleteCompany,
  loadCompaniesAdminViewModel,
  saveCompanySystemAiSettings,
  updateCompanyProfile,
} from "../../src/runtime/company-config/companies-admin.js";
import { companyEmployeeHomePath } from "../../src/runtime/company-config/company-paths.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { resetRuntimePostgresTables, waitForRuntimePostgresCleanup } from "./postgres-test-utils.js";

beforeEach(resetRuntimePostgresTables);
after(waitForRuntimePostgresCleanup);

const businessTables = [
  "intake_events",
  "work_task_revisions",
  "work_schedules",
  "work_tasks",
  "work_runs",
  "work_run_events",
  "work_dispatch_leases",
  "channel_topics",
  "channel_topic_handoffs",
  "session_events",
  "session_records",
  "process_trace_events",
  "collaboration_action_events",
  "memory_summaries",
  "governance_approvals",
  "office_tool_audit_logs",
  "operating_events",
  "handoff_replay_ledger",
];

test("creates isolated Companies from the default blueprint", async () => {
  const repoRoot = await mkdtempRepoRoot("tinyoffice-blueprint-");
  const firstCompanyId = "acme-ops";
  const secondCompanyId = "globex-ops";

  try {
    const viewModel = await createCompany({
      repoRoot,
      companyId: firstCompanyId,
      displayName: "Acme Operations",
      ownerMemberId: "xuziho",
      ownerDisplayName: "Xu Ziho",
      hrEmployeeDisplayName: "Avery Owner",
    });
    await createCompany({
      repoRoot,
      companyId: secondCompanyId,
      displayName: "Globex Operations",
      hrEmployeeDisplayName: "Blake Owner",
    });

    assert.ok(viewModel.companies.some((company) => company.companyId === firstCompanyId));

    const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim();
    assert(databaseUrl, "TINYOFFICE_DATABASE_URL is required for companies admin tests.");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      assert.equal(
        Number((await pool.query("SELECT COUNT(*) AS count FROM member_runtime_profiles WHERE company_id = $1", [firstCompanyId])).rows[0].count),
        1,
      );
      assert.equal(
        Number((await pool.query("SELECT COUNT(*) AS count FROM member_runtime_profiles WHERE company_id = $1", [secondCompanyId])).rows[0].count),
        1,
      );
      assert.equal(
        Number((await pool.query("SELECT COUNT(*) AS count FROM member_runtime_profiles WHERE company_id = $1", [DEFAULT_COMPANY_ID])).rows[0].count),
        0,
      );

      for (const [companyId, hrEmployeeId] of [
        [firstCompanyId, "avery-owner"],
        [secondCompanyId, "blake-owner"],
      ] as const) {
        assert.equal(
          Number((await pool.query("SELECT COUNT(*) AS count FROM company_members WHERE company_id = $1 AND id = $2", [companyId, hrEmployeeId])).rows[0].count),
          1,
        );
        for (const tableName of businessTables) {
          assert.equal(
            Number((await pool.query(`SELECT COUNT(*) AS count FROM ${tableName} WHERE company_id = $1`, [companyId])).rows[0].count),
            0,
            `${tableName} should stay empty for ${companyId}`,
          );
        }
      }
      const owner = await pool.query(
        "SELECT display_name, role FROM company_members WHERE company_id = $1 AND id = 'xuziho'",
        [firstCompanyId],
      );
      assert.equal(owner.rows[0]?.display_name, "Xu Ziho");
      assert.equal(owner.rows[0]?.role, "boss");
      const hrRuntime = await pool.query(
        "SELECT model_provider, model_id, thinking_level FROM member_runtime_profiles WHERE company_id = $1 AND member_id = $2",
        [firstCompanyId, "avery-owner"],
      );
      assert.equal(hrRuntime.rows[0]?.model_provider, null);
      assert.equal(hrRuntime.rows[0]?.model_id, null);
      assert.equal(hrRuntime.rows[0]?.thinking_level, "medium");
      assert.equal(
        Number((await pool.query("SELECT COUNT(*) AS count FROM system_ai_provider_configs WHERE company_id = $1", [firstCompanyId])).rows[0].count),
        0,
      );
    } finally {
      await pool.end();
    }

    const firstHomePath = companyEmployeeHomePath({
      repoRoot,
      companyId: firstCompanyId,
      employeeId: "avery-owner",
    });
    const secondHomePath = companyEmployeeHomePath({
      repoRoot,
      companyId: secondCompanyId,
      employeeId: "blake-owner",
    });
    assert.notEqual(firstHomePath, secondHomePath);
    assert.match(await readFile(path.join(firstHomePath, "AGENTS.md"), "utf8"), /Avery Owner/);
    assert.match(await readFile(path.join(secondHomePath, "AGENTS.md"), "utf8"), /Blake Owner/);
    const recruitSkillPath = path.join(firstHomePath, "skills", "recruit-employee", "SKILL.md");
    const recruitSkill = await readFile(recruitSkillPath, "utf8");
    assert.match(recruitSkill, /name: recruit-employee/);
    assert.match(recruitSkill, /tinyoffice_capability_call/);
    assert.match(recruitSkill, /"capabilityId": "employee\.recruit"/);
    assert.ok((await stat(path.join(firstHomePath, "workspace"))).isDirectory());
    assert.ok((await stat(path.join(secondHomePath, "workspace"))).isDirectory());
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("updates a Company display name without changing its stable identity", async () => {
  const repoRoot = await mkdtempRepoRoot("tinyoffice-company-profile-");
  try {
    await createCompany({ repoRoot, companyId: "stable-company", displayName: "Original name", hrEmployeeDisplayName: "Mira" });
    const updated = await updateCompanyProfile({ repoRoot, companyId: "stable-company", displayName: "Renamed company" });
    assert.equal(updated.companies[0]?.companyId, "stable-company");
    assert.equal(updated.companies[0]?.displayName, "Renamed company");

    const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim();
    assert(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const row = await pool.query("SELECT company_id, display_name FROM companies WHERE company_id = $1", ["stable-company"]);
      assert.deepEqual(row.rows[0], { company_id: "stable-company", display_name: "Renamed company" });
      assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM company_members WHERE company_id = $1", ["stable-company"])).rows[0].count), 1);
    } finally {
      await pool.end();
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("Company HR id uses the recruited employee derivation rule and avoids the Owner id", async () => {
  const repoRoot = await mkdtempRepoRoot("tinyoffice-company-hr-id-");
  try {
    await createCompany({
      repoRoot,
      companyId: "identity-labs",
      displayName: "Identity Labs",
      ownerMemberId: "mira-hr",
      ownerDisplayName: "Mira Boss",
      hrEmployeeDisplayName: "Mira HR",
    });
    await createCompany({
      repoRoot,
      companyId: "fallback-hr-labs",
      displayName: "Fallback HR Labs",
    });

    const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim();
    assert(databaseUrl, "TINYOFFICE_DATABASE_URL is required for companies admin tests.");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const members = await pool.query(
        "SELECT id, display_name, role FROM company_members WHERE company_id = $1 ORDER BY id ASC",
        ["identity-labs"],
      );
      assert.deepEqual(members.rows, [
        { id: "mira-hr", display_name: "Mira Boss", role: "boss" },
        { id: "mira-hr-2", display_name: "Mira HR", role: "hr" },
      ]);
      const fallbackHr = await pool.query(
        "SELECT id, display_name, role FROM company_members WHERE company_id = $1",
        ["fallback-hr-labs"],
      );
      assert.deepEqual(fallbackHr.rows, [
        { id: "company-hr", display_name: "Company HR", role: "hr" },
      ]);
    } finally {
      await pool.end();
    }

    assert.ok((await stat(companyEmployeeHomePath({
      repoRoot,
      companyId: "identity-labs",
      employeeId: "mira-hr-2",
    }))).isDirectory());
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("ordinary Company creation derives companyId from display name", async () => {
  const repoRoot = await mkdtempRepoRoot("tinyoffice-company-onboarding-");
  try {
    const viewModel = await createCompany({
      repoRoot,
      displayName: "North Star Labs",
      hrEmployeeDisplayName: "Nora Founder",
      hrRuntime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5-codex",
        thinkingLevel: "medium",
      },
      systemAiRuntime: {
        version: 1,
        modelProvider: "openai",
        modelId: "gpt-5.5",
      },
    });

    assert.ok(viewModel.companies.some((company) => (
      company.companyId === "north-star-labs" &&
      company.displayName === "North Star Labs"
    )));

    const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim();
    assert(databaseUrl, "TINYOFFICE_DATABASE_URL is required for companies admin tests.");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const systemAiConfigs = await pool.query(
        `SELECT capability, provider_kind, enabled, model_ref
FROM system_ai_provider_configs
WHERE company_id = $1
ORDER BY capability ASC`,
        ["north-star-labs"],
      );
      assert.deepEqual(systemAiConfigs.rows, [
        {
          capability: "chat_title_generation",
          provider_kind: "pi_model",
          enabled: true,
          model_ref: "openai/gpt-5.5",
        },
        {
          capability: "chat_topic_summary",
          provider_kind: "pi_model",
          enabled: true,
          model_ref: "openai/gpt-5.5",
        },
      ]);
    } finally {
      await pool.end();
    }

    await assert.rejects(
      createCompany({
        repoRoot,
        displayName: "!!!",
        hrEmployeeDisplayName: "Invalid Seed",
      }),
      /must include letters or numbers|must derive a companyId/,
    );
    await assert.rejects(
      createCompany({
        repoRoot,
        displayName: "Partial Model Labs",
        hrEmployeeDisplayName: "Invalid Model Seed",
        hrRuntime: {
          version: 1,
          modelProvider: "openai",
          thinkingLevel: "medium",
        },
      }),
      /modelProvider and hrRuntime\.modelId must be provided together/,
    );
    await assert.rejects(
      createCompany({
        repoRoot,
        displayName: "Partial System AI Labs",
        hrEmployeeDisplayName: "Invalid System AI Seed",
        systemAiRuntime: {
          version: 1,
          modelProvider: "openai",
        },
      }),
      /systemAiRuntime\.modelProvider and systemAiRuntime\.modelId must be provided together/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("Company lifecycle exposes and saves company-level System AI model settings", async () => {
  const repoRoot = await mkdtempRepoRoot("tinyoffice-company-system-ai-");
  try {
    await createCompany({
      repoRoot,
      companyId: "system-ai-labs",
      displayName: "System AI Labs",
      hrEmployeeDisplayName: "Sage HR",
    });

    let viewModel = await loadCompaniesAdminViewModel({ repoRoot });
    assert.deepEqual(
      viewModel.systemAiSettings
        .filter((setting) => setting.companyId === "system-ai-labs")
        .map((setting) => [setting.capability, setting.configured, setting.enabled, setting.modelRef]),
      [
        ["chat_title_generation", false, false, undefined],
        ["chat_topic_summary", false, false, undefined],
      ],
    );

    viewModel = await saveCompanySystemAiSettings({
      repoRoot,
      companyId: "system-ai-labs",
      settings: {
        chatTitleGeneration: {
          modelProvider: "openai",
          modelId: "gpt-5-mini",
        },
        chatTopicSummary: {
          modelProvider: "openai",
          modelId: "gpt-5",
        },
      },
    });

    assert.deepEqual(
      viewModel.systemAiSettings
        .filter((setting) => setting.companyId === "system-ai-labs")
        .map((setting) => [setting.capability, setting.configured, setting.enabled, setting.modelRef, setting.modelDisplay]),
      [
        ["chat_title_generation", true, true, "openai/gpt-5-mini", "openai / gpt-5-mini"],
        ["chat_topic_summary", true, true, "openai/gpt-5", "openai / gpt-5"],
      ],
    );

    viewModel = await saveCompanySystemAiSettings({
      repoRoot,
      companyId: "system-ai-labs",
      settings: {
        chatTitleGeneration: {},
        chatTopicSummary: {
          modelProvider: "openai",
          modelId: "gpt-5",
        },
      },
    });

    assert.deepEqual(
      viewModel.systemAiSettings
        .filter((setting) => setting.companyId === "system-ai-labs")
        .map((setting) => [setting.capability, setting.configured, setting.enabled, setting.modelRef]),
      [
        ["chat_title_generation", false, false, undefined],
        ["chat_topic_summary", true, true, "openai/gpt-5"],
      ],
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("deletes a Company PostgreSQL graph and file assets while preserving other Companies", async () => {
  const repoRoot = await mkdtempRepoRoot("tinyoffice-company-delete-");
  try {
    await createCompany({
      repoRoot,
      companyId: "support-ops",
      displayName: "Support Operations",
      hrEmployeeDisplayName: "Sam Owner",
    });
    await createCompany({
      repoRoot,
      companyId: "sales-ops",
      displayName: "Sales Operations",
      hrEmployeeDisplayName: "Sasha Owner",
    });

    const databaseUrl = process.env.TINYOFFICE_DATABASE_URL?.trim();
    assert(databaseUrl, "TINYOFFICE_DATABASE_URL is required for companies admin tests.");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(
        `INSERT INTO operating_events (
  company_id, id, timestamp, actor_member_id, severity, title, message
)
VALUES ($1, 'operating-delete-1', NOW(), 'sam-owner', 'info', 'delete test', 'delete test')`,
        ["support-ops"],
      );
    } finally {
      await pool.end();
    }

    const deleted = await deleteCompany({
      repoRoot,
      companyId: "support-ops",
      confirmation: {
        intent: "DELETE",
      },
    });

    assert.equal(deleted.companyId, "support-ops");
    assert.ok(deleted.viewModel.companies.every((company) => company.companyId !== "support-ops"));
    assert.ok(deleted.viewModel.companies.some((company) => company.companyId === "sales-ops"));

    await assert.rejects(stat(companyEmployeeHomePath({
      repoRoot,
      companyId: "support-ops",
      employeeId: "sam-owner",
    })), /ENOENT/);
    assert.ok((await stat(companyEmployeeHomePath({
      repoRoot,
      companyId: "sales-ops",
      employeeId: "sasha-owner",
    }))).isDirectory());
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("Delete Company fails clearly without confirmation or with active runtime", async () => {
  const repoRoot = await mkdtempRepoRoot("tinyoffice-company-delete-failures-");
  try {
    await createCompany({
      repoRoot,
      companyId: "failure-ops",
      displayName: "Failure Operations",
      hrEmployeeDisplayName: "Fran Owner",
    });

    await assert.rejects(
      deleteCompany({
        repoRoot,
        companyId: "failure-ops",
        confirmation: {
          intent: "delete",
        },
      }),
      /requires confirmation/,
    );

    await assert.rejects(
      deleteCompany({
        repoRoot,
        companyId: "failure-ops",
        confirmation: {
          intent: "DELETE",
        },
        runtime: {
          async ensureSafeToDeleteCompany() {
            throw new Error("runtime is still active");
          },
        },
      }),
      /runtime is still active/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("deleting the last Company returns the lifecycle view to first-create state without a fallback Company", async () => {
  const repoRoot = await mkdtempRepoRoot("tinyoffice-company-delete-last-");
  try {
    await createCompany({
      repoRoot,
      companyId: "solo-ops",
      displayName: "Solo Operations",
      hrEmployeeDisplayName: "Sky Owner",
    });

    await deleteCompany({
      repoRoot,
      companyId: "solo-ops",
      confirmation: {
        intent: "DELETE",
      },
    });

    const viewModel = await loadCompaniesAdminViewModel({ repoRoot });
    assert.ok(viewModel.companies.every((company) => company.companyId !== "solo-ops"));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

async function mkdtempRepoRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}
