import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
  type CompanyPostgresOpenOptions,
} from "../runtime/company-config/postgres-runtime-connection.js";
import { normalizeCompanyId } from "../runtime/company-config/company-paths.js";
import { PostgresWorkRepository } from "./postgres-work-repository.js";
import type {
  WorkRunEventRecord,
  WorkRunRecord,
  WorkRunStatus,
  WorkScheduleRecord,
  WorkTaskRecord,
  WorkTaskRevisionRecord,
  WorkTaskStatus,
} from "./domain.js";

export interface WorkRepositoryLike {
  createWorkTask(input: WorkTaskRecord): WorkTaskRecord;
  getWorkTask(id: string): WorkTaskRecord | undefined;
  updateWorkTask(input: WorkTaskRecord): WorkTaskRecord;
  reviseWorkTask(input: {
    task: WorkTaskRecord;
    revision: WorkTaskRevisionRecord;
    run?: WorkRunRecord;
  }): void;
  listWorkTaskRevisions(workTaskId: string): WorkTaskRevisionRecord[];
  listWorkTasks(input?: { ownerMemberId?: string; status?: WorkTaskStatus }): WorkTaskRecord[];
  createWorkSchedule(input: WorkScheduleRecord): WorkScheduleRecord;
  getWorkSchedule(id: string): WorkScheduleRecord | undefined;
  updateWorkSchedule(input: WorkScheduleRecord): WorkScheduleRecord;
  listWorkSchedules(input?: { workTaskId?: string; status?: WorkScheduleRecord["status"] }): WorkScheduleRecord[];
  listWorkRuns(input?: { workTaskId?: string; assigneeMemberId?: string; status?: WorkRunStatus }): WorkRunRecord[];
  createWorkRun(input: WorkRunRecord): WorkRunRecord;
  getWorkRun(id: string): WorkRunRecord | undefined;
  updateWorkRun(input: WorkRunRecord): WorkRunRecord;
  appendWorkRunEvent(input: WorkRunEventRecord): WorkRunEventRecord;
  listWorkRunEvents(workRunId: string): WorkRunEventRecord[];
  save(): Promise<void>;
  close(): void;
}

export type WorkRepositoryOpenOptions = CompanyPostgresOpenOptions & { companyId?: string };

export class WorkRepository {
  static async open(
    repoRoot: string,
    options: WorkRepositoryOpenOptions = {},
  ): Promise<WorkRepositoryLike> {
    const companyId = normalizeCompanyId(options.companyId);
    const postgres = await openConfiguredPostgresConnection(repoRoot, options);
    if (!postgres) {
      throw new Error("Work storage requires PostgreSQL runtime configuration.");
    }
    try {
      return await PostgresWorkRepository.open({ ...postgres, companyId });
    } catch (error) {
      postgres.client.release();
      await endCompanyPostgresPool(postgres.pool);
      throw error;
    }
  }
}
