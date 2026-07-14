import {
  endCompanyPostgresPool,
  openConfiguredPostgresConnection,
} from "../company-config/postgres-runtime-connection.js";

export type ChatTopicChainStatus = "active" | "cancel_requested" | "completed" | "canceled" | "failed";

export interface ChatTopicChainRecord {
  companyId: string;
  chainId: string;
  roomId: string;
  sourceMessageId: string;
  startedByMemberId: string;
  currentRunId: string;
  currentHolderMemberId: string;
  status: ChatTopicChainStatus;
  revision: number;
}

export interface ChatTopicChainRepository {
  recoverInterruptedChains(companyId: string): Promise<void>;
  tryStart(input: Omit<ChatTopicChainRecord, "status" | "revision">): Promise<ChatTopicChainRecord | undefined>;
  advance(input: {
    companyId: string;
    chainId: string;
    expectedRunId: string;
    nextRunId: string;
    nextHolderMemberId: string;
  }): Promise<ChatTopicChainRecord | undefined>;
  requestCancel(companyId: string, runId: string): Promise<ChatTopicChainRecord | undefined>;
  finish(companyId: string, chainId: string, status: Extract<ChatTopicChainStatus, "completed" | "canceled" | "failed">): Promise<void>;
  findByRun(companyId: string, runId: string): Promise<ChatTopicChainRecord | undefined>;
  findActiveByRoom(companyId: string, roomId: string): Promise<ChatTopicChainRecord | undefined>;
}

export class InMemoryChatTopicChainRepository implements ChatTopicChainRepository {
  private readonly chains = new Map<string, ChatTopicChainRecord>();
  private readonly chainIdByRunId = new Map<string, string>();

  async recoverInterruptedChains(): Promise<void> {}

  async tryStart(input: Omit<ChatTopicChainRecord, "status" | "revision">): Promise<ChatTopicChainRecord | undefined> {
    if ([...this.chains.values()].some((chain) =>
      chain.companyId === input.companyId && chain.roomId === input.roomId && isActive(chain.status)
    )) {
      return undefined;
    }
    const chain: ChatTopicChainRecord = { ...input, status: "active", revision: 1 };
    this.chains.set(chain.chainId, chain);
    this.chainIdByRunId.set(chain.currentRunId, chain.chainId);
    return { ...chain };
  }

  async advance(input: { companyId: string; chainId: string; expectedRunId: string; nextRunId: string; nextHolderMemberId: string }): Promise<ChatTopicChainRecord | undefined> {
    const chain = this.chains.get(input.chainId);
    if (!chain || chain.companyId !== input.companyId || chain.status !== "active" || chain.currentRunId !== input.expectedRunId) {
      return undefined;
    }
    chain.currentRunId = input.nextRunId;
    chain.currentHolderMemberId = input.nextHolderMemberId;
    chain.revision += 1;
    this.chainIdByRunId.set(input.nextRunId, input.chainId);
    return { ...chain };
  }

  async requestCancel(companyId: string, runId: string): Promise<ChatTopicChainRecord | undefined> {
    const chainId = this.chainIdByRunId.get(runId);
    const chain = chainId ? this.chains.get(chainId) : undefined;
    if (!chain || chain.companyId !== companyId || !isActive(chain.status)) {
      return undefined;
    }
    chain.status = "cancel_requested";
    chain.revision += 1;
    return { ...chain };
  }

  async finish(companyId: string, chainId: string, status: Extract<ChatTopicChainStatus, "completed" | "canceled" | "failed">): Promise<void> {
    const chain = this.chains.get(chainId);
    if (!chain || chain.companyId !== companyId || !isActive(chain.status)) {
      return;
    }
    chain.status = status;
    chain.revision += 1;
  }

  async findByRun(companyId: string, runId: string): Promise<ChatTopicChainRecord | undefined> {
    const chainId = this.chainIdByRunId.get(runId);
    const chain = chainId ? this.chains.get(chainId) : undefined;
    return chain?.companyId === companyId ? { ...chain } : undefined;
  }

  async findActiveByRoom(companyId: string, roomId: string): Promise<ChatTopicChainRecord | undefined> {
    const chain = [...this.chains.values()].find((candidate) =>
      candidate.companyId === companyId && candidate.roomId === roomId && isActive(candidate.status)
    );
    return chain ? { ...chain } : undefined;
  }
}

export class PostgresChatTopicChainRepository implements ChatTopicChainRepository {
  constructor(private readonly repoRoot: string) {}

  async recoverInterruptedChains(companyId: string): Promise<void> {
    await this.query(companyId, `UPDATE chat_topic_chains
SET status = 'failed', revision = revision + 1, updated_at = NOW(), completed_at = NOW()
WHERE company_id = $1 AND status IN ('active', 'cancel_requested')`, [companyId]);
  }

