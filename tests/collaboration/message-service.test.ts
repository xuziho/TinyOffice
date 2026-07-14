import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryMessageRepository } from "../../src/collaboration/message/message-repository.js";
import { MessageService } from "../../src/collaboration/message/message-service.js";

const fixedNow = () => "2026-06-23T04:20:00.000Z";

function deterministicIds() {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  };
}

function makeService() {
  const repository = new InMemoryMessageRepository();
  const adapterCalls: Array<Record<string, unknown>> = [];
  return {
    adapterCalls,
    repository,
    service: new MessageService({
      createId: deterministicIds(),
      now: fixedNow,
      repository,
    }),
  };
}

function makeServiceWithAttachmentResolver() {
  const repository = new InMemoryMessageRepository();
  const requestedAttachmentIds: string[][] = [];
  return {
    repository,
    requestedAttachmentIds,
    service: new MessageService({
      createId: deterministicIds(),
      now: fixedNow,
      repository,
      attachmentResolver: {
        async listAttachments(companyId, attachmentIds) {
          requestedAttachmentIds.push(attachmentIds);
          return attachmentIds.map((attachmentId) => ({
            attachmentId,
            fileName: `${attachmentId}.png`,
            mimeType: "image/png",
            byteLength: 4,
            previewUrl: `/api/companies/${companyId}/chat/attachments/${attachmentId}/content`,
            downloadUrl: `/api/companies/${companyId}/chat/attachments/${attachmentId}/content?download=1`,
            storageKey: `companies/${companyId}/chat-attachments/${attachmentId}/original`,
            contentSha256: "sha",
          }));
        },
      },
    }),
  };
}

class FailingMessageRepository extends InMemoryMessageRepository {
  failNextMessageUpsert = false;
  failNextConversationUpdateWithLastMessage = false;

  override async upsertMessage(record: Parameters<InMemoryMessageRepository["upsertMessage"]>[0]): Promise<void> {
    if (this.failNextMessageUpsert) {
      this.failNextMessageUpsert = false;
      throw new Error("injected message write failure");
    }
    await super.upsertMessage(record);
  }

  override async upsertConversation(record: Parameters<InMemoryMessageRepository["upsertConversation"]>[0]): Promise<void> {
    await super.upsertConversation(record);
    if (this.failNextConversationUpdateWithLastMessage && record.conversation.lastMessageId) {
      this.failNextConversationUpdateWithLastMessage = false;
      throw new Error("injected conversation state write failure");
    }
  }
}

test("message service creates, lists, gets, sends, and lists messages using TinyOffice ids only", async () => {
  const { adapterCalls, service } = makeService();

  const conversation = await service.createConversation("acme", {
    title: "Launch room",
    conversationKind: "shared",
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
        role: "growth",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
        role: "automation",
      },
    ],
  });

  assert.equal(conversation.companyId, "acme");
  assert.equal(conversation.conversationId, "conversation-1");
  assert.equal(conversation.participants[0]?.participantId, "participant-1");
  assert.doesNotMatch(JSON.stringify(conversation), /mm-|team_id|teamId|channel_id|channelId|user_id|userId|post_id|postId/);

  const listed = await service.listConversations("acme", { participantKind: "company_member", memberId: "iris-growth" });
  assert.deepEqual(listed.conversations.map((item) => item.conversationId), ["conversation-1"]);

  const fetched = await service.getConversation("acme", "conversation-1");
  assert.equal(fetched?.conversationId, "conversation-1");

  const sent = await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, "Ready for QA.");
  assert.equal(sent.message.messageId, "message-1");
  assert.equal(sent.message.sender.memberId, "iris-growth");
  assert.equal(sent.message.body, "Ready for QA.");
  assert.equal(sent.realtimeEvent.companyId, "acme");
  assert.equal(sent.realtimeEvent.conversationId, "conversation-1");
  assert.equal(sent.realtimeEvent.eventId, "realtime-event-1");
  assert.equal(sent.realtimeEvent.sequence, 1);
  assert.equal(sent.realtimeEvent.messageId, "message-1");
  assert.equal(sent.realtimeEvent.actorMemberId, "iris-growth");
  assert.doesNotMatch(JSON.stringify(sent), /mm-|team_id|teamId|channel_id|channelId|user_id|userId|post_id|postId/);

  const messages = await service.listMessages("acme", "conversation-1");
  assert.deepEqual(messages.messages.map((item) => item.messageId), ["message-1"]);

  assert.deepEqual(adapterCalls, []);
});

