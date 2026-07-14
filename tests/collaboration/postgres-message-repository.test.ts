import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTACHMENT_DTO_SCHEMA,
  CONVERSATION_DTO_SCHEMA,
  CONVERSATION_MESSAGE_CONTRACT_VERSION,
  CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
  CONVERSATION_RUNTIME_LINK_DTO_SCHEMA,
  CONVERSATION_TOPIC_STATE_DTO_SCHEMA,
  MESSAGE_DTO_SCHEMA,
  MESSAGE_MENTION_DTO_SCHEMA,
  PARTICIPANT_DTO_SCHEMA,
  type ConversationDto,
  type MessageDto,
} from "../../src/collaboration/contracts/conversation-message-contract.js";
import { PostgresMessageRepository } from "../../src/collaboration/message/postgres-message-repository.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresPoolLike,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";

const fixedNow = "2026-06-23T05:15:00.000Z";

class FakePostgresMessageClient implements CompanyPostgresClient {
  readonly conversations = new Map<string, Record<string, unknown>>();
  readonly messages = new Map<string, Record<string, unknown>>();
  readonly queries: Array<{ sql: string; params?: unknown[] }> = [];

  release(): void {}

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    if (/INSERT INTO conversations/.test(sql) && params) {
      const row = {
        company_id: params[0],
        conversation_id: params[1],
        title: params[2],
        title_status: params[3],
        title_source_message_id: params[4],
        title_failure_reason: params[5],
        conversation_kind: params[6],
        participants_json: params[7],
        topic_state_json: params[8],
        participant_states_json: params[9],
        last_message_id: params[10],
        runtime_links_json: params[11],
        realtime_sequence: params[12],
        created_at: params[13],
        updated_at: params[14],
      };
      this.conversations.set(`${params[0]}:${params[1]}`, row);
      return { rows: [] as T[] };
    }
    if (/SELECT \* FROM conversations/.test(sql) && params) {
      return {
        rows: [this.conversations.get(`${params[0]}:${params[1]}`)].filter(Boolean) as T[],
      };
    }
    if (/JOIN conversation_participants/.test(sql) && params) {
      const viewerMemberId = typeof params[1] === "string" ? params[1] : undefined;
      const viewerParticipantId = typeof params[2] === "string" ? params[2] : undefined;
      const rows = [...this.conversations.values()].filter((row) => {
        if (row.company_id !== params[0]) {
          return false;
        }
        const participants = Array.isArray(row.participants_json)
          ? row.participants_json
          : JSON.parse(String(row.participants_json || "[]"));
        return participants.some((participant) =>
          participant &&
          typeof participant === "object" &&
          (
            (viewerMemberId !== undefined && "memberId" in participant && participant.memberId === viewerMemberId) ||
            (viewerParticipantId !== undefined && "participantId" in participant && participant.participantId === viewerParticipantId)
          )
        );
      });
      return { rows: rows as T[] };
    }
    if (/SELECT company_id FROM conversations/.test(sql) && params) {
      const row = [...this.conversations.values()].find((candidate) => candidate.conversation_id === params[0]);
      return { rows: row ? [{ company_id: row.company_id } as T] : [] };
    }
    if (/INSERT INTO conversation_messages/.test(sql) && params) {
      const row = {
        company_id: params[0],
        conversation_id: params[1],
        message_id: params[2],
        sender_json: params[3],
        body: params[4],
        attachments_json: params[5],
        mentions_json: params[6],
        runtime_links_json: params[7],
        delivery_state: params[8],
        created_at: params[9],
        updated_at: params[10],
      };
      this.messages.set(`${params[0]}:${params[2]}`, row);
      return { rows: [] as T[] };
    }
    if (/SELECT \* FROM conversation_messages/.test(sql) && params) {
      return {
        rows: [...this.messages.values()]
          .filter((row) => row.company_id === params[0] && row.conversation_id === params[1]) as T[],
      };
    }
    return { rows: [] as T[] };
  }
}

const fakePool: CompanyPostgresPoolLike = {
  async connect() {
    return new FakePostgresMessageClient();
  },
  async query() {
    return { rows: [] };
  },
  async end() {},
};

function createRepository(client: FakePostgresMessageClient) {
  const RepositoryCtor = PostgresMessageRepository as unknown as {
    new (
      client: CompanyPostgresClient,
      pool: CompanyPostgresPoolLike,
      companyId: string,
    ): PostgresMessageRepository;
  };
  return new RepositoryCtor(client, fakePool, "acme");
}

