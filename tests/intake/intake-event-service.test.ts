import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import {
  DbIntakeEventStore,
  IntakeEventService,
} from "../../src/intake/index.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";

function createDeterministicIds() {
  let count = 0;
  return (prefix: string) => {
    count += 1;
    return `${prefix}-${count}`;
  };
}

async function createService() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-intake-"));
  const companyId = path.basename(repoRoot).toLowerCase();
  await createCompany({
    repoRoot,
    companyId,
    displayName: `Intake ${companyId}`,
  });
  const enabledEmployeeIds = new Set(["nora-automation", "iris-growth"]);
  const store = await DbIntakeEventStore.open({
    repoRoot,
    companyId,
  });
  const service = new IntakeEventService({
    repoRoot,
    store,
    validateTargetMemberId: (memberId) => enabledEmployeeIds.has(memberId),
    now: () => "2026-06-05T10:00:00.000Z",
    createId: createDeterministicIds(),
  });
  openServices.push(service);
  return { repoRoot, companyId, service };
}

const openServices: IntakeEventService[] = [];

afterEach(() => {
  while (openServices.length > 0) {
    openServices.pop()?.close();
  }
});
const qualityReportEvent = {
  schemaVersion: "2026-06-05",
  source: "n8n",
  sourceEventId: "website-qa-run-001",
  category: "website.article_audit",
  routing: {
    targetMemberId: "iris-growth",
  },
  priority: "high",
  occurredAt: "2026-06-05T09:58:00.000Z",
  summary: "1 published article is missing a featured image.",
  payload: {
    siteKey: "crystalspiritual",
    reportUrl: "https://reports.example/website-qa-run-001",
    severity: "high",
    sourceWorkflowId: "article_publish_batch",
    sourceRunId: "run-001",
    affectedObjects: [
      {
        kind: "article",
        id: "post-101",
        title: "How to Cleanse Amethyst",
        url: "https://example.test/how-to-cleanse-amethyst",
      },
    ],
    findings: [
      {
        title: "Article is missing featured image",
        description: "Published article has no featured image.",
      },
    ],
  },
};

test("intake event service routes quality-shaped reports as generic inbox evidence", async () => {
  const { service } = await createService();

  const receipt = await service.ingest(qualityReportEvent);

  assert.equal(receipt.status, "processed");
  assert.equal(receipt.category, "website.article_audit");
  assert.equal(receipt.eventType, undefined);
  assert.equal(receipt.result?.kind, "intake_event_routed");
  assert.equal(receipt.result?.targetMemberId, "iris-growth");
});

test("intake event service is idempotent by category source and source event id", async () => {
  const { service } = await createService();

  const first = await service.ingest(qualityReportEvent);
  const second = await service.ingest(qualityReportEvent);

  assert.equal(first.status, "processed");
  assert.equal(second.status, "duplicate");
  assert.equal(second.eventId, first.eventId);
  assert.equal(second.result?.kind, "intake_event_routed");
});

test("intake event service keeps category as classification and routes only by target member", async () => {
  const { service } = await createService();

  const receipt = await service.ingest({
    ...qualityReportEvent,
    category: "comms",
  });

  assert.equal(receipt.status, "processed");
  assert.equal(receipt.category, "comms");
  assert.equal(receipt.result?.kind, "intake_event_routed");
  assert.equal(receipt.result?.category, "comms");
  assert.equal(receipt.result?.targetMemberId, "iris-growth");
});

test("intake event service can route generic external information", async () => {
  const { service } = await createService();

  const receipt = await service.ingest({
    schemaVersion: "2026-06-08",
    source: "website-monitor",
    sourceEventId: "monitor-001",
    category: "website.article_audit",
    routing: {
      targetMemberId: "nora-automation",
    },
    summary: "Article audit completed with no actionable findings.",
    payload: {
      reportUrl: "https://reports.example/monitor-001",
      status: "ok",
    },
  });

  assert.equal(receipt.status, "processed");
  assert.equal(receipt.result?.kind, "intake_event_routed");
  assert.equal(receipt.result?.targetMemberId, "nora-automation");
});

