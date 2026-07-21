import type { PostgresPoolLike } from "../company-config/postgres-company-database.js";
import { normalizeCompanyId } from "../company-config/company-paths.js";
import {
  resolveRuntimeDatabaseConfig,
  type RuntimeDatabaseConfigEnv,
} from "../company-config/company-database-config.js";
import { runPostgresSchemaMigrations } from "../company-config/postgres-company-database.js";
import {
  DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS,
  DEFAULT_POSTGRES_QUERY_TIMEOUT_MS,
  endCompanyPostgresPool,
  PostgresConnectionUnavailableError,
} from "../company-config/postgres-runtime-connection.js";
import type { ProcessTraceEvent } from "../contracts/process-trace-event.js";
import { PostgresRuntimeSessionRepository } from "./postgres-runtime-session-repository.js";

export type RuntimeSessionStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "canceled";

export interface RuntimeStorageRetentionPolicy {
  keepSessionDays: number;
  maxSessionRecords: number;
  maxSessionEvents: number;
  maxEventPreviewBytes: number;
  maxEventPayloadBytes: number;
}

export const DEFAULT_RUNTIME_STORAGE_RETENTION_POLICY: RuntimeStorageRetentionPolicy = {
  keepSessionDays: 30,
  maxSessionRecords: 3000,
  maxSessionEvents: 500000,
  maxEventPreviewBytes: 8192,
  maxEventPayloadBytes: 262144,
};

export type RuntimeSessionMetadataState =
  | "recorded"
  | "not_recorded"
  | "not_observed"
  | "derived_from_events"
  | "partial";

export interface RuntimeSessionMetadataField {
  state: RuntimeSessionMetadataState;
  value?: string;
  source?: string;
  diagnostic?: string;
}

export interface RuntimeSessionToolsMetadata {
  state: RuntimeSessionMetadataState;
  source?: string;
  loadedToolNames?: string[];
  loadedSkillNames?: string[];
  activeToolNames?: string[];
  diagnostic?: string;
}

export interface RuntimeSessionModelMetadata {
  state: RuntimeSessionMetadataState;
  provider?: string;
  id?: string;
  source?: string;
  diagnostic?: string;
}

export interface RuntimeSessionMetadata {
  model?: RuntimeSessionModelMetadata;
  cwd?: RuntimeSessionMetadataField;
  tools?: RuntimeSessionToolsMetadata;
}

export interface RuntimeSessionRecord {
  id: string;
  employeeId: string;
  sessionKey: string;
  sessionId: string;
  sceneType: string;
  channelTopicId?: string;
  workRunId?: string;
  requesterId?: string;
  modelProvider?: string;
  modelId?: string;
  runtimeMetadata?: RuntimeSessionMetadata;
  status: RuntimeSessionStatus;
  title?: string;
  summary?: string;
  startedAt: string;
  updatedAt: string;
  eventCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolResultCount: number;
  tokenInputTotal: number;
  tokenOutputTotal: number;
  tokenCacheTotal: number;
  byteSize: number;
  truncated: boolean;
}

export interface RuntimeSessionEvent {
  id: string;
  sessionRecordId: string;
  sequence: number;
  timestamp: string;
  kind: string;
  role?: string;
  sceneId?: string;
  turnId?: string;
  runId?: string;
  modelCallId?: string;
  source?: string;
  visibility?: "user_visible" | "model_input" | "diagnostic" | "prompt_context" | "raw_evidence";
  semanticRole?: string;
  rawEventKind?: string;
  title?: string;
  summary?: string;
  preview?: string;
  payload?: Record<string, unknown>;
  byteSize: number;
  truncated: boolean;
}

export interface CollaborationActionEvent {
  id: string;
  timestamp: string;
  employeeId: string;
  actionName: string;
  channelTopicId?: string;
  workRunId?: string;
  status?: string;
  recipientId?: string;
  message?: string;
  progressSummary?: string;
  decision?: string;
  emitted: boolean;
  suppressedReason?: string;
  payload?: Record<string, unknown>;
}

export interface MemorySummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  scopeKind: string;
  scopeId: string;
  employeeId?: string;
  sourceKind: string;
  sourceId: string;
  category: string;
  title: string;
  summary: string;
  importance: number;
  lastAccessedAt?: string;
  expiresAt?: string;
  embeddingStatus: string;
  embeddingRef?: string;
}