function conversation(input: { companyId?: string; conversationId?: string } = {}): ConversationDto {
  const companyId = input.companyId ?? "acme";
  const conversationId = input.conversationId ?? "conversation-1";
  const participant = {
    schema: PARTICIPANT_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    participantId: "participant-nora",
    participantKind: "employee" as const,
    employeeId: "nora-automation",
    displayName: "Nora",
    joinedAt: fixedNow,
  };
  return {
    schema: CONVERSATION_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    title: "Backend state room",
    titleStatus: "generated",
    titleSourceMessageId: "message-1",
    conversationKind: "topic",
    topic: {
      schema: CONVERSATION_TOPIC_STATE_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      topicId: "topic-1",
      title: "Backend state room",
      status: "open",
      ownerParticipantId: "participant-nora",
      participantIds: ["participant-nora"],
      summary: {
        text: "Nora should inspect the workspace and pass findings back to Iris.",
        sourceMessageId: "message-1",
        updatedAt: fixedNow,
      },
      createdAt: fixedNow,
      updatedAt: fixedNow,
    },
    participants: [participant],
    participantStates: [{
      schema: CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      participantId: "participant-nora",
      employeeId: "nora-automation",
      lastReadMessageId: "message-1",
      unreadCount: 2,
      mentionCount: 1,
      updatedAt: fixedNow,
    }],
    lastMessageId: "message-1",
    runtimeLinks: [{
      schema: CONVERSATION_RUNTIME_LINK_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      linkId: "runtime-link-session",
      targetKind: "session",
      targetId: "session-1",
      createdAt: fixedNow,
    }],
    realtimeSequence: 4,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };
}

function memberConversation(input: { companyId?: string; conversationId?: string } = {}): ConversationDto {
  const companyId = input.companyId ?? "acme";
  const conversationId = input.conversationId ?? "conversation-member";
  const memberParticipant = {
    schema: PARTICIPANT_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    participantId: "participant-xu",
    participantKind: "company_member" as const,
    memberId: "xuziho",
    displayName: "Xu Ziho",
    role: "boss",
    joinedAt: fixedNow,
  };
  const employeeParticipant = {
    schema: PARTICIPANT_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    participantId: "participant-nora",
    participantKind: "employee" as const,
    employeeId: "nora-automation",
    displayName: "Nora",
    joinedAt: fixedNow,
  };
  return {
    schema: CONVERSATION_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId,
    conversationId,
    title: "Member backed room",
    titleStatus: "failed",
    titleSourceMessageId: "message-member",
    titleFailureReason: "provider unavailable",
    conversationKind: "shared",
    participants: [memberParticipant, employeeParticipant],
    participantStates: [{
      schema: CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      participantId: "participant-xu",
      memberId: "xuziho",
      lastReadMessageId: "message-member",
      unreadCount: 0,
      mentionCount: 0,
      updatedAt: fixedNow,
    }, {
      schema: CONVERSATION_PARTICIPANT_STATE_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId,
      conversationId,
      participantId: "participant-nora",
      employeeId: "nora-automation",
      unreadCount: 1,
      mentionCount: 0,
      updatedAt: fixedNow,
    }],
    runtimeLinks: [],
    realtimeSequence: 1,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };
}

function message(): MessageDto {
  return {
    schema: MESSAGE_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId: "acme",
    conversationId: "conversation-1",
    messageId: "message-1",
    sender: {
      participantId: "participant-nora",
      participantKind: "employee",
      employeeId: "nora-automation",
      displayName: "Nora",
    },
    body: "Evidence attached.",
    mentions: [{
      schema: MESSAGE_MENTION_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId: "acme",
      conversationId: "conversation-1",
      messageId: "message-1",
      participantId: "participant-nora",
      employeeId: "nora-automation",
      createdAt: fixedNow,
    }],
    attachments: [{
      schema: ATTACHMENT_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId: "acme",
      conversationId: "conversation-1",
      messageId: "message-1",
      attachmentId: "attachment-1",
      fileName: "evidence.txt",
      mimeType: "text/plain",
      byteLength: 12,
      storageKey: "company/acme/evidence.txt",
      contentSha256: "abc123",
      createdAt: fixedNow,
    }],
    runtimeLinks: [{
      schema: CONVERSATION_RUNTIME_LINK_DTO_SCHEMA,
      version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
      companyId: "acme",
      conversationId: "conversation-1",
      messageId: "message-1",
      linkId: "runtime-link-workrun",
      targetKind: "work_run",
      targetId: "workrun-1",
      createdAt: fixedNow,
    }],
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deliveryState: "sent",
  };
}

function memberMessage(): MessageDto {
  return {
    schema: MESSAGE_DTO_SCHEMA,
    version: CONVERSATION_MESSAGE_CONTRACT_VERSION,
    companyId: "acme",
    conversationId: "conversation-member",
    messageId: "message-member",
    sender: {
      participantId: "participant-xu",
      participantKind: "company_member",
      memberId: "xuziho",
      displayName: "Xu Ziho",
    },
    body: "Please check this.",
    mentions: [],
    attachments: [],
    runtimeLinks: [],
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deliveryState: "sent",
  };
}

