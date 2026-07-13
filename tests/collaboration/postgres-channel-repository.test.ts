import assert from "node:assert/strict";
import test from "node:test";

import { PostgresChannelRepository } from "../../src/collaboration/channel/postgres-channel-repository.js";
import type { ChatChannelRecord } from "../../src/collaboration/channel/channel-service.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresPoolLike,
} from "../../src/runtime/company-config/postgres-runtime-connection.js";

const fixedNow = "2026-07-01T12:00:00.000Z";

class FakePostgresChannelClient implements CompanyPostgresClient {
  readonly channels = new Map<string, Record<string, unknown>>();
  readonly members = new Map<string, Record<string, unknown>>();
  readonly conversations = new Map<string, Record<string, unknown>>();
  readonly runtimeProfileIds = new Set<string>();
  readonly inactiveRuntimeProfileIds = new Set<string>();
  readonly memberProfiles = new Map<string, { avatarSeed: string; displayName: string; role?: string }>();
  readonly attachments = new Map<string, { companyId: string; localPath: string; conversationIds: string[] }>();
  readonly approvals = new Map<string, { companyId: string; contextKind: string; contextId: string; status: string; decisionNote?: string }>();
  readonly grants = new Map<string, { companyId: string; contextKind: string; contextId: string }>();
  activeExecutionConversationId?: string;
  readonly reconciledTaskSourceChannels: string[] = [];

  release(): void {}

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
    if (/^(BEGIN|COMMIT|ROLLBACK)\b/.test(sql)) {
      return { rows: [] as T[] };
    }
    if (/SELECT DISTINCT conversation\.conversation_id/.test(sql)) {
      return {
        rows: this.activeExecutionConversationId
          ? [{ conversation_id: this.activeExecutionConversationId }] as T[]
          : [] as T[],
      };
    }
    if (/UPDATE work_tasks task/.test(sql) && params) {
      this.reconciledTaskSourceChannels.push(String(params[1]));
      return { rows: [] as T[] };
    }
    if (/UPDATE governance_approvals approval/.test(sql) && params) {
      const targetConversationIds = this.channelConversationIds(String(params[0]), String(params[1]));
      for (const approval of this.approvals.values()) {
        if (approval.companyId === params[0] && approval.contextKind === "channel_topic" && approval.status === "pending" && targetConversationIds.has(approval.contextId)) {
          approval.status = "canceled";
          approval.decisionNote = "Source Channel was dissolved.";
        }
      }
      return { rows: [] as T[] };
    }
    if (/DELETE FROM approval_grants grant_row/.test(sql) && params) {
      const targetConversationIds = this.channelConversationIds(String(params[0]), String(params[1]));
      for (const [id, grant] of this.grants) {
        if (grant.companyId === params[0] && grant.contextKind === "channel_topic" && targetConversationIds.has(grant.contextId)) {
          this.grants.delete(id);
        }
      }
      return { rows: [] as T[] };
    }
    if (/DELETE FROM chat_attachments attachment/.test(sql) && params) {
      const targetConversationIds = this.channelConversationIds(String(params[0]), String(params[1]));
      const deleted: Array<{ local_path: string }> = [];
      for (const [id, attachment] of this.attachments) {
        const referencedByTarget = attachment.conversationIds.some((conversationId) => targetConversationIds.has(conversationId));
        const referencedBySurvivor = attachment.conversationIds.some((conversationId) => !targetConversationIds.has(conversationId));
        if (attachment.companyId === params[0] && referencedByTarget && !referencedBySurvivor) {
          this.attachments.delete(id);
          deleted.push({ local_path: attachment.localPath });
        }
      }
      return { rows: deleted as T[] };
    }
    if (/INSERT INTO chat_channels/.test(sql) && params) {
      this.channels.set(`${params[0]}:${params[1]}`, {
        company_id: params[0],
        channel_id: params[1],
        title: params[2],
        summary: params[3],
        created_at: params[4],
        updated_at: params[5],
      });
      return { rows: [] as T[] };
    }
    if (/DELETE FROM chat_channel_members/.test(sql) && params) {
      for (const key of [...this.members.keys()]) {
        if (key.startsWith(`${params[0]}:${params[1]}:`)) {
          this.members.delete(key);
        }
      }
      return { rows: [] as T[] };
    }
    if (/DELETE FROM conversations/.test(sql) && params) {
      for (const [key, conversation] of [...this.conversations.entries()]) {
        const topic = conversation.topic_state_json as { chatChannelId?: string } | undefined;
        if (conversation.company_id === params[0] && topic?.chatChannelId === params[1]) {
          this.conversations.delete(key);
        }
      }
      return { rows: [] as T[] };
    }
    if (/DELETE FROM chat_channels/.test(sql) && params) {
      this.channels.delete(`${params[0]}:${params[1]}`);
      for (const key of [...this.members.keys()]) {
        if (key.startsWith(`${params[0]}:${params[1]}:`)) {
          this.members.delete(key);
        }
      }
      return { rows: [] as T[] };
    }
    if (/INSERT INTO chat_channel_members/.test(sql) && params) {
      assert.doesNotMatch(sql, /\bemployee_id\b/);
      assert.doesNotMatch(sql, /\brole\b/);
      const memberId = params[2];
      const displayName = params[3];
      const joinedAt = params[4];
      const identity = `member:${memberId}`;
      this.members.set(`${params[0]}:${params[1]}:${identity}`, {
        company_id: params[0],
        channel_id: params[1],
        member_id: typeof memberId === "string" ? memberId : undefined,
        display_name: displayName,
        joined_at: joinedAt,
      });
      return { rows: [] as T[] };
    }
    if (/SELECT DISTINCT c\.channel_id/.test(sql) && params) {
      const companyId = params[0];
      const memberId = typeof params[1] === "string" ? params[1] : undefined;
      assert.doesNotMatch(sql, /\bm\.employee_id\b/);
      const channelIds = new Set<string>();
      for (const member of this.members.values()) {
        if (member.company_id !== companyId) {
          continue;
        }
        if (memberId !== undefined && member.member_id === memberId) {
          channelIds.add(String(member.channel_id));
        }
      }
      return { rows: [...channelIds].map((channel_id) => ({ channel_id })) as T[] };
    }
    if (/SELECT \* FROM chat_channels/.test(sql) && params) {
      return {
        rows: [this.channels.get(`${params[0]}:${params[1]}`)].filter(Boolean) as T[],
      };
    }
    if (/FROM chat_channel_members m/.test(sql) && params) {
      const rows = [...this.members.values()]
        .filter((member) => member.company_id === params[0] && member.channel_id === params[1])
        .map((member) => {
          const runtimeIdentity = String(member.member_id ?? "");
          const profile = this.memberProfiles.get(`${member.company_id}:${runtimeIdentity}`);
          return {
            ...member,
            authoritative_avatar_seed: profile?.avatarSeed,
            authoritative_display_name: profile?.displayName ?? member.display_name,
            authoritative_role: profile?.role,
            has_runtime_profile: this.runtimeProfileIds.has(`${member.company_id}:${runtimeIdentity}`)
              && !this.inactiveRuntimeProfileIds.has(`${member.company_id}:${runtimeIdentity}`),
          };
        });
      return { rows: rows as T[] };
    }
    return { rows: [] as T[] };
  }

  private channelConversationIds(companyId: string, channelId: string): Set<string> {
    return new Set([...this.conversations.values()]
      .filter((conversation) => conversation.company_id === companyId && (conversation.topic_state_json as { chatChannelId?: string } | undefined)?.chatChannelId === channelId)
      .map((conversation) => String(conversation.conversation_id)));
  }
}

