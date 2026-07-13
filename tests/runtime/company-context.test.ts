import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

import {
  resolveExplicitCompanyContext,
} from "../../src/runtime/company-config/company-context.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { resetRuntimePostgresTables, waitForRuntimePostgresCleanup } from "./postgres-test-utils.js";

beforeEach(resetRuntimePostgresTables);
after(waitForRuntimePostgresCleanup);

test("resolves an explicit Company id without carrier fallback", async () => {
  const resolved = await resolveExplicitCompanyContext({
    repoRoot: process.cwd(),
    companyId: DEFAULT_COMPANY_ID,
  });

  assert.deepEqual(resolved, {
    ok: true,
    companyId: DEFAULT_COMPANY_ID,
    source: "explicit_company_id",
  });
});

test("rejects missing Company context without default-company fallback", async () => {
  const resolved = await resolveExplicitCompanyContext({
    repoRoot: process.cwd(),
  });

  assert.deepEqual(resolved, {
    ok: false,
    code: "missing_company_context",
    statusCode: 400,
    message: "TinyOffice API company context requires explicit companyId.",
  });
});

test("returns setup state for an unknown explicit Company id", async () => {
  const resolved = await resolveExplicitCompanyContext({
    repoRoot: process.cwd(),
    companyId: "unknown-company",
  });

  assert.deepEqual(resolved, {
    ok: false,
    code: "unknown_company",
    statusCode: 404,
    message: "Company unknown-company was not found.",
    setup: {
      required: true,
      reason: "company_not_found",
      companyId: "unknown-company",
    },
  });
});
