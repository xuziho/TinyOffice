import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresOpenOptions,
} from "../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../runtime/company-config/company-paths.js";
import type { IntakeEventStore } from "./intake-event-store.js";
import { PostgresIntakeEventStore } from "./postgres-intake-event-store.js";

export class DbIntakeEventStore {
  static async open(input: {
    repoRoot: string;
  } & CompanyPostgresOpenOptions & { companyId?: string }): Promise<IntakeEventStore & { close(): void }> {
    const companyId = normalizeCompanyId(input.companyId);
    const postgres = await openConfiguredPostgresConnection(input.repoRoot, input);
    if (!postgres) {
      throw new Error("Intake event storage requires PostgreSQL runtime configuration.");
    }
    try {
      return await PostgresIntakeEventStore.open({ ...postgres, companyId });
    } catch (error) {
      postgres.client.release();
      await endCompanyPostgresPool(postgres.pool);
      throw error;
    }
  }
}