const fakePool: CompanyPostgresPoolLike = {
  async connect() {
    return new FakePostgresChannelClient();
  },
  async query() {
    return { rows: [] };
  },
  async end() {},
};

function createRepository(client: FakePostgresChannelClient, deleteAttachmentFiles: (localPaths: string[]) => Promise<void> = async () => undefined) {
  const RepositoryCtor = PostgresChannelRepository as unknown as {
    new (
      client: CompanyPostgresClient,
      pool: CompanyPostgresPoolLike,
      companyId: string,
      deleteAttachmentFiles: (localPaths: string[]) => Promise<void>,
    ): PostgresChannelRepository;
  };
  return new RepositoryCtor(client, fakePool, "acme", deleteAttachmentFiles);
}

function channel(): ChatChannelRecord {
  return {
    companyId: "acme",
    chatChannelId: "channel-growth",
    title: "Growth Ops",
    summary: "Coordinate growth work.",
    createdAt: fixedNow,
    updatedAt: fixedNow,
    members: [{
      schema: "tinyoffice-chat-channel-member",
      version: 1,
      companyId: "acme",
      chatChannelId: "channel-growth",
      memberId: "xuziho",
      displayName: "Xuziho",
      hasRuntimeProfile: false,
      joinedAt: fixedNow,
    }, {
      schema: "tinyoffice-chat-channel-member",
      version: 1,
      companyId: "acme",
      chatChannelId: "channel-growth",
      memberId: "aster",
      displayName: "Aster",
      hasRuntimeProfile: true,
      joinedAt: fixedNow,
    }],
  };
}

test("PostgresChannelRepository preserves runtime-capable member identity", async () => {
  const client = new FakePostgresChannelClient();
  client.runtimeProfileIds.add("acme:aster");
  client.memberProfiles.set("acme:aster", { avatarSeed: "aster-avatar", displayName: "Aster Current", role: "analytics" });
  const repository = createRepository(client);

  const saved = await repository.upsertChannel(channel());

  const runtimeMember = saved.members.find((member) => member.memberId === "aster");
  assert.equal(runtimeMember?.memberId, "aster");
  assert.equal(runtimeMember?.avatarSeed, "aster-avatar");
  assert.equal(runtimeMember?.displayName, "Aster Current");
  assert.equal(runtimeMember?.role, "analytics");
  assert.equal("employeeId" in (runtimeMember || {}), false);
  assert.equal(runtimeMember?.hasRuntimeProfile, true);
});