test("postgres message repository round-trips conversation state JSON fields", async () => {
  const client = new FakePostgresMessageClient();
  const repository = createRepository(client);

  await repository.upsertConversation({ conversation: conversation() });
  const loaded = await repository.getConversation("acme", "conversation-1");

  assert.equal(loaded?.conversation.topic?.topicId, "topic-1");
  assert.equal(loaded?.conversation.topic?.summary?.text, "Nora should inspect the workspace and pass findings back to Iris.");
  assert.equal(loaded?.conversation.participantStates[0]?.mentionCount, 1);
  assert.equal(loaded?.conversation.runtimeLinks[0]?.targetId, "session-1");
  assert.equal(loaded?.conversation.realtimeSequence, 4);
  assert.equal(loaded?.conversation.titleStatus, "generated");
  assert.equal(loaded?.conversation.titleSourceMessageId, "message-1");
  assert.equal(await repository.findConversationCompanyId("conversation-1"), "acme");
});

test("postgres message repository queries recent runtime messages from latest to chronological prompt order", async () => {
  const client = new FakePostgresMessageClient();
  const repository = createRepository(client);

  await repository.listRecentMessages({ companyId: "acme", conversationId: "conversation-1", limit: 20 });

  const query = client.queries.at(-1);
  assert.ok(query);
  assert.match(query.sql, /ORDER BY created_at DESC, message_id DESC/);
  assert.match(query.sql, /ORDER BY created_at ASC, message_id ASC/);
  assert.deepEqual(query.params, ["acme", "conversation-1", 20]);
});

test("postgres message repository queries all runtime messages after a context cursor", async () => {
  const client = new FakePostgresMessageClient();
  const repository = createRepository(client);

  await repository.listMessagesAfter({
    companyId: "acme",
    conversationId: "conversation-1",
    afterCreatedAt: "2026-07-14T10:00:00.000Z",
    afterMessageId: "message-20",
  });

  const query = client.queries.at(-1);
  assert.ok(query);
  assert.match(query.sql, /created_at > \$3/);
  assert.match(query.sql, /created_at = \$3 AND message_id > \$4/);
  assert.match(query.sql, /ORDER BY created_at ASC, message_id ASC/);
  assert.doesNotMatch(query.sql, /LIMIT/);
  assert.deepEqual(query.params, ["acme", "conversation-1", "2026-07-14T10:00:00.000Z", "message-20"]);
});

test("postgres message repository upserts conversations through the runtime PostgreSQL path", async () => {
  const repository = await PostgresMessageRepository.open(process.cwd(), { companyId: "tinyoffice" });
  try {
    await repository.upsertConversation({
      conversation: conversation({
        companyId: "tinyoffice",
        conversationId: "conversation-postgres-upsert",
      }),
    });

    const loaded = await repository.getConversation("tinyoffice", "conversation-postgres-upsert");

    assert.equal(loaded?.conversation.conversationId, "conversation-postgres-upsert");
    assert.equal(loaded?.conversation.participantStates[0]?.mentionCount, 1);
  } finally {
    repository.close();
  }
});

test("postgres message repository round-trips message mention attachment and runtime evidence JSON fields", async () => {
  const client = new FakePostgresMessageClient();
  const repository = createRepository(client);

  await repository.upsertMessage({ message: message() });
  const loaded = await repository.listMessages({ companyId: "acme", conversationId: "conversation-1" });

  assert.equal(loaded[0]?.message.mentions[0]?.employeeId, "nora-automation");
  assert.equal(loaded[0]?.message.attachments[0]?.contentSha256, "abc123");
  assert.equal(loaded[0]?.message.runtimeLinks[0]?.targetKind, "work_run");
  assert.doesNotMatch(JSON.stringify(loaded), /\b(team_id|teamId|user_id|userId|channel_id|channelId|post_id|postId)\b/);
});

test("postgres message repository persists and lists Company Member participants and senders", async () => {
  const client = new FakePostgresMessageClient();
  const repository = createRepository(client);

  await repository.upsertConversation({ conversation: memberConversation() });
  await repository.upsertMessage({ message: memberMessage() });

  const loaded = await repository.getConversation("acme", "conversation-member");
  const memberVisible = await repository.listConversations({
    companyId: "acme",
    viewerMemberId: "xuziho",
  });
  const messages = await repository.listMessages({ companyId: "acme", conversationId: "conversation-member" });

  assert.equal(loaded?.conversation.participants[0]?.memberId, "xuziho");
  assert.equal(loaded?.conversation.titleStatus, "failed");
  assert.equal(loaded?.conversation.titleSourceMessageId, "message-member");
  assert.equal(loaded?.conversation.titleFailureReason, "provider unavailable");
  assert.equal(loaded?.conversation.participantStates[0]?.memberId, "xuziho");
  assert.deepEqual(memberVisible.map((record) => record.conversation.conversationId), ["conversation-member"]);
  assert.equal(messages[0]?.message.sender.participantKind, "company_member");
  assert.equal(messages[0]?.message.sender.memberId, "xuziho");
  assert.equal(messages[0]?.message.sender.employeeId, undefined);
  assert.ok(client.queries.some((query) => /member_id/.test(query.sql)));
});
