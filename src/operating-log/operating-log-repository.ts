import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresOpenOptions,
} from "../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../runtime/company-config/company-paths.js";
import { PostgresOperatingLogRepository } from "./postgres-operating-log-repository.js";
import type {
  OperatingEventRecord,
  OperatingEventSeverity,
} from "./domain.js";

export interface OperatingLogRepositoryLike {
  appendEvent(input: OperatingEventRecord): OperatingEventRecord;
  getEvent(eventId: string): OperatingEventRecord | undefined;
  listEvents(input?: {
    actorMemberId?: string;
    category?: string;
    severity?: OperatingEventSeverity;
    limit?: number;
  }): OperatingEventRecord[];
  save(): Promise<void>;
  close(): void;
}

export type OperatingLogRepositoryOpenOptions = CompanyPostgresOpenOptions & {
  companyId?: string;
};

export class OperatingLogRepository {
  static async open(
    repoRoot: string,
    options: OperatingLogRepositoryOpenOptions = {},
  ): Promise<OperatingLogRepositoryLike> {
    const companyId = normalizeCompanyId(options.companyId);
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("Operating log storage requires PostgreSQL runtime configuration.");
    }
    try {
      return await PostgresOperatingLogRepository.open({ ...postgres, companyId });
    } catch (error) {
      postgres.client.release();
      await endCompanyPostgresPool(postgres.pool);
      throw error;
    }
  }
}