test("intake event service rejects missing explicit target member", async () => {
  const { service } = await createService();

  await assert.rejects(
    () => service.ingest({
      ...qualityReportEvent,
      routing: undefined,
    }),
    /routing.targetMemberId is required/,
  );
});

test("intake event service rejects unknown explicit target member", async () => {
  const { service } = await createService();

  await assert.rejects(
    () => service.ingest({
      ...qualityReportEvent,
      routing: {
        targetMemberId: "unknown-member",
      },
    }),
    /routing.targetMemberId unknown-member is not an enabled member/,
  );
});

test("intake event service rejects disabled explicit target member", async () => {
  const { service } = await createService();

  await assert.rejects(
    () => service.ingest({
      ...qualityReportEvent,
      routing: {
        targetMemberId: "disabled-member",
      },
    }),
    /routing.targetMemberId disabled-member is not an enabled member/,
  );
});

test("intake event service persists routed events under the selected company", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-intake-company-"));
  const idPrefix = path.basename(repoRoot).toLowerCase();
  const primaryCompanyId = `${idPrefix}-primary`;
  const otherCompanyId = `${idPrefix}-support`;
  await createCompany({
    repoRoot,
    companyId: primaryCompanyId,
    displayName: "Primary Intake",
  });
  await createCompany({
    repoRoot,
    companyId: otherCompanyId,
    displayName: "Support Intake",
  });
  const defaultStore = await DbIntakeEventStore.open({
    repoRoot,
    companyId: primaryCompanyId,
  });
  const otherStore = await DbIntakeEventStore.open({
    repoRoot,
    companyId: otherCompanyId,
  });
  const defaultService = new IntakeEventService({
    repoRoot,
    store: defaultStore,
    validateTargetMemberId: (memberId) => memberId === "iris-growth",
    now: () => "2026-06-05T10:00:00.000Z",
    createId: () => "intake-event-shared",
  });
  const otherService = new IntakeEventService({
    repoRoot,
    store: otherStore,
    validateTargetMemberId: (memberId) => memberId === "iris-growth",
    now: () => "2026-06-05T10:01:00.000Z",
    createId: () => "intake-event-shared",
  });
  openServices.push(defaultService, otherService);

  await defaultService.ingest({
    ...qualityReportEvent,
    summary: "Default company report.",
  });
  await otherService.ingest({
    ...qualityReportEvent,
    summary: "Support company report.",
  });

  assert.deepEqual(
    (await defaultStore.load()).events.map((event) => event.input.summary),
    ["Default company report."],
  );
  assert.deepEqual(
    (await otherStore.load()).events.map((event) => event.input.summary),
    ["Support company report."],
  );
});

test("intake event service preserves category-specific payloads without shape validation", async () => {
  const { service } = await createService();

  const receipt = await service.ingest({
    ...qualityReportEvent,
    payload: {
      siteKey: "crystalspiritual",
      findings: [],
    },
  });

  assert.equal(receipt.status, "processed");
  assert.equal(receipt.result?.kind, "intake_event_routed");
});

test("Postgres intake store normalizes database timestamps before replaying events", async () => {
  const { service, repoRoot, companyId } = await createService();

  await service.ingest(qualityReportEvent);
  service.close();

  const reopenedStore = await DbIntakeEventStore.open({ repoRoot, companyId });
  const reopenedService = new IntakeEventService({
    repoRoot,
    store: reopenedStore,
    validateTargetMemberId: () => true,
    now: () => "2026-06-05T10:01:00.000Z",
    createId: (prefix) => `${prefix}-reopened-1`,
  });
  openServices.push(reopenedService);

  const receipt = await reopenedService.ingest({
    ...qualityReportEvent,
    sourceEventId: "website-qa-run-002",
  });

  assert.equal(receipt.status, "processed");
  const state = await reopenedStore.load();
  assert.match(state.events[0]!.receivedAt, /^2026-06-05T10:00:00\.000Z$/);
  assert.match(state.events[0]!.input.occurredAt || "", /^2026-06-05T09:58:00\.000Z$/);
});