test("message service reply and read path works without adapter or carrier rows", async () => {
  const { adapterCalls, service } = makeService();

  await service.createConversation("acme", {
    title: "Carrier-free room",
    conversationKind: "topic",
    topic: {
      topicId: "topic-carrier-free",
      title: "Carrier-free room",
    },
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
    ],
  });

  const reply = await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "nora-automation" }, "Reply without carrier delivery.");
  assert.equal(reply.message.messageId, "message-1");
  assert.equal(reply.message.conversationId, "conversation-1");
  assert.equal(reply.realtimeEvent.type, "message.created");

  const read = await service.markConversationRead("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, "message-1");
  assert.equal(read.realtimeEvent.type, "participant.read_state.updated");
  assert.equal(
    read.conversation.participantStates.find((state) => state.memberId === "iris-growth")?.lastReadMessageId,
    "message-1",
  );
  assert.deepEqual((await service.listMessages("acme", "conversation-1")).messages.map((message) => message.messageId), ["message-1"]);
  assert.deepEqual(adapterCalls, []);
});

test("marking a conversation read does not change conversation activity time", async () => {
  const repository = new InMemoryMessageRepository();
  const timestamps = [
    "2026-06-23T04:20:00.000Z",
    "2026-06-23T04:21:00.000Z",
    "2026-06-23T04:22:00.000Z",
  ];
  const service = new MessageService({
    createId: deterministicIds(),
    now: () => timestamps.shift() ?? "2026-06-23T04:23:00.000Z",
    repository,
  });

  await service.createConversation("acme", {
    title: "Read-only view",
    conversationKind: "shared",
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
    ],
  });
  const sent = await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "nora-automation" }, "Status is ready.");
  const activityUpdatedAt = sent.conversation.updatedAt;

  const read = await service.markConversationRead(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "iris-growth" },
    "message-1",
  );

  assert.equal(read.conversation.updatedAt, activityUpdatedAt);
  assert.equal(
    read.conversation.participantStates.find((state) => state.memberId === "iris-growth")?.updatedAt,
    "2026-06-23T04:22:00.000Z",
  );
});

test("message service supports Company Member participants, senders, and read state without employee fallback", async () => {
  const { adapterCalls, service } = makeService();

  const conversation = await service.createConversation("acme", {
    title: "Boss and automation",
    conversationKind: "shared",
    participants: [
      {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xu Ziho",
        role: "boss",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
        role: "automation",
      },
    ],
  });

  assert.equal(conversation.participants[0]?.participantKind, "company_member");
  assert.equal(conversation.participants[0]?.memberId, "xuziho");
  assert.deepEqual(conversation.participantStates.map((state) => [state.memberId, state.unreadCount]), [
    ["xuziho", 0],
    ["nora-automation", 0],
  ]);
  assert.deepEqual((await service.listConversations("acme", { participantKind: "company_member", memberId: "xuziho" })).conversations.map((item) => item.conversationId), [
    "conversation-1",
  ]);

  const memberSent = await service.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
    "Nora, please prepare the status.",
  );

  assert.equal(memberSent.message.sender.participantKind, "company_member");
  assert.equal(memberSent.message.sender.memberId, "xuziho");
  assert.equal(memberSent.realtimeEvent.actorMemberId, "xuziho");
  assert.deepEqual(memberSent.conversation.participantStates.map((state) => [state.memberId, state.unreadCount, state.lastReadMessageId]), [
    ["xuziho", 0, "message-1"],
    ["nora-automation", 1, undefined],
  ]);

  const automationSent = await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "nora-automation" }, "Status is ready.");
  assert.equal(automationSent.message.sender.participantKind, "company_member");
  assert.equal(automationSent.message.sender.memberId, "nora-automation");
  assert.equal(automationSent.realtimeEvent.actorMemberId, "nora-automation");

  const memberRead = await service.markConversationRead(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
  );
  const memberState = memberRead.conversation.participantStates.find((state) => state.memberId === "xuziho");
  assert.equal(memberState?.lastReadMessageId, "message-2");
  assert.equal(memberState?.unreadCount, 0);
  assert.equal(memberRead.realtimeEvent.actorMemberId, "xuziho");
  assert.equal(memberRead.realtimeEvent.payload.participantId, conversation.participants[0]?.participantId);
  assert.deepEqual(adapterCalls, []);
});

