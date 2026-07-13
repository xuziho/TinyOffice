import type { ChannelTopic, Handoff } from "../domain/channel-topic.js";
import {
  normalizeChannelTopicInput,
  type ChannelTopicInput,
} from "../domain/channel-topic-normalization.js";
import type { ChannelTopicStore } from "../storage/channel-topic-store.js";

function normalizeChannelTopic(channelTopic: ChannelTopicInput): ChannelTopic {
  return normalizeChannelTopicInput(channelTopic);
}

function normalizeHandoff(handoff: Handoff): Handoff {
  return {
    id: handoff.id,
    topicId: handoff.topicId,
    ...(handoff.roomId ? { roomId: handoff.roomId } : {}),
    ...(handoff.conversationId ? { conversationId: handoff.conversationId } : {}),
    ...(handoff.chatEntryId ? { chatEntryId: handoff.chatEntryId } : {}),
    ...(handoff.actionId ? { actionId: handoff.actionId } : {}),
    fromId: handoff.fromId,
    toId: handoff.toId,
    message: handoff.message,
    createdAt: handoff.createdAt,
  };
}

function hasOwnedTopicIdentity(channelTopic: ChannelTopic) {
  return Boolean(channelTopic.roomId || channelTopic.conversationId || channelTopic.chatEntryId);
}

function assertCurrentTopicIdentity(
  channelTopic: ChannelTopic,
  existing?: ChannelTopic,
) {
  if (hasOwnedTopicIdentity(channelTopic)) {
    return;
  }
  throw new Error(
    "ChannelTopic records require a TinyOffice-owned room, conversation, or chat entry id.",
  );
}

export class ChannelTopicRepository {
  constructor(private readonly store: ChannelTopicStore) {}

  async getById(channelTopicId: string): Promise<ChannelTopic | undefined> {
    const state = await this.store.load();
    const channelTopic = state.channelTopics.find((item) => item.id === channelTopicId);
    return channelTopic ? normalizeChannelTopic(channelTopic) : undefined;
  }

  async list(): Promise<ChannelTopic[]> {
    const state = await this.store.load();
    return state.channelTopics.map(normalizeChannelTopic);
  }

  async listHandoffs(topicId?: string): Promise<Handoff[]> {
    const state = await this.store.load();
    return state.handoffs
      .filter((handoff) => !topicId || handoff.topicId === topicId)
      .map(normalizeHandoff);
  }

  async save(channelTopic: ChannelTopic): Promise<ChannelTopic> {
    const normalizedChannelTopic = normalizeChannelTopic(channelTopic);
    return this.store.update((state) => {
      const index = state.channelTopics.findIndex(
        (item) => item.id === normalizedChannelTopic.id,
      );
      const existing = index >= 0
        ? normalizeChannelTopic(state.channelTopics[index])
        : undefined;
      assertCurrentTopicIdentity(normalizedChannelTopic, existing);
      if (index >= 0) {
        state.channelTopics[index] = normalizedChannelTopic;
      } else {
        state.channelTopics.push(normalizedChannelTopic);
      }

      return normalizedChannelTopic;
    });
  }

  async appendHandoff(handoff: Handoff): Promise<Handoff> {
    const normalized = normalizeHandoff(handoff);
    return this.store.update((state) => {
      state.handoffs.push(normalized);
      return normalized;
    });
  }
}
