import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemorySystemAiAuditRepository,
  InMemorySystemAiProviderConfigRepository,
  SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
  SYSTEM_AI_CHAT_TITLE_CAPABILITY,
  SystemAiProviderConfigService,
} from "../../src/system-ai/provider-config.js";

const fixedNow = () => "2026-06-28T08:00:00.000Z";

test("System AI provider config requires explicit company-scoped selection and supports disabled state", async () => {
  const service = new SystemAiProviderConfigService({
    repository: new InMemorySystemAiProviderConfigRepository(),
    now: fixedNow,
  });

  await assert.rejects(
    () => service.requireEnabledProviderConfig({
      companyId: "acme",
      capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    }),
    /explicit System AI provider config is required.*no hidden fallback/i,
  );
  await assert.rejects(
    () => service.requireEnabledProviderConfig({
      companyId: "",
      capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    }),
    /companyId is required/,
  );

  const disabled = await service.saveProviderConfig({
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    providerKind: "test_deterministic",
    enabled: false,
    configRef: "system-ai/chat-title/test-disabled",
    modelRef: "deterministic-title-v1",
  });

  assert.equal(disabled.schema, "system-ai-provider-config");
  assert.equal(disabled.companyId, "acme");
  assert.equal(disabled.providerKind, "test_deterministic");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.configVersion, 1);
  assert.equal(disabled.createdAt, fixedNow());
  assert.equal(disabled.updatedAt, fixedNow());
  await assert.rejects(
    () => service.requireEnabledProviderConfig({
      companyId: "acme",
      capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    }),
    /System AI provider config is disabled/,
  );

  const enabled = await service.saveProviderConfig({
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    providerKind: "test_deterministic",
    enabled: true,
    configRef: "system-ai/chat-title/test-enabled",
    modelRef: "deterministic-title-v1",
  });

  assert.equal(enabled.enabled, true);
  assert.equal(enabled.configVersion, 2);
  assert.deepEqual(
    await service.requireEnabledProviderConfig({
      companyId: "acme",
      capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    }),
    enabled,
  );
});

test("System AI provider config supports PI model-backed title generation selection", async () => {
  const service = new SystemAiProviderConfigService({
    repository: new InMemorySystemAiProviderConfigRepository(),
    now: fixedNow,
  });

  const enabled = await service.saveProviderConfig({
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    providerKind: "pi_model",
    enabled: true,
    configRef: "pi-model-registry",
    modelRef: "openai-codex/gpt-5.4-mini",
  });

  assert.equal(enabled.providerKind, "pi_model");
  assert.equal(enabled.configRef, "pi-model-registry");
  assert.equal(enabled.modelRef, "openai-codex/gpt-5.4-mini");
  assert.deepEqual(
    await service.requireEnabledProviderConfig({
      companyId: "acme",
      capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    }),
    enabled,
  );
});

test("System AI provider config treats Chat title and topic summary as separate capabilities", async () => {
  const service = new SystemAiProviderConfigService({
    repository: new InMemorySystemAiProviderConfigRepository(),
    now: fixedNow,
  });

  const title = await service.saveProviderConfig({
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    providerKind: "pi_model",
    enabled: true,
    configRef: "pi-model-registry",
    modelRef: "openai-codex/gpt-5.4-mini",
  });
  const summary = await service.saveProviderConfig({
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
    providerKind: "pi_model",
    enabled: true,
    configRef: "pi-model-registry",
    modelRef: "openai-codex/gpt-5.4-mini",
  });

  assert.equal(title.capability, SYSTEM_AI_CHAT_TITLE_CAPABILITY);
  assert.equal(summary.capability, SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY);
  assert.equal(summary.configVersion, 1);
  assert.deepEqual(
    await service.requireEnabledProviderConfig({
      companyId: "acme",
      capability: SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY,
    }),
    summary,
  );
  assert.deepEqual(
    await service.requireEnabledProviderConfig({
      companyId: "acme",
      capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    }),
    title,
  );
});

test("System AI audit repository records source-backed request lifecycle without runtime identity", async () => {
  const audit = new InMemorySystemAiAuditRepository();

  await audit.recordEvent({
    eventId: "system-ai-audit-1",
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    requestId: "system-ai-request-1",
    source: {
      objectKind: "chat_entry",
      objectId: "chat-entry-topic-1",
      roomId: "conversation-1",
      evidence: [{
        objectKind: "message",
        objectId: "message-1",
      }],
    },
    provider: {
      providerKind: "test_deterministic",
      configRef: "system-ai/chat-title/test-enabled",
      modelRef: "deterministic-title-v1",
      configVersion: 1,
    },
    status: "requested",
    occurredAt: fixedNow(),
  });
  await audit.recordEvent({
    eventId: "system-ai-audit-2",
    companyId: "acme",
    capability: SYSTEM_AI_CHAT_TITLE_CAPABILITY,
    requestId: "system-ai-request-1",
    source: {
      objectKind: "chat_entry",
      objectId: "chat-entry-topic-1",
      roomId: "conversation-1",
      evidence: [{
        objectKind: "message",
        objectId: "message-1",
      }],
    },
    provider: {
      providerKind: "test_deterministic",
      configRef: "system-ai/chat-title/test-enabled",
      modelRef: "deterministic-title-v1",
      configVersion: 1,
    },
    status: "generated",
    occurredAt: fixedNow(),
  });

  const events = await audit.listEvents({
    companyId: "acme",
    requestId: "system-ai-request-1",
  });

  assert.deepEqual(events.map((event) => event.status), ["requested", "generated"]);
  assert.equal(events[0]?.source.objectKind, "chat_entry");
  assert.equal(events[0]?.source.evidence[0]?.objectKind, "message");
  assert.doesNotMatch(JSON.stringify(events), /\b(employeeId|sessionId|workRunId|pi|openai|claude|codex)\b/i);
});