test("message service rejects retired employee selectors for conversation participants and senders", async () => {
  const { service } = makeService();

  await assert.rejects(
    () => service.createConversation("acme", {
      title: "Legacy participant",
      conversationKind: "shared",
      participants: [
        {
          participantKind: "employee",
          employeeId: "iris-growth",
          displayName: "Iris",
        },
      ],
    }),
    /participants\[0\]\.memberId is required; employeeId is not accepted/,
  );

  await service.createConversation("acme", {
    title: "Member room",
    conversationKind: "shared",
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
    ],
  });

  await assert.rejects(
    () => service.sendMessage("acme", "conversation-1", "iris-growth", "legacy string sender"),
    /sender memberId is required; employee string selectors are not accepted/,
  );
  await assert.rejects(
    () => service.sendMessage("acme", "conversation-1", { participantKind: "employee", employeeId: "iris-growth" }, "legacy employee sender"),
    /sender.memberId is required; employeeId is not accepted/,
  );
  await assert.rejects(
    () => service.markConversationRead("acme", "conversation-1", { participantKind: "employee", employeeId: "iris-growth" }),
    /viewer.memberId is required; employeeId is not accepted/,
  );
});

test("message service can create a standalone Chat conversation and first message without legacy Mattermost projection", async () => {
  const { adapterCalls, service } = makeService();

  const created = await service.createConversationWithFirstMessage("acme", {
    conversation: {
      title: "Standalone topic",
      conversationKind: "topic",
      topic: {
        topicId: "topic-standalone",
        title: "Standalone topic",
      },
      participants: [
        {
          participantKind: "company_member",
          memberId: "iris-growth",
          displayName: "Iris",
        },
      ],
    },
    firstMessage: {
      sender: { participantKind: "company_member", memberId: "iris-growth" },
      body: "First standalone Chat message.",
    },
  });

  assert.equal(created.message.messageId, "message-1");
  assert.equal(created.conversation.lastMessageId, "message-1");
  assert.equal((await service.getConversation("acme", "conversation-1"))?.lastMessageId, "message-1");
  assert.deepEqual((await service.listMessages("acme", "conversation-1")).messages.map((message) => message.messageId), ["message-1"]);
  assert.deepEqual(adapterCalls, []);
});

test("message service rolls back standalone Chat create-entry when first message write fails", async () => {
  const repository = new FailingMessageRepository();
  const service = new MessageService({
    createId: deterministicIds(),
    now: fixedNow,
    repository,
  });

  repository.failNextMessageUpsert = true;
  await assert.rejects(
    () =>
      service.createConversationWithFirstMessage("acme", {
        conversation: {
          title: "Failed starter",
          conversationKind: "topic",
          participants: [{
            participantKind: "company_member",
            memberId: "iris-growth",
            displayName: "Iris",
          }],
        },
        firstMessage: {
          sender: { participantKind: "company_member", memberId: "iris-growth" },
          body: "This should roll back.",
        },
      }),
    /injected message write failure/,
  );

  assert.equal(await repository.getConversation("acme", "conversation-1"), undefined);
  assert.deepEqual((await service.listConversations("acme", { participantKind: "company_member", memberId: "iris-growth" })).conversations, []);
  assert.deepEqual((await service.listMessages("acme", "conversation-1")).messages, []);
});