  async tryStart(input: Omit<ChatTopicChainRecord, "status" | "revision">): Promise<ChatTopicChainRecord | undefined> {
    const result = await this.query<ChatTopicChainRow>(input.companyId, `WITH inserted AS (
  INSERT INTO chat_topic_chains (
    company_id, chain_id, room_id, source_message_id, started_by_member_id,
    current_run_id, current_holder_member_id, status, revision, created_at, updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 1, NOW(), NOW())
  ON CONFLICT (company_id, room_id) WHERE status IN ('active', 'cancel_requested') DO NOTHING
  RETURNING *
), linked AS (
  INSERT INTO chat_topic_chain_runs (company_id, chain_id, run_id, holder_member_id, created_at)
  SELECT company_id, chain_id, current_run_id, current_holder_member_id, NOW() FROM inserted
  RETURNING chain_id
)
SELECT inserted.* FROM inserted JOIN linked USING (chain_id)`, [
      input.companyId, input.chainId, input.roomId, input.sourceMessageId, input.startedByMemberId,
      input.currentRunId, input.currentHolderMemberId,
    ]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : undefined;
  }

  async advance(input: { companyId: string; chainId: string; expectedRunId: string; nextRunId: string; nextHolderMemberId: string }): Promise<ChatTopicChainRecord | undefined> {
    const result = await this.query<ChatTopicChainRow>(input.companyId, `WITH updated AS (
  UPDATE chat_topic_chains
  SET current_run_id = $4, current_holder_member_id = $5, revision = revision + 1, updated_at = NOW()
  WHERE company_id = $1 AND chain_id = $2 AND current_run_id = $3 AND status = 'active'
  RETURNING *
), linked AS (
  INSERT INTO chat_topic_chain_runs (company_id, chain_id, run_id, holder_member_id, created_at)
  SELECT company_id, chain_id, current_run_id, current_holder_member_id, NOW() FROM updated
  ON CONFLICT (company_id, run_id) DO NOTHING
  RETURNING chain_id
)
SELECT updated.* FROM updated JOIN linked USING (chain_id)`, [
      input.companyId, input.chainId, input.expectedRunId, input.nextRunId, input.nextHolderMemberId,
    ]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : undefined;
  }

  async requestCancel(companyId: string, runId: string): Promise<ChatTopicChainRecord | undefined> {
    const result = await this.query<ChatTopicChainRow>(companyId, `UPDATE chat_topic_chains chain
SET status = 'cancel_requested', revision = revision + 1, updated_at = NOW(), cancel_requested_at = COALESCE(cancel_requested_at, NOW())
FROM chat_topic_chain_runs run
WHERE chain.company_id = $1
  AND run.company_id = chain.company_id
  AND run.chain_id = chain.chain_id
  AND run.run_id = $2
  AND chain.status IN ('active', 'cancel_requested')
RETURNING chain.*`, [companyId, runId]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : undefined;
  }

  async finish(companyId: string, chainId: string, status: Extract<ChatTopicChainStatus, "completed" | "canceled" | "failed">): Promise<void> {
    await this.query(companyId, `UPDATE chat_topic_chains
SET status = $3, revision = revision + 1, updated_at = NOW(), completed_at = NOW()
WHERE company_id = $1 AND chain_id = $2 AND status IN ('active', 'cancel_requested')`, [companyId, chainId, status]);
  }

  async findByRun(companyId: string, runId: string): Promise<ChatTopicChainRecord | undefined> {
    const result = await this.query<ChatTopicChainRow>(companyId, `SELECT chain.*
FROM chat_topic_chains chain
JOIN chat_topic_chain_runs run
  ON run.company_id = chain.company_id AND run.chain_id = chain.chain_id
WHERE chain.company_id = $1 AND run.run_id = $2`, [companyId, runId]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : undefined;
  }

  async findActiveByRoom(companyId: string, roomId: string): Promise<ChatTopicChainRecord | undefined> {
    const result = await this.query<ChatTopicChainRow>(companyId, `SELECT * FROM chat_topic_chains
WHERE company_id = $1 AND room_id = $2 AND status IN ('active', 'cancel_requested')`, [companyId, roomId]);
    return result.rows[0] ? recordFromRow(result.rows[0]) : undefined;
  }

  private async query<Row = Record<string, unknown>>(companyId: string, sql: string, params: readonly unknown[]) {
    const postgres = await openConfiguredPostgresConnection(this.repoRoot);
    if (!postgres) {
      throw new Error(`Chat Topic chain repository requires PostgreSQL for company ${companyId}.`);
    }
    try {
      return await postgres.client.query<Row>(sql, params);
    } finally {
      postgres.client.release();
      await endCompanyPostgresPool(postgres.pool);
    }
  }
}

type ChatTopicChainRow = {
  company_id: string;
  chain_id: string;
  room_id: string;
  source_message_id: string;
  started_by_member_id: string;
  current_run_id: string;
  current_holder_member_id: string;
  status: ChatTopicChainStatus;
  revision: number;
};

function recordFromRow(row: ChatTopicChainRow): ChatTopicChainRecord {
  return {
    companyId: row.company_id,
    chainId: row.chain_id,
    roomId: row.room_id,
    sourceMessageId: row.source_message_id,
    startedByMemberId: row.started_by_member_id,
    currentRunId: row.current_run_id,
    currentHolderMemberId: row.current_holder_member_id,
    status: row.status,
    revision: Number(row.revision),
  };
}

function isActive(status: ChatTopicChainStatus): boolean {
  return status === "active" || status === "cancel_requested";
}
