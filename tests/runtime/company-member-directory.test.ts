import assert from "node:assert/strict";
import test from "node:test";

import {
  createCompanyMemberProfile,
  findCompanyMemberProfile,
  loadCompanyMemberDirectory,
  projectCompanyMemberRef,
  saveCompanyMemberProfile,
} from "../../src/runtime/members/company-member-directory.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";

class FakeCompanyMemberClient {
  released = false;
  queries: Array<{ sql: string; params?: unknown[] }> = [];

  async query(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    if (/INSERT INTO company_members/.test(sql)) {
      return {
        rows: [{
          id: params?.[1],
          avatar_seed: params?.[1],
          display_name: params?.[2],
          role: params?.[3],
          summary: params?.[4],
        }],
      };
    }
    if (/UPDATE company_members/.test(sql)) {
      return {
        rows: [{
          id: params?.[1],
          avatar_seed: params?.[4],
          display_name: "Xu Ziho",
          role: params?.[2],
          summary: params?.[3],
        }],
      };
    }
    if (!/FROM company_members/.test(sql)) {
      return { rows: [] };
    }
    return {
      rows: [{
        id: "xuziho",
        avatar_seed: "xuziho-avatar",
        display_name: "Xu Ziho",
        role: "boss",
        summary: "Final report target.",
      }],
    };
  }

  release() {
    this.released = true;
  }
}

test("company member directory reads PostgreSQL company members without filesystem fallback", async () => {
  const client = new FakeCompanyMemberClient();
  const directory = await loadCompanyMemberDirectory("C:\\repo\\TinyOffice", {
    env: {
      TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
    },
    companyId: DEFAULT_COMPANY_ID,
    createPostgresPool: () => ({
      async connect() {
        return client;
      },
      async end() {},
    }),
  });

  assert.equal(client.released, true);
  assert.equal(directory.members.length, 1);
  assert.deepEqual(directory.members[0], {
    id: "xuziho",
    avatarSeed: "xuziho-avatar",
    displayName: "Xu Ziho",
    role: "boss",
    summary: "Final report target.",
  });
  assert.equal(Object.hasOwn(directory.members[0]!, "mattermostLoginId"), false);
  assert.doesNotMatch(JSON.stringify(directory.members[0]), /mattermost/i);
  assert.match(client.queries.map((query) => query.sql).join("\n"), /FROM company_members/);
  assert.ok(client.queries.some((query) =>
    /WHERE company_id = \$1/.test(query.sql) &&
    query.params?.[0] === DEFAULT_COMPANY_ID
  ));
  assert.doesNotMatch(
    client.queries.map((query) => query.sql).filter((query) => /SELECT \*/.test(query)).join("\n"),
    /company_participants|company\/participants/,
  );
});

test("company member create inserts only the unified Company member identity", async () => {
  const client = new FakeCompanyMemberClient();
  const member = await createCompanyMemberProfile("C:\\repo\\TinyOffice", {
    env: {
      TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
    },
    companyId: DEFAULT_COMPANY_ID,
    memberId: "mira-ops",
    displayName: "Mira Ops",
    role: "operations",
    summary: "Coordinates office operations.",
    createPostgresPool: () => ({
      async connect() {
        return client;
      },
      async end() {},
    }),
  });

  assert.equal(member.id, "mira-ops");
  assert.equal(member.displayName, "Mira Ops");
  assert.equal(Object.hasOwn(member, "isEmployee"), false);
  assert.equal(Object.hasOwn(member, "employeeId"), false);
  assert.equal(Object.hasOwn(member, "runtimeEnabled"), false);
  assert.equal(Object.hasOwn(member, "lifecycleStatus"), false);
  assert.equal(Object.hasOwn(member, "mattermostLoginId"), false);
  const insertQuery = client.queries.find((query) =>
    /INSERT INTO company_members/.test(query.sql) &&
    /RETURNING \*/.test(query.sql)
  );
  const insertSql = insertQuery?.sql ?? "";
  assert.match(insertSql, /company_id,\s*id,\s*display_name,\s*role,\s*summary,\s*avatar_seed,\s*created_at,\s*updated_at/s);
  assert.doesNotMatch(insertSql, /is_employee|employee_id|runtime_enabled|lifecycle_status|deactivated_at|is_default_requester|is_final_report_target|is_approval_authority|metadata_json|INSERT INTO employees|employee_runtime_configs|employee_resource_policies/);
  assert.deepEqual(insertQuery?.params, [
    DEFAULT_COMPANY_ID,
    "mira-ops",
    "Mira Ops",
    "operations",
    "Coordinates office operations.",
  ]);
});

test("company member profile save updates PostgreSQL company_members truth with explicit company scope", async () => {
  const client = new FakeCompanyMemberClient();
  const member = await saveCompanyMemberProfile("C:\\repo\\TinyOffice", {
    env: {
      TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
    },
    companyId: DEFAULT_COMPANY_ID,
    memberId: "xuziho",
    role: "operations lead",
    summary: "Owns final operations review.",
    createPostgresPool: () => ({
      async connect() {
        return client;
      },
      async end() {},
    }),
  });

  assert.equal(client.released, true);
  assert.equal(member.id, "xuziho");
  assert.equal(member.role, "operations lead");
  assert.equal(member.summary, "Owns final operations review.");
  assert.equal(Object.hasOwn(member, "isDefaultRequester"), false);
  assert.equal(Object.hasOwn(member, "isFinalReportTarget"), false);
  assert.equal(Object.hasOwn(member, "isApprovalAuthority"), false);
  assert.equal(Object.hasOwn(member, "mattermostLoginId"), false);
  assert.ok(client.queries.some((query) =>
    /UPDATE company_members/.test(query.sql) &&
    /WHERE company_id = \$1/.test(query.sql) &&
    /AND id = \$2/.test(query.sql) &&
    query.params?.[0] === DEFAULT_COMPANY_ID &&
    query.params?.[1] === "xuziho"
  ));
  const updateSql = client.queries.find((query) => /UPDATE company_members[\s\S]*SET role = \$3/.test(query.sql))?.sql ?? "";
  assert.doesNotMatch(updateSql, /is_default_requester|is_final_report_target|is_approval_authority|is_employee|employee_id|runtime_enabled|lifecycle_status|deactivated_at|metadata_json|employees|employee_resource_policies/);
});

test("company member directory rejects missing company context", async () => {
  await assert.rejects(
    () => loadCompanyMemberDirectory("C:\\repo\\TinyOffice", {
      env: {
        TINYOFFICE_DATABASE_URL: "postgres://tinyoffice:secret@127.0.0.1:5432/tinyoffice",
      },
      createPostgresPool: () => ({
        async connect() {
          return new FakeCompanyMemberClient();
        },
        async end() {},
      }),
    } as never),
    /companyId is missing/,
  );
});

test("company member profiles still project to scene participant refs", () => {
  const directory = {
    members: [{
      id: "member-mira",
      avatarSeed: "member-mira",
      displayName: "Mira",
      role: "hr",
    }],
  };

  assert.equal(findCompanyMemberProfile(directory, "mira-hr"), undefined);

  const member = findCompanyMemberProfile(directory, "member-mira");
  assert.equal(member?.id, "member-mira");
  assert.deepEqual(projectCompanyMemberRef(member!), {
    id: "member-mira",
    displayName: "Mira",
    role: "hr",
  });
  assert.doesNotMatch(JSON.stringify(projectCompanyMemberRef(member!)), /mattermost/i);
});