test("message service rolls back standalone Chat replies when conversation state write fails", async () => {
  const repository = new FailingMessageRepository();
  const service = new MessageService({
    createId: deterministicIds(),
    now: fixedNow,
    repository,
  });

  await service.createConversation("acme", {
    title: "Rollback reply room",
    conversationKind: "topic",
    participants: [{
      participantKind: "company_member",
      memberId: "iris-growth",
      displayName: "Iris",
    }],
  });

  repository.failNextConversationUpdateWithLastMessage = true;
  await assert.rejects(
    () =>
      service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, "This reply should roll back."),
    /injected conversation state write failure/,
  );

  assert.deepEqual((await service.listMessages("acme", "conversation-1")).messages, []);
  assert.equal((await service.getConversation("acme", "conversation-1"))?.lastMessageId, undefined);
});

test("message service rejects missing company context and cross-company access", async () => {
  const { repository, service } = makeService();

  await assert.rejects(
    () =>
      service.createConversation("", {
        title: "No company",
        conversationKind: "direct",
        participants: [],
      }),
    /explicit companyId is required/,
  );
  await assert.rejects(() => service.listConversations(" ", { participantKind: "company_member", memberId: "iris-growth" }), /explicit companyId is required/);

  await service.createConversation("acme", {
    title: "Acme private thread",
    conversationKind: "direct",
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
    ],
  });

  await assert.rejects(
    () => service.getConversation("other-company", "conversation-1"),
    /companyId mismatch/,
  );
  await assert.rejects(
    () => service.sendMessage("other-company", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, "Cross-company leak."),
    /companyId mismatch/,
  );
  assert.deepEqual((await service.listConversations("other-company", { participantKind: "company_member", memberId: "iris-growth" })).conversations, []);
});

test("message service persists topic state, unread mention projection, attachment metadata, and runtime evidence links", async () => {
  const { repository, service } = makeService();

  const conversation = await service.createConversation("acme", {
    title: "Launch topic room",
    conversationKind: "topic",
    topic: {
      topicId: "topic-launch",
      title: "Launch topic room",
      status: "open",
    },
    runtimeLinks: [{
      linkId: "runtime-link-session",
      targetKind: "session",
      targetId: "session-123",
      label: "Planning session",
    }],
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
        role: "growth",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
        role: "automation",
      },
    ],
  });

  assert.equal(conversation.topic?.topicId, "topic-launch");
  assert.deepEqual(conversation.participantStates.map((state) => [state.memberId, state.unreadCount, state.mentionCount]), [
    ["iris-growth", 0, 0],
    ["nora-automation", 0, 0],
  ]);
  assert.equal(conversation.runtimeLinks[0]?.targetKind, "session");

  const sent = await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, "Nora, please check the trace.", {
    attachments: [{
      attachmentId: "attachment-brief",
      fileName: "brief.md",
      mimeType: "text/markdown",
      byteLength: 42,
      storageKey: "company/acme/conversations/conversation-1/brief.md",
      contentSha256: "abc123",
      metadata: { source: "upload" },
    }],
    mentionedMemberIds: ["nora-automation"],
    runtimeLinks: [{
      linkId: "runtime-link-workrun",
      targetKind: "work_run",
      targetId: "workrun-456",
      label: "QA WorkRun",
    }],
  });

  assert.equal(sent.message.mentions[0]?.memberId, "nora-automation");
  assert.equal(sent.message.attachments[0]?.fileName, "brief.md");
  assert.equal(sent.message.attachments[0]?.contentSha256, "abc123");
  assert.equal(sent.message.runtimeLinks[0]?.targetKind, "work_run");
  assert.equal(sent.conversation.realtimeSequence, 1);
  assert.deepEqual(sent.conversation.participantStates.map((state) => [state.memberId, state.unreadCount, state.mentionCount, state.lastMentionMessageId]), [
    ["iris-growth", 0, 0, undefined],
    ["nora-automation", 1, 1, "message-1"],
  ]);
  assert.doesNotMatch(JSON.stringify(sent), /mm-|team_id|teamId|channel_id|channelId|user_id|userId|post_id|postId/);

  const read = await service.markConversationRead("acme", "conversation-1", { participantKind: "company_member", memberId: "nora-automation" });
  const noraState = read.conversation.participantStates.find((state) => state.memberId === "nora-automation");
  assert.equal(noraState?.lastReadMessageId, "message-1");
  assert.equal(noraState?.unreadCount, 0);
  assert.equal(noraState?.mentionCount, 0);
  assert.equal(read.realtimeEvent.type, "participant.read_state.updated");
  assert.equal(read.realtimeEvent.eventId, "realtime-event-2");
  assert.equal(read.realtimeEvent.companyId, "acme");
  assert.equal(read.realtimeEvent.conversationId, "conversation-1");
  assert.equal(read.realtimeEvent.actorMemberId, "nora-automation");
  assert.equal(read.realtimeEvent.sequence, 2);
  assert.equal(read.conversation.realtimeSequence, 2);
  assert.doesNotMatch(JSON.stringify(read.realtimeEvent), /mm-|carrier|providerUserId|teamId|channelId|postId|userId/);

  const messages = await service.listMessages("acme", "conversation-1");
  assert.equal(messages.messages[0]?.runtimeLinks[0]?.targetId, "workrun-456");
  assert.equal(messages.messages[0]?.attachments[0]?.storageKey, "company/acme/conversations/conversation-1/brief.md");
});

