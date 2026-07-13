import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelTopicState } from "../../src/channel-topics/domain/channel-topic-state.js";
import { createEmptyChannelTopicState } from "../../src/channel-topics/domain/channel-topic-state.js";
import { ChannelTopicRepository } from "../../src/channel-topics/repositories/channel-topic-repository.js";
import { ChannelTopicService } from "../../src/channel-topics/services/channel-topic-service.js";
import type { ChannelTopicStore } from "../../src/channel-topics/storage/channel-topic-store.js";

class MemoryChannelTopicStore implements ChannelTopicStore {
  constructor(private state: ChannelTopicState = createEmptyChannelTopicState()) {}

  async load(): Promise<ChannelTopicState> {
    return {
      channelTopics: [...this.state.channelTopics],
      handoffs: [...this.state.handoffs],
    };
  }

  async save(state: ChannelTopicState): Promise<void> {
    this.state = {
      channelTopics: [...state.channelTopics],
      handoffs: [...state.handoffs],
    };
  }

  async update<T>(updater: (state: ChannelTopicState) => Promise<T> | T): Promise<T> {
    const next = await this.load();
    const result = await updater(next);
    await this.save(next);
    return result;
  }

  close(): void {}
}

function service() {
  const store = new MemoryChannelTopicStore();
  return new ChannelTopicService(new ChannelTopicRepository(store));
}

test("ChannelTopic repository rejects records without owned topic identity", async () => {
  const repository = new ChannelTopicRepository(new MemoryChannelTopicStore());

  await assert.rejects(
    () => repository.save({
      id: "channel-topic-repository-missing-owned-id",
      identitySource: "tinyoffice_room",
      ownerId: "nora-automation",
      participantIds: ["nora-automation"],
      lastActivityAt: "2026-06-28T00:00:00.000Z",
    }),
    /require a TinyOffice-owned room, conversation, or chat entry id/,
  );
});

test("ChannelTopic service rejects missing owned identity for new product topics", async () => {
  await assert.rejects(
    () => service().ensureChannelTopic({
      channelTopicId: "channel-topic-missing-owned-id",
      ownerId: "nora-automation",
      participantIds: ["xuziho"],
    }),
    /requires a TinyOffice-owned room, conversation, or chat entry id/,
  );
});

test("ChannelTopic service stores owned room identity", async () => {
  const topic = await service().ensureChannelTopic({
    channelTopicId: "channel-topic-owned",
    roomId: "conversation-topic-owned",
    chatEntryId: "chat-entry-topic-owned",
    ownerId: "nora-automation",
    participantIds: ["xuziho"],
  });

  assert.equal(topic.identitySource, "tinyoffice_room");
  assert.equal(topic.roomId, "conversation-topic-owned");
  assert.equal(topic.conversationId, "conversation-topic-owned");
  assert.equal(topic.chatEntryId, "chat-entry-topic-owned");
  assert.deepEqual(topic.participantIds, ["nora-automation", "xuziho"]);
});