export interface RetentionState {
  id: string;
  policy: RuntimeStorageRetentionPolicy;
  lastCleanupAt?: string;
  deletedSessionCount: number;
  deletedEventCount: number;
  lastVacuumAt?: string;
  updatedAt: string;
}

export interface RuntimeStorageCleanupResult {
  state: RetentionState;
  deletedSessionCount: number;
  deletedEventCount: number;
}

export interface RuntimeSessionRepositoryLike {
  upsertSessionRecord(input: Parameters<PostgresRuntimeSessionRepository["upsertSessionRecord"]>[0]): RuntimeSessionRecord;
  appendSessionEvent(input: Parameters<PostgresRuntimeSessionRepository["appendSessionEvent"]>[0]): RuntimeSessionEvent;
  getSessionRecord(id: string): RuntimeSessionRecord | undefined;
  getSessionDetail(id: string): { record: RuntimeSessionRecord; events: RuntimeSessionEvent[] } | undefined;
  listSessionRecords(input?: Parameters<PostgresRuntimeSessionRepository["listSessionRecords"]>[0]): RuntimeSessionRecord[];
  listSessionEvents(sessionRecordId: string): RuntimeSessionEvent[];
  appendProcessTraceEvent(input: ProcessTraceEvent): ProcessTraceEvent;
  listProcessTraceEvents(input?: Parameters<PostgresRuntimeSessionRepository["listProcessTraceEvents"]>[0]): ProcessTraceEvent[];
  appendCollaborationActionEvent(input: CollaborationActionEvent): CollaborationActionEvent;
  listCollaborationActionEvents(input?: Parameters<PostgresRuntimeSessionRepository["listCollaborationActionEvents"]>[0]): CollaborationActionEvent[];
  upsertMemorySummary(input: MemorySummary): MemorySummary;
  listMemorySummaries(input?: Parameters<PostgresRuntimeSessionRepository["listMemorySummaries"]>[0]): MemorySummary[];
  upsertRetentionState(input: Parameters<PostgresRuntimeSessionRepository["upsertRetentionState"]>[0]): RetentionState;
  getRetentionState(id: string): RetentionState | undefined;
  cleanupRuntimeStorage(input?: Parameters<PostgresRuntimeSessionRepository["cleanupRuntimeStorage"]>[0]): RuntimeStorageCleanupResult;
  save(): Promise<void>;
  close(): void;
}

export interface RuntimeSessionRepositoryOpenOptions {
  companyId?: string;
  env?: RuntimeDatabaseConfigEnv;
  createPostgresPool?: (databaseUrl: string) => PostgresPoolLike & {
    end?(): Promise<void>;
  };
}

async function createDefaultPostgresPool(databaseUrl: string) {
  const pg = await import("pg");
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    allowExitOnIdle: true,
    max: 1,
    idleTimeoutMillis: 10,
    connectionTimeoutMillis: DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS,
    query_timeout: DEFAULT_POSTGRES_QUERY_TIMEOUT_MS,
    statement_timeout: DEFAULT_POSTGRES_QUERY_TIMEOUT_MS,
  }) as PostgresPoolLike & {
    end?(): Promise<void>;
  };
  return pool;
}

export class RuntimeSessionRepository {
  static async open(
    repoRoot: string,
    options: RuntimeSessionRepositoryOpenOptions = {},
  ): Promise<RuntimeSessionRepositoryLike> {
    const companyId = normalizeCompanyId(options.companyId);
    const config = resolveRuntimeDatabaseConfig(options.env, repoRoot);
    const postgresUrl = config.postgresUrl as string;
    const pool = options.createPostgresPool
      ? options.createPostgresPool(postgresUrl)
      : await createDefaultPostgresPool(postgresUrl);
    let client: Awaited<ReturnType<typeof pool.connect>>;
    try {
      client = await pool.connect();
    } catch (error) {
      await endCompanyPostgresPool(pool);
      throw new PostgresConnectionUnavailableError(error);
    }
    try {
      await runPostgresSchemaMigrations(client);
      return await PostgresRuntimeSessionRepository.open({ client, pool, companyId });
    } catch (error) {
      client.release();
      await endCompanyPostgresPool(pool);
      throw error;
    }
  }
}