test("message service archives topic conversations without deleting messages", async () => {
  const { service } = makeService();

  await service.createConversation("acme", {
    title: "Launch topic room",
    conversationKind: "topic",
    topic: {
      topicId: "topic-launch",
      title: "Launch topic room",
      status: "open",
    },
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
    ],
  });
  await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, "Keep this for records.");

  const archived = await service.archiveConversationTopic(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "iris-growth" },
  );

  assert.equal(archived.topic?.status, "archived");
  assert.equal(archived.realtimeSequence, 2);
  assert.equal((await service.getConversation("acme", "conversation-1"))?.topic?.status, "archived");
  assert.deepEqual((await service.listMessages("acme", "conversation-1")).messages.map((message) => message.body), [
    "Keep this for records.",
  ]);
});

test("message service restores archived topic conversations without deleting messages", async () => {
  const { service } = makeService();

  await service.createConversation("acme", {
    title: "Launch topic room",
    conversationKind: "topic",
    topic: {
      topicId: "topic-launch",
      title: "Launch topic room",
      status: "open",
    },
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
      },
    ],
  });
  await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, "Restore this later.");
  await service.archiveConversationTopic(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "iris-growth" },
  );

  const restored = await service.restoreConversationTopic(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "iris-growth" },
  );

  assert.equal(restored.topic?.status, "open");
  assert.equal(restored.realtimeSequence, 3);
  assert.equal((await service.getConversation("acme", "conversation-1"))?.topic?.status, "open");
  assert.deepEqual((await service.listMessages("acme", "conversation-1")).messages.map((message) => message.body), [
    "Restore this later.",
  ]);
});

test("message service archives a direct conversation per participant and new messages reactivate it", async () => {
  const { service } = makeService();
  await service.createConversation("acme", {
    title: "Avery DM",
    conversationKind: "direct",
    participants: [
      { participantKind: "company_member", memberId: "xuziho", displayName: "Xu" },
      { participantKind: "company_member", memberId: "avery", displayName: "Avery" },
    ],
  });

  const archived = await service.archiveConversationTopic("acme", "conversation-1", {
    participantKind: "company_member",
    memberId: "xuziho",
  });
  assert.ok(archived.participantStates.find((state) => state.memberId === "xuziho")?.archivedAt);
  assert.equal(archived.participantStates.find((state) => state.memberId === "avery")?.archivedAt, undefined);

  const restored = await service.restoreConversationTopic("acme", "conversation-1", {
    participantKind: "company_member",
    memberId: "xuziho",
  });
  assert.equal(restored.participantStates.find((state) => state.memberId === "xuziho")?.archivedAt, undefined);

  await service.archiveConversationTopic("acme", "conversation-1", { participantKind: "company_member", memberId: "xuziho" });
  const sent = await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "avery" }, "New information");
  assert.equal(sent.conversation.participantStates.some((state) => state.archivedAt), false);
});

