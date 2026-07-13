import type { IntakeEventStore } from "./intake-event-store.js";
import type {
  IntakeEventInput,
  IntakeEventRecord,
  IntakeEventState,
  IntakeProcessingResult,
} from "./domain.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresPoolLike,
} from "../runtime/company-config/postgres-runtime-connection.js";
import { releaseCompanyPostgresConnection } from "../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../runtime/company-config/company-paths.js";

function parseJson<T>(value: unknown): T | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

function timestampValue(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return String(value);
}

function inputFromRow(row: Record<string, unknown>): IntakeEventInput {
  return {
    schemaVersion: String(row.schema_version),
    source: String(row.source),
    sourceEventId: String(row.source_event_id),
    category: String(row.category),
    eventType: typeof row.event_type === "string" && row.event_type ? row.event_type : undefined,
    routing: parseJson(row.routing_json),
    priority: typeof row.priority === "string" && row.priority ? row.priority as IntakeEventInput["priority"] : undefined,
    occurredAt: timestampValue(row.occurred_at),
    summary: typeof row.summary === "string" && row.summary ? row.summary : undefined,
    payload: parseJson(row.payload_json) ?? null,
    metadata: parseJson(row.metadata_json),
  };
}

function recordFromRow(row: Record<string, unknown>): IntakeEventRecord {
  return {
    id: String(row.id),
    receivedAt: timestampValue(row.received_at) || "",
    processedAt: timestampValue(row.processed_at),
    status: String(row.status) as IntakeEventRecord["status"],
    input: inputFromRow(row),
    result: parseJson<IntakeProcessingResult>(row.result_json),
    error: typeof row.error === "string" && row.error ? row.error : undefined,
  };
}

function eventKey(event: IntakeEventRecord): string {
  return [
    event.input.category,
    event.input.source,
    event.input.sourceEventId,
  ].join("|");
}

export class PostgresIntakeEventStore implements IntakeEventStore {
  private updateChain: Promise<unknown> = Promise.resolve();
  private pendingWrites: Promise<unknown> = Promise.resolve();
  private pendingWriteCount = 0;
  private closed = false;

  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
    private events: IntakeEventRecord[],
  ) {}

  static async open(input: {
    client: CompanyPostgresClient;
    pool: CompanyPostgresPoolLike;
    companyId: string;
  }): Promise<PostgresIntakeEventStore> {
    const companyId = normalizeCompanyId(input.companyId);
    const rows = await input.client.query(
      "SELECT * FROM intake_events WHERE company_id = $1 ORDER BY received_at ASC, id ASC",
      [companyId],
    );
    const store = new PostgresIntakeEventStore(
      input.client,
      input.pool,
      companyId,
      rows.rows.map(recordFromRow),
    );
    return store;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const release = () => releaseCompanyPostgresConnection({ client: this.client, pool: this.pool });
    if (this.pendingWriteCount === 0) {
      void release();
      return;
    }
    void this.pendingWrites
      .finally(release)
      .catch(() => undefined);
  }

  async load(): Promise<IntakeEventState> {
    return { events: [...this.events] };
  }

  async save(state: IntakeEventState): Promise<void> {
    this.events = [...state.events];
    this.queueQuery("DELETE FROM intake_events WHERE company_id = $1", [this.companyId]);
    for (const event of this.events) {
      this.queueUpsertEvent(event);
    }
    await this.pendingWrites;
  }

  async update<T>(
    updater: (state: IntakeEventState) => Promise<T> | T,
  ): Promise<T> {
    const run = async () => {
      const state = await this.load();
      const result = await updater(state);
      await this.save(state);
      return result;
    };
    const next = this.updateChain.then(run, run);
    this.updateChain = next.then(() => undefined, () => undefined);
    return next;
  }

  private queueUpsertEvent(event: IntakeEventRecord): void {
    this.queueQuery(
      `INSERT INTO intake_events (
  company_id, id, schema_version, source, source_event_id, category, event_type,
  routing_json, priority, occurred_at, received_at, processed_at, status,
  summary, payload_json, metadata_json, result_json, error
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
ON CONFLICT (company_id, category, source, source_event_id) DO UPDATE SET
  id = EXCLUDED.id,
  schema_version = EXCLUDED.schema_version,
  event_type = EXCLUDED.event_type,
  routing_json = EXCLUDED.routing_json,
  priority = EXCLUDED.priority,
  occurred_at = EXCLUDED.occurred_at,
  received_at = EXCLUDED.received_at,
  processed_at = EXCLUDED.processed_at,
  status = EXCLUDED.status,
  summary = EXCLUDED.summary,
  payload_json = EXCLUDED.payload_json,
  metadata_json = EXCLUDED.metadata_json,
  result_json = EXCLUDED.result_json,
  error = EXCLUDED.error`,
      [
        this.companyId,
        event.id,
        event.input.schemaVersion,
        event.input.source,
        event.input.sourceEventId,
        event.input.category,
        event.input.eventType ?? null,
        event.input.routing ?? null,
        event.input.priority ?? null,
        event.input.occurredAt ?? null,
        event.receivedAt,
        event.processedAt ?? null,
        event.status,
        event.input.summary ?? null,
        event.input.payload ?? {},
        event.input.metadata ?? null,
        event.result ?? null,
        event.error ?? null,
      ],
    );
  }

  private queueQuery(sql: string, params?: readonly unknown[]) {
    this.pendingWriteCount += 1;
    this.pendingWrites = this.pendingWrites
      .then(() => this.client.query(sql, params))
      .finally(() => {
        this.pendingWriteCount -= 1;
      });
  }
}
