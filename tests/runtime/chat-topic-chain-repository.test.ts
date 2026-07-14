import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

import { InMemoryChatTopicChainRepository, PostgresChatTopicChainRepository } from "../../src/runtime/chat/chat-topic-chain-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";

test("Chat Topic chain repository enforces one active ball and advances one current holder", async () => {
  const repository = new InMemoryChatTopicChainRepository();
  const started = await repository.tryStart({
    companyId: "acme", chainId: "chain-1", roomId: "room-1", sourceMessageId: "message-1",
    startedByMemberId: "xuziho", currentRunId: "run-1", currentHolderMemberId: "nora",
  });
  assert.equal(started?.currentHolderMemberId, "nora");
  assert.equal(await repository.tryStart({
    companyId: "acme", chainId: "chain-2", roomId: "room-1", sourceMessageId: "message-2",
    startedByMemberId: "xuziho", currentRunId: "run-2", currentHolderMemberId: "iris",
  }), undefined);

  const advanced = await repository.advance({
    companyId: "acme", chainId: "chain-1", expectedRunId: "run-1", nextRunId: "run-2", nextHolderMemberId: "iris",
  });
  assert.equal(advanced?.currentRunId, "run-2");
  assert.equal(advanced?.currentHolderMemberId, "iris");
  assert.equal((await repository.findByRun("acme", "run-1"))?.currentRunId, "run-2");
});

test("Chat Topic chain cancel resolves an earlier run to the current holder and blocks another handoff", async () => {
  const repository = new InMemoryChatTopicChainRepository();
  await repository.tryStart({
    companyId: "acme", chainId: "chain-1", roomId: "room-1", sourceMessageId: "message-1",
    startedByMemberId: "xuziho", currentRunId: "run-1", currentHolderMemberId: "nora",
  });
  await repository.advance({
    companyId: "acme", chainId: "chain-1", expectedRunId: "run-1", nextRunId: "run-2", nextHolderMemberId: "iris",
  });

  const canceled = await repository.requestCancel("acme", "run-1");
  assert.equal(canceled?.status, "cancel_requested");
  assert.equal(canceled?.currentRunId, "run-2");
  assert.equal(await repository.advance({
    companyId: "acme", chainId: "chain-1", expectedRunId: "run-2", nextRunId: "run-3", nextHolderMemberId: "nora",
  }), undefined);
});

test("Postgres Chat Topic chain repository persists one current holder across handoffs", async () => {
  const databaseUrl = process.env.TINYOFFICE_DATABASE_URL;
  assert.ok(databaseUrl, "isolated runtime test database is required");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`INSERT INTO conversations (
      company_id, conversation_id, title, conversation_kind, participants_json,
      created_at, updated_at
    ) VALUES ($1, 'room-chain', 'Chain test', 'topic', '[]'::jsonb, NOW(), NOW())`, [DEFAULT_COMPANY_ID]);
    await pool.query(`INSERT INTO conversation_messages (
      company_id, conversation_id, message_id, sender_json, body, attachments_json,
      delivery_state, created_at, updated_at
    ) VALUES ($1, 'room-chain', 'message-chain', '{}'::jsonb, 'start', '[]'::jsonb,
      'sent', NOW(), NOW())`, [DEFAULT_COMPANY_ID]);
  } finally {
    await pool.end();
  }

  const repository = new PostgresChatTopicChainRepository(process.cwd());
  const started = await repository.tryStart({
    companyId: DEFAULT_COMPANY_ID,
    chainId: "chain-postgres",
    roomId: "room-chain",
    sourceMessageId: "message-chain",
    startedByMemberId: "owner",
    currentRunId: "run-parent",
    currentHolderMemberId: "nora",
  });
  assert.equal(started?.currentHolderMemberId, "nora");
  assert.equal((await repository.advance({
    companyId: DEFAULT_COMPANY_ID,
    chainId: "chain-postgres",
    expectedRunId: "run-parent",
    nextRunId: "run-child",
    nextHolderMemberId: "iris",
  }))?.currentHolderMemberId, "iris");
  assert.equal((await repository.findByRun(DEFAULT_COMPANY_ID, "run-parent"))?.currentRunId, "run-child");
  assert.equal((await repository.requestCancel(DEFAULT_COMPANY_ID, "run-parent"))?.status, "cancel_requested");
  await repository.finish(DEFAULT_COMPANY_ID, "chain-postgres", "canceled");
  assert.equal(await repository.findActiveByRoom(DEFAULT_COMPANY_ID, "room-chain"), undefined);
});