test("message service resolves attachmentIds into immutable message snapshots", async () => {
  const { requestedAttachmentIds, service } = makeServiceWithAttachmentResolver();

  await service.createConversation("acme", {
    title: "Image room",
    conversationKind: "topic",
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
    ],
  });

  const sent = await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, "Please inspect this screenshot.", {
    attachmentIds: ["att-screen"],
  });

  assert.deepEqual(requestedAttachmentIds, [["att-screen"]]);
  assert.deepEqual(sent.message.attachments, [{
    schema: "conversation-attachment",
    version: 1,
    companyId: "acme",
    conversationId: "conversation-1",
    messageId: "message-1",
    attachmentId: "att-screen",
    fileName: "att-screen.png",
    mimeType: "image/png",
    byteLength: 4,
    previewUrl: "/api/companies/acme/chat/attachments/att-screen/content",
    downloadUrl: "/api/companies/acme/chat/attachments/att-screen/content?download=1",
    storageKey: "companies/acme/chat-attachments/att-screen/original",
    contentSha256: "sha",
    metadata: undefined,
    createdAt: fixedNow(),
  }]);
});

test("message service accepts an image-only message and still rejects an empty message", async () => {
  const { service } = makeServiceWithAttachmentResolver();
  await service.createConversation("acme", {
    title: "Image room",
    conversationKind: "topic",
    participants: [{ participantKind: "company_member", memberId: "iris-growth", displayName: "Iris" }],
  });

  const sent = await service.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "iris-growth" },
    "",
    { attachmentIds: ["att-screen"] },
  );
  assert.equal(sent.message.body, "");
  assert.equal(sent.message.attachments.length, 1);
  await assert.rejects(
    () => service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, ""),
    /message body or attachmentIds is required/,
  );
});

test("message service rejects attachmentIds when no attachment resolver is configured", async () => {
  const { service } = makeService();

  await service.createConversation("acme", {
    title: "Image room",
    conversationKind: "topic",
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
    ],
  });

  await assert.rejects(
    () => service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, "Please inspect this screenshot.", {
      attachmentIds: ["att-screen"],
    }),
    /Chat attachment resolver is required when sending attachmentIds/,
  );
});

test("message service records runtime employee mentions for member-backed channel participants", async () => {
  const { service } = makeService();

  await service.createConversation("acme", {
    title: "Growth topic",
    conversationKind: "topic",
    topic: {
      topicId: "topic-growth",
      title: "Growth topic",
      status: "open",
    },
    participants: [
      {
        participantKind: "company_member",
        memberId: "xuziho",
        displayName: "Xuziho",
        role: "owner",
      },
      {
        participantKind: "company_member",
        memberId: "nora-automation",
        displayName: "Nora",
        role: "automation",
      },
    ],
  });

  const sent = await service.sendMessage(
    "acme",
    "conversation-1",
    { participantKind: "company_member", memberId: "xuziho" },
    "@Nora please confirm receipt.",
    { mentionedMemberIds: ["nora-automation"] },
  );

  assert.deepEqual(sent.message.mentions.map((mention) => [mention.participantId, mention.memberId]), [
    ["participant-2", "nora-automation"],
  ]);
  assert.deepEqual(sent.conversation.participantStates.map((state) => [state.memberId, state.unreadCount, state.mentionCount, state.lastMentionMessageId]), [
    ["xuziho", 0, 0, undefined],
    ["nora-automation", 1, 1, "message-1"],
  ]);
});

test("message service lists latest conversation messages in chronological order for runtime context", async () => {
  const { service } = makeService();

  await service.createConversation("acme", {
    title: "Long running topic",
    conversationKind: "topic",
    topic: {
      topicId: "topic-long-running",
      title: "Long running topic",
      status: "open",
    },
    participants: [
      {
        participantKind: "company_member",
        memberId: "iris-growth",
        displayName: "Iris",
      },
    ],
  });

  for (let index = 1; index <= 6; index += 1) {
    await service.sendMessage("acme", "conversation-1", { participantKind: "company_member", memberId: "iris-growth" }, `Message ${index}`);
  }

  const latest = await service.listRecentMessages("acme", "conversation-1", { limit: 3 });

  assert.deepEqual(latest.messages.map((message) => message.body), [
    "Message 4",
    "Message 5",
    "Message 6",
  ]);
});

