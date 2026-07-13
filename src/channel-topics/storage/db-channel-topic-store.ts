import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresOpenOptions,
} from "../../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../../runtime/company-config/company-paths.js";
import type { ChannelTopicStore } from "./channel-topic-store.js";
import { PostgresChannelTopicStore } from "./postgres-channel-topic-store.js";

export class DbChannelTopicStore {
  static async open(input: {
    repoRoot?: string;
  } & CompanyPostgresOpenOptions & { companyId?: string }): Promise<ChannelTopicStore> {
    const repoRoot = input.repoRoot || process.cwd();
    const companyId = normalizeCompanyId(input.companyId);
    const postgres = await openConfiguredPostgresConnection(repoRoot, input);
    if (!postgres) {
      throw new Error("Channel topic storage requires PostgreSQL runtime configuration.");
    }
    try {
      return await PostgresChannelTopicStore.open({ ...postgres, companyId });
    } catch (error) {
      postgres.client.release();
      await endCompanyPostgresPool(postgres.pool);
      throw error;
    }
  }
}
