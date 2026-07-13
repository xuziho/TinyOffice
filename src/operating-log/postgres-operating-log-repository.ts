import { releaseCompanyPostgresConnection } from "../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../runtime/company-config/company-paths.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresPoolLike,
} from "../runtime/company-config/postgres-runtime-connection.js";
import type {
  OperatingEventRecord,
  OperatingEventSeverity,
} from "./domain.js";

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function eventFromRow(row: Record<string, unknown>): OperatingEventRecord {
  return {
    id: String(row.id),
    timestamp: String(row.timestamp),
    actorMemberId: String(row.actor_member_id),
    category: optional(row.domain),
    severity: String(row.severity) as OperatingEventSeverity,
    title: String(row.title),
    message: String(row.message),
    source: {
      intakeEventId: optional(row.source_intake_event_id),
      kind: optional(row.source_kind),
      id: optional(row.source_id),
    },
    metadata: jsonObject(row.metadata_json),
  };
}

function byTimestampDesc(left: OperatingEventRecord, right: OperatingEventRecord) {
  return right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id);
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
}

export class PostgresOperatingLogRepository {
  private pendingWrites: Promise<unknown> = Promise.resolve();
  private pendingWriteCount = 0;
  private closed = false;

  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
    private readonly events: OperatingEventRecord[],
  ) {}

  static async open(input: {
    client: CompanyPostgresClient;
    pool: CompanyPostgresPoolLike;
    companyId: string;
  }): Promise<PostgresOperatingLogRepository> {
    const companyId = normalizeCompanyId(input.companyId);
    const result = await input.client.query(
      "SELECT * FROM operating_events WHERE company_id = $1 ORDER BY timestamp DESC, id DESC",
      [companyId],
    );
    return new PostgresOperatingLogRepository(
      input.client,
      input.pool,
      companyId,
      result.rows.map(eventFromRow),
    );
  }

  appendEvent(input: OperatingEventRecord): OperatingEventRecord {
    upsertById(this.events, input);
    this.queueQuery(
      `INSERT INTO operating_events (
  company_id, id, timestamp, actor_member_id, domain, severity, title, message,
  source_intake_event_id, source_kind, source_id, metadata_json
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
ON CONFLICT (company_id, id) DO UPDATE SET
  timestamp = EXCLUDED.timestamp,
  actor_member_id = EXCLUDED.actor_member_id,
  domain = EXCLUDED.domain,
  severity = EXCLUDED.severity,
  title = EXCLUDED.title,
  message = EXCLUDED.message,
  source_intake_event_id = EXCLUDED.source_intake_event_id,
  source_kind = EXCLUDED.source_kind,
  source_id = EXCLUDED.source_id,
  metadata_json = EXCLUDED.metadata_json`,
      [
        this.companyId,
        input.id,
        input.timestamp,
        input.actorMemberId,
        input.category ?? null,
        input.severity,
        input.title,
        input.message,
        input.source.intakeEventId ?? null,
        input.source.kind ?? null,
        input.source.id ?? null,
        input.metadata ?? null,
      ],
    );
    return input;
  }

  getEvent(eventId: string): OperatingEventRecord | undefined {
    return this.events.find((event) => event.id === eventId);
  }

  listEvents(input: {
    actorMemberId?: string;
    category?: string;
    severity?: OperatingEventSeverity;
    limit?: number;
  } = {}): OperatingEventRecord[] {
    const limit = input.limit && input.limit > 0 ? Math.floor(input.limit) : 100;
    return this.events
      .filter((event) => !input.actorMemberId || event.actorMemberId === input.actorMemberId)
      .filter((event) => !input.category || event.category === input.category)
      .filter((event) => !input.severity || event.severity === input.severity)
      .sort(byTimestampDesc)
      .slice(0, limit);
  }

  async save(): Promise<void> {
    await this.pendingWrites;
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

  private queueQuery(sql: string, params?: readonly unknown[]) {
    this.pendingWriteCount += 1;
    this.pendingWrites = this.pendingWrites
      .then(() => this.client.query(sql, params))
      .finally(() => {
        this.pendingWriteCount -= 1;
      });
  }
}