test("PostgresChannelRepository keeps inactive historical identity but removes active runtime capability", async () => {
  const client = new FakePostgresChannelClient();
  client.runtimeProfileIds.add("acme:aster");
  client.inactiveRuntimeProfileIds.add("acme:aster");
  client.memberProfiles.set("acme:aster", { avatarSeed: "aster-avatar", displayName: "Aster Current", role: "analytics" });
  const repository = createRepository(client);

  const saved = await repository.upsertChannel(channel());
  const runtimeMember = saved.members.find((member) => member.memberId === "aster");

  assert.equal(runtimeMember?.avatarSeed, "aster-avatar");
  assert.equal(runtimeMember?.displayName, "Aster Current");
  assert.equal(runtimeMember?.role, "analytics");
  assert.equal(runtimeMember?.hasRuntimeProfile, false);
});

test("PostgresChannelRepository lists channels by member id only", async () => {
  const client = new FakePostgresChannelClient();
  const repository = createRepository(client);
  await repository.upsertChannel(channel());

  const memberChannels = await repository.listChannelsForViewer("acme", {
    participantKind: "company_member",
    memberId: "aster",
  });

  assert.equal(memberChannels.length, 1);
});

test("PostgresChannelRepository hard deletes a Channel and its topic conversations", async () => {
  const client = new FakePostgresChannelClient();
  const deletedAttachmentPaths: string[][] = [];
  const repository = createRepository(client, async (paths) => { deletedAttachmentPaths.push(paths); });
  await repository.upsertChannel(channel());
  client.conversations.set("acme:conversation-topic", {
    company_id: "acme",
    conversation_id: "conversation-topic",
    conversation_kind: "topic",
    topic_state_json: { chatChannelId: "channel-growth" },
  });
  client.conversations.set("acme:conversation-dm", {
    company_id: "acme",
    conversation_id: "conversation-dm",
    conversation_kind: "direct",
    topic_state_json: undefined,
  });
  client.attachments.set("orphan", {
    companyId: "acme",
    localPath: "C:\\repo\\.data\\companies\\acme\\chat-attachments\\orphan\\original",
    conversationIds: ["conversation-topic"],
  });
  client.attachments.set("shared", {
    companyId: "acme",
    localPath: "C:\\repo\\.data\\companies\\acme\\chat-attachments\\shared\\original",
    conversationIds: ["conversation-topic", "conversation-dm"],
  });
  client.approvals.set("pending-topic", { companyId: "acme", contextKind: "channel_topic", contextId: "conversation-topic", status: "pending" });
  client.approvals.set("pending-dm", { companyId: "acme", contextKind: "dm_thread", contextId: "conversation-dm", status: "pending" });
  client.grants.set("topic-grant", { companyId: "acme", contextKind: "channel_topic", contextId: "conversation-topic" });
  client.grants.set("dm-grant", { companyId: "acme", contextKind: "dm_thread", contextId: "conversation-dm" });

  await repository.deleteChannel("acme", "channel-growth");

  assert.equal(client.channels.has("acme:channel-growth"), false);
  assert.equal([...client.members.keys()].some((key) => key.startsWith("acme:channel-growth:")), false);
  assert.equal(client.conversations.has("acme:conversation-topic"), false);
  assert.equal(client.conversations.has("acme:conversation-dm"), true);
  assert.deepEqual(client.reconciledTaskSourceChannels, ["channel-growth"]);
  assert.equal(client.attachments.has("orphan"), false);
  assert.equal(client.attachments.has("shared"), true);
  assert.deepEqual(deletedAttachmentPaths, [["C:\\repo\\.data\\companies\\acme\\chat-attachments\\orphan\\original"]]);
  assert.equal(client.approvals.get("pending-topic")?.status, "canceled");
  assert.equal(client.approvals.get("pending-topic")?.decisionNote, "Source Channel was dissolved.");
  assert.equal(client.approvals.get("pending-dm")?.status, "pending");
  assert.equal(client.grants.has("topic-grant"), false);
  assert.equal(client.grants.has("dm-grant"), true);
});

test("PostgresChannelRepository blocks dissolve while a Channel Topic execution is running", async () => {
  const client = new FakePostgresChannelClient();
  const repository = createRepository(client);
  await repository.upsertChannel(channel());
  client.activeExecutionConversationId = "conversation-running";

  await assert.rejects(
    repository.deleteChannel("acme", "channel-growth"),
    /active Chat execution/,
  );

  assert.equal(client.channels.has("acme:channel-growth"), true);
  assert.deepEqual(client.reconciledTaskSourceChannels, []);
});
