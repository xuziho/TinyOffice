import assert from "node:assert/strict";
import test from "node:test";

import { PostgresSystemAiAuditRepository, PostgresSystemAiProviderConfigRepository } from "../../src/system-ai/postgres-system-ai-repository.js";
import { SYSTEM_AI_CHAT_TITLE_CAPABILITY } from "../../src/system-ai/provider-config.js";
import type { CompanyPostgresClient } from "../../src/runtime/company-config/postgres-runtime-connection.js";

class FakePostgresClient implements CompanyPostgresClient {
  readonly configs = new Map<string, Record<string, unknown>>();
  readonly events: Record<string, unknown>[] = [];
  released = false;

  async query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> {
    if (/INSERT INTO system_ai_provider_configs/.test(sql)) {
      const row = {
        company_id: params?.[0],
        capability: params?.[1],
        provider_kind: params?.[2],
        enabled: params?.[3],
        config_ref: params?.[4],
        model_ref: params?.[5],
        config_version: params?.[6],
        created_at: params?.[7],
        updated_at: params?.[8],
      };
      this.configs.set(`${row.company_id}\0${row.capability}`, row);
      return { rows: [row as Row] };
    }
    if (/SELECT .*FROM system_ai_provider_configs/s.test(sql)) {
      const row = this.configs.get(`${params?.[0]}\0${params?.[1]}`);
      return { rows: row ? [row as Row] : [] };
    }
    if (/INSERT INTO system_ai_audit_events/.test(sql)) {
      const row = {
        company_id: params?.[0],
        event_id: params?.[1],
        capability: params?.[2],
        request_id: params?.[3],
        source_json: params?.[4],
        provider_json: params?.[5],
        status: params?.[6],
        error_reason: params?.[7],
        occurred_at: params?.[8],
      };
      this.events.push(row);
      return { rows: [row as Row] };
    }
    if (/SELECT .*FROM system_ai_audit_events/s.test(sql)) {
      return {
        rows: this.events.filter((event) =>
          event.company_id === params?.[0] &&
          (params?.[1] === null || event.request_id === params?.[1]) &&
          (params?.[2] === null || event.capability === params?.[2])
        ) as Row[],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  release(): void {
    this.released = true;
  }
}

test("Postgres System AI repositories persist provider config and source-backed audit events", async () => {
  const client = new FakePostgresClient();
  const configRepository = new PostgresSystemAiProviderConfigRepository(client);
  const auditRepository = new PostgresSystemAiAuditRepository(client);

  await configRepository.saveProviderConfig({
    schema: "system-ai-provider-config",
    version: 1,
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    providerKind: "pi_model",
    enabled: true,
    configRef: "pi-model-registry",
    modelRef: "openai-codex/gpt-5.4-mini",
    configVersion: 1,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
  });

  assert.deepEqual(await configRepository.getProviderConfig({
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
  }), {
    schema: "system-ai-provider-config",
    version: 1,
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    providerKind: "pi_model",
    enabled: true,
    configRef: "pi-model-registry",
    modelRef: "openai-codex/gpt-5.4-mini",
    configVersion: 1,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
  });

  await auditRepository.recordEvent({
    eventId: "system-ai-audit-1",
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    requestId: "system-ai-request-1",
    source: {
      objectKind: "chat_entry",
      objectId: "entry-1",
      roomId: "conversation-1",
      evidence: [{ objectKind: "message", objectId: "message-1" }],
    },
    provider: {
      providerKind: "pi_model",
      configRef: "pi-model-registry",
      modelRef: "openai-codex/gpt-5.4-mini",
      configVersion: 1,
    },
    status: "generated",
    occurredAt: "2026-07-01T10:00:01.000Z",
  });

  const events = await auditRepository.listEvents({
    companyId: "acme",
    requestId: "system-ai-request-1",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.provider?.providerKind, "pi_model");
  assert.equal(events[0]?.source.evidence[0]?.objectId, "message-1");
});
