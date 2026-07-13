import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { OperatingLogService } from "../../src/operating-log/index.js";

async function createFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-oplog-"));
  const companyId = DEFAULT_COMPANY_ID;
  const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId });
  try {
    await directory.upsertEmployee({
      employeeId: "nora-automation",
      enabled: true,
      profile: {
        employeeId: "nora-automation",
        displayName: "Nora",
        role: "automation",
        presenceMode: "resident",
        mountedActions: [],
      },
      permissions: [{ actionName: "finish_intake_turn", decision: "allow" }],
      runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
    });
    await directory.save();
  } finally {
    directory.close();
  }
  return {
    repoRoot,
    companyId,
    service: new OperatingLogService({
      repoRoot,
      companyId,
      now: () => "2026-06-08T00:00:00.000Z",
      createId: (prefix: string) => `${prefix}-001`,
    }),
  };
}

test("operating log service records durable no-task events", async () => {
  const { service } = await createFixture();

  const event = await service.recordEvent({
    actorMemberId: "nora-automation",
    category: "website.article_audit",
    severity: "success",
    title: "Article audit had no actionable issues",
    message: "The incoming report was reviewed and does not need a task.",
    sourceIntakeEventId: "intake-event-001",
  });
  const events = await service.listEvents({ category: "website.article_audit" });

  assert.equal(event.id, "op-event-001");
  assert.equal(event.actorMemberId, "nora-automation");
  assert.equal(event.severity, "success");
  assert.equal(event.source.intakeEventId, "intake-event-001");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.title, "Article audit had no actionable issues");
});

test("operating log service defaults severity and validates required text", async () => {
  const { service } = await createFixture();

  await assert.rejects(
    () => service.recordEvent({
      actorMemberId: "nora-automation",
      title: "",
      message: "Reviewed.",
    }),
    /title is required/,
  );

  const event = await service.recordEvent({
    actorMemberId: "nora-automation",
    title: "Monitor completed",
    message: "No action needed.",
  });

  assert.equal(event.severity, "info");
});
