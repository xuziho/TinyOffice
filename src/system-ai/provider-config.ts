export const SYSTEM_AI_CHAT_TITLE_CAPABILITY = "chat_title_generation" as const;
export const SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY = "chat_topic_summary" as const;

export type SystemAiCapability =
  | typeof SYSTEM_AI_CHAT_TITLE_CAPABILITY
  | typeof SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY;
export type SystemAiProviderKind = "test_deterministic" | "pi_model";
export type SystemAiAuditStatus = "requested" | "generated" | "failed";

export interface SystemAiProviderConfigRecord {
  schema: "system-ai-provider-config";
  version: 1;
  companyId: string;
  capability: SystemAiCapability;
  providerKind: SystemAiProviderKind;
  enabled: boolean;
  configRef?: string;
  modelRef?: string;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SystemAiProviderConfigInput {
  companyId: string;
  capability: SystemAiCapability;
  providerKind: SystemAiProviderKind;
  enabled: boolean;
  configRef?: string;
  modelRef?: string;
}

export interface SystemAiProviderConfigLookup {
  companyId: string;
  capability: SystemAiCapability;
}

export interface SystemAiProviderConfigRepository {
  getProviderConfig(input: SystemAiProviderConfigLookup): Promise<SystemAiProviderConfigRecord | undefined>;
  saveProviderConfig(record: SystemAiProviderConfigRecord): Promise<SystemAiProviderConfigRecord>;
}

export interface SystemAiProviderConfigResolver {
  requireEnabledProviderConfig(input: SystemAiProviderConfigLookup): Promise<SystemAiProviderConfigRecord>;
}

export interface SystemAiAuditSourceEvidence {
  objectKind: "message";
  objectId: string;
}

export interface SystemAiAuditSource {
  objectKind: "chat_entry" | "conversation_topic";
  objectId: string;
  roomId: string;
  evidence: SystemAiAuditSourceEvidence[];
}

export interface SystemAiAuditProviderReference {
  providerKind: SystemAiProviderKind;
  configRef?: string;
  modelRef?: string;
  configVersion: number;
}

export interface SystemAiAuditEvent {
  eventId: string;
  companyId: string;
  capability: SystemAiCapability;
  requestId: string;
  source: SystemAiAuditSource;
  provider?: SystemAiAuditProviderReference;
  status: SystemAiAuditStatus;
  errorReason?: string;
  occurredAt: string;
}

export interface SystemAiAuditEventListInput {
  companyId: string;
  requestId?: string;
  capability?: SystemAiCapability;
}

export interface SystemAiAuditRepository {
  recordEvent(event: SystemAiAuditEvent): Promise<SystemAiAuditEvent>;
  listEvents(input: SystemAiAuditEventListInput): Promise<SystemAiAuditEvent[]>;
}

function trimRequired(value: string | undefined, fieldName: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function providerConfigKey(companyId: string, capability: SystemAiCapability): string {
  return `${companyId}\0${capability}`;
}

function assertCapability(capability: SystemAiCapability): SystemAiCapability {
  if (
    capability !== SYSTEM_AI_CHAT_TITLE_CAPABILITY &&
    capability !== SYSTEM_AI_CHAT_TOPIC_SUMMARY_CAPABILITY
  ) {
    throw new Error(`unsupported System AI capability: ${String(capability)}`);
  }
  return capability;
}

function assertProviderKind(providerKind: SystemAiProviderKind): SystemAiProviderKind {
  if (providerKind !== "test_deterministic" && providerKind !== "pi_model") {
    throw new Error(`unsupported System AI provider kind: ${String(providerKind)}`);
  }
  return providerKind;
}

function cloneProviderConfig(record: SystemAiProviderConfigRecord): SystemAiProviderConfigRecord {
  return { ...record };
}

function cloneAuditEvent(event: SystemAiAuditEvent): SystemAiAuditEvent {
  return {
    ...event,
    source: {
      ...event.source,
      evidence: event.source.evidence.map((item) => ({ ...item })),
    },
    provider: event.provider ? { ...event.provider } : undefined,
  };
}

export class InMemorySystemAiProviderConfigRepository implements SystemAiProviderConfigRepository {
  private readonly configs = new Map<string, SystemAiProviderConfigRecord>();

  async getProviderConfig(input: SystemAiProviderConfigLookup): Promise<SystemAiProviderConfigRecord | undefined> {
    const companyId = trimRequired(input.companyId, "companyId");
    const capability = assertCapability(input.capability);
    const record = this.configs.get(providerConfigKey(companyId, capability));
    return record ? cloneProviderConfig(record) : undefined;
  }

  async saveProviderConfig(record: SystemAiProviderConfigRecord): Promise<SystemAiProviderConfigRecord> {
    const normalized = normalizeProviderConfigRecord(record);
    this.configs.set(providerConfigKey(normalized.companyId, normalized.capability), cloneProviderConfig(normalized));
    return cloneProviderConfig(normalized);
  }
}

export class SystemAiProviderConfigService implements SystemAiProviderConfigResolver {
  private readonly repository: SystemAiProviderConfigRepository;
  private readonly now: () => string;

  constructor(config: {
    repository: SystemAiProviderConfigRepository;
    now?: () => string;
  }) {
    this.repository = config.repository;
    this.now = config.now || (() => new Date().toISOString());
  }

  async saveProviderConfig(input: SystemAiProviderConfigInput): Promise<SystemAiProviderConfigRecord> {
    const companyId = trimRequired(input.companyId, "companyId");
    const capability = assertCapability(input.capability);
    const existing = await this.repository.getProviderConfig({ companyId, capability });
    const timestamp = this.now();
    return await this.repository.saveProviderConfig({
      schema: "system-ai-provider-config",
      version: 1,
      companyId,
      capability,
      providerKind: assertProviderKind(input.providerKind),
      enabled: input.enabled,
      configRef: optionalTrimmed(input.configRef),
      modelRef: optionalTrimmed(input.modelRef),
      configVersion: (existing?.configVersion ?? 0) + 1,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });
  }

  async requireEnabledProviderConfig(input: SystemAiProviderConfigLookup): Promise<SystemAiProviderConfigRecord> {
    const companyId = trimRequired(input.companyId, "companyId");
    const capability = assertCapability(input.capability);
    const config = await this.repository.getProviderConfig({ companyId, capability });
    if (!config) {
      throw new Error(`explicit System AI provider config is required for ${companyId}/${capability}; no hidden fallback is allowed`);
    }
    if (!config.enabled) {
      throw new Error(`System AI provider config is disabled for ${companyId}/${capability}`);
    }
    return config;
  }
}

export class InMemorySystemAiAuditRepository implements SystemAiAuditRepository {
  private readonly events: SystemAiAuditEvent[] = [];

  async recordEvent(event: SystemAiAuditEvent): Promise<SystemAiAuditEvent> {
    const normalized = normalizeAuditEvent(event);
    this.events.push(cloneAuditEvent(normalized));
    return cloneAuditEvent(normalized);
  }

  async listEvents(input: SystemAiAuditEventListInput): Promise<SystemAiAuditEvent[]> {
    const companyId = trimRequired(input.companyId, "companyId");
    return this.events
      .filter((event) =>
        event.companyId === companyId &&
        (input.requestId === undefined || event.requestId === input.requestId) &&
        (input.capability === undefined || event.capability === input.capability)
      )
      .map(cloneAuditEvent);
  }
}

function normalizeProviderConfigRecord(record: SystemAiProviderConfigRecord): SystemAiProviderConfigRecord {
  return {
    schema: "system-ai-provider-config",
    version: 1,
    companyId: trimRequired(record.companyId, "companyId"),
    capability: assertCapability(record.capability),
    providerKind: assertProviderKind(record.providerKind),
    enabled: record.enabled,
    configRef: optionalTrimmed(record.configRef),
    modelRef: optionalTrimmed(record.modelRef),
    configVersion: record.configVersion,
    createdAt: trimRequired(record.createdAt, "createdAt"),
    updatedAt: trimRequired(record.updatedAt, "updatedAt"),
  };
}

function normalizeAuditEvent(event: SystemAiAuditEvent): SystemAiAuditEvent {
  const errorReason = optionalTrimmed(event.errorReason);
  return {
    eventId: trimRequired(event.eventId, "eventId"),
    companyId: trimRequired(event.companyId, "companyId"),
    capability: assertCapability(event.capability),
    requestId: trimRequired(event.requestId, "requestId"),
    source: {
      objectKind: event.source.objectKind === "conversation_topic" ? "conversation_topic" : "chat_entry",
      objectId: trimRequired(event.source.objectId, "source.objectId"),
      roomId: trimRequired(event.source.roomId, "source.roomId"),
      evidence: event.source.evidence.map((item) => ({
        objectKind: "message" as const,
        objectId: trimRequired(item.objectId, "source.evidence.objectId"),
      })),
    },
    provider: event.provider
      ? {
        providerKind: assertProviderKind(event.provider.providerKind),
        configRef: optionalTrimmed(event.provider.configRef),
        modelRef: optionalTrimmed(event.provider.modelRef),
        configVersion: event.provider.configVersion,
      }
      : undefined,
    status: event.status,
    errorReason,
    occurredAt: trimRequired(event.occurredAt, "occurredAt"),
  };
}