test("message service lists every conversation message after a runtime context cursor", async () => {
  let timestampIndex = 0;
  const repository = new InMemoryMessageRepository();
  const service = new MessageService({
    createId: deterministicIds(),
    now: () => new Date(Date.UTC(2026, 6, 14, 10, 0, timestampIndex++)).toISOString(),
    repository,
  });
  await service.createConversation("acme", {
    title: "Long incremental topic",
    conversationKind: "topic",
    topic: { topicId: "topic-incremental", title: "Long incremental topic", status: "open" },
    participants: [{ participantKind: "company_member", memberId: "iris-growth", displayName: "Iris" }],
  });
  const sent = [];
  for (let index = 1; index <= 25; index += 1) {
    sent.push(await service.sendMessage(
      "acme",
      "conversation-1",
      { participantKind: "company_member", memberId: "iris-growth" },
      `Incremental ${index}`,
    ));
  }

  const after = await service.listMessagesAfter("acme", "conversation-1", {
    messageId: sent[1]!.message.messageId,
    createdAt: sent[1]!.message.createdAt,
  });

  assert.equal(after.messages.length, 23);
  assert.equal(after.messages[0]?.body, "Incremental 3");
  assert.equal(after.messages.at(-1)?.body, "Incremental 25");
});

test("message service updates topic summary only on topic conversations", async () => {
  const { service } = makeService();
  const created = await service.createConversationWithFirstMessage("acme", {
    conversation: {
      title: "Launch coordination",
      conversationKind: "topic",
      topic: {
        title: "Launch coordination",
        chatChannelId: "chat-channel-1",
      },
      participants: [
        { participantKind: "company_member", memberId: "iris-growth", displayName: "Iris" },
        { participantKind: "company_member", memberId: "nora-automation", displayName: "Nora" },
      ],
    },
    firstMessage: {
      sender: { participantKind: "company_member", memberId: "iris-growth" },
      body: "Nora, please own the launch checklist.",
    },
  });

  const updated = await service.updateConversationTopicSummary("acme", created.conversation.conversationId, {
    text: "Iris asked Nora to own the launch checklist.",
    sourceMessageId: created.message.messageId,
  });

  assert.deepEqual(updated.topic?.summary, {
    text: "Iris asked Nora to own the launch checklist.",
    sourceMessageId: created.message.messageId,
    updatedAt: fixedNow(),
  });
  assert.equal(updated.topic?.updatedAt, fixedNow());

  const direct = await service.createConversation("acme", {
    title: "Direct room",
    conversationKind: "direct",
    participants: [
      { participantKind: "company_member", memberId: "iris-growth", displayName: "Iris" },
      { participantKind: "company_member", memberId: "nora-automation", displayName: "Nora" },
    ],
  });
  await assert.rejects(
    () => service.updateConversationTopicSummary("acme", direct.conversationId, {
      text: "Should not save.",
      sourceMessageId: created.message.messageId,
    }),
    /topic summary requires a topic conversation/,
  );
});

test("message service persists Topic handoff ownership and clears it when the owner replies", async () => {
  const { service } = makeService();
  const conversation = await service.createConversation("acme", {
    title: "Launch approval",
    conversationKind: "topic",
    topic: { title: "Launch approval", chatChannelId: "chat-channel-1" },
    participants: [
      { participantKind: "company_member", memberId: "xuziho", displayName: "Xu" },
      { participantKind: "company_member", memberId: "avery", displayName: "Avery" },
    ],
  });
  const xuParticipantId = conversation.participants.find((participant) => participant.memberId === "xuziho")?.participantId;
  assert.ok(xuParticipantId);

  const handedOff = await service.sendMessage(
    "acme",
    conversation.conversationId,
    { participantKind: "company_member", memberId: "avery" },
    "Xu, the final launch decision is ready for you.",
    { topicOwnerId: "xuziho" },
  );
  assert.equal(handedOff.conversation.topic?.ownerParticipantId, xuParticipantId);

  const replied = await service.sendMessage(
    "acme",
    conversation.conversationId,
    { participantKind: "company_member", memberId: "xuziho" },
    "Approved. Continue the launch.",
  );
  assert.equal(replied.conversation.topic?.ownerParticipantId, undefined);
});
