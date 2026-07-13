import type { ChannelTopic, Handoff } from "../domain/channel-topic.js";
import { ChannelTopicRepository } from "../repositories/channel-topic-repository.js";
import type { ChannelTopicStore } from "../storage/channel-topic-store.js";
import { DbChannelTopicStore } from "../storage/db-channel-topic-store.js";

function nowIso() {
  return new Date().toISOString();
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function trimOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function topicIdentityFrom(input: {
  roomId?: string;
  conversationId?: string;
  chatEntryId?: string;
}): Pick<ChannelTopic, "roomId" | "conversationId" | "chatEntryId" | "identitySource"> {
  const roomId = trimOptional(input.roomId || input.conversationId);
  const conversationId = trimOptional(input.conversationId || roomId);
  const chatEntryId = trimOptional(input.chatEntryId);
  if (!roomId && !conversationId && !chatEntryId) {
    throw new Error("ChannelTopic requires a TinyOffice-owned room, conversation, or chat entry id.");
  }

  return {
    ...(roomId ? { roomId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(chatEntryId ? { chatEntryId } : {}),
    identitySource: "tinyoffice_room",
  };
}

function mergeTopicIdentity(
  existing: ChannelTopic,
  next: Pick<ChannelTopic, "roomId" | "conversationId" | "chatEntryId" | "identitySource">,
): Pick<ChannelTopic, "roomId" | "conversationId" | "chatEntryId" | "identitySource"> {
  return {
    ...(next.roomId ? { roomId: next.roomId } : {}),
    ...(next.conversationId ? { conversationId: next.conversationId } : {}),
    ...(next.chatEntryId ? { chatEntryId: next.chatEntryId } : {}),
    identitySource: "tinyoffice_room",
  };
}

function topicIdentityChanged(left: ChannelTopic, right: ChannelTopic) {
  return left.roomId !== right.roomId ||
    left.conversationId !== right.conversationId ||
    left.chatEntryId !== right.chatEntryId ||
    left.identitySource !== right.identitySource;
}

function createHandoffId(input: {
  topicId: string;
  fromId: string;
  toId: string;
}) {
  return [
    "handoff",
    input.topicId,
    input.fromId,
    input.toId,
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join("-");
}

export class ChannelTopicService {
  constructor(private readonly repository: ChannelTopicRepository) {}

  async ensureChannelTopic(input: {
    channelTopicId: string;
    roomId?: string;
    conversationId?: string;
    chatEntryId?: string;
    ownerId: string;
    participantIds: string[];
  }): Promise<ChannelTopic> {
    const identity = topicIdentityFrom(input);
    const existing = await this.repository.getById(input.channelTopicId);
    if (existing) {
      const participantIds = unique([
        ...existing.participantIds,
        input.ownerId,
        ...input.participantIds,
      ]);
      const mergedIdentity = mergeTopicIdentity(existing, identity);
      const candidate: ChannelTopic = {
        ...existing,
        ...mergedIdentity,
        participantIds,
      };
      const changed =
        participantIds.length !== existing.participantIds.length ||
        participantIds.some((participantId, index) => participantId !== existing.participantIds[index]) ||
        topicIdentityChanged(existing, candidate);
      if (!changed) {
        return existing;
      }

      const updated: ChannelTopic = {
        ...candidate,
        lastActivityAt: nowIso(),
      };
      await this.repository.save(updated);
      return updated;
    }

    const timestamp = nowIso();
    const channelTopic: ChannelTopic = {
      id: input.channelTopicId,
      ...identity,
      participantIds: unique([input.ownerId, ...input.participantIds]),
      ownerId: input.ownerId,
      lastActivityAt: timestamp,
    };

    await this.repository.save(channelTopic);
    return channelTopic;
  }

  async routeToParticipant(input: {
    channelTopicId: string;
    roomId?: string;
    conversationId?: string;
    chatEntryId?: string;
    targetParticipantId: string;
    participantIds: string[];
  }): Promise<ChannelTopic> {
    const channelTopic = await this.ensureChannelTopic({
      channelTopicId: input.channelTopicId,
      roomId: input.roomId,
      conversationId: input.conversationId,
      chatEntryId: input.chatEntryId,
      ownerId: input.targetParticipantId,
      participantIds: input.participantIds,
    });

    const participantIds = unique([
      ...channelTopic.participantIds,
      input.targetParticipantId,
      ...input.participantIds,
    ]);
    const updated: ChannelTopic = {
      ...channelTopic,
      participantIds,
      ownerId: input.targetParticipantId,
      lastActivityAt: nowIso(),
    };

    await this.repository.save(updated);
    return updated;
  }

  async applyHandoff(input: {
    topicId: string;
    fromId: string;
    toId: string;
    message: string;
  }): Promise<{ topic: ChannelTopic; handoff: Handoff }> {
    const topic = await this.repository.getById(input.topicId);
    if (!topic) {
      throw new Error(`Topic ${input.topicId} does not exist.`);
    }
    if (topic.ownerId !== input.fromId) {
      throw new Error(`Topic ${input.topicId} is owned by ${topic.ownerId}, not ${input.fromId}.`);
    }
    if (!topic.participantIds.includes(input.toId)) {
      throw new Error(`Handoff target ${input.toId} is not a participant in topic ${input.topicId}.`);
    }

    const timestamp = nowIso();
    const updated: ChannelTopic = {
      ...topic,
      ownerId: input.toId,
      lastActivityAt: timestamp,
    };
    const handoff: Handoff = {
      id: createHandoffId({
        topicId: input.topicId,
        fromId: input.fromId,
        toId: input.toId,
      }),
      topicId: input.topicId,
      ...(topic.roomId ? { roomId: topic.roomId } : {}),
      ...(topic.conversationId ? { conversationId: topic.conversationId } : {}),
      ...(topic.chatEntryId ? { chatEntryId: topic.chatEntryId } : {}),
      fromId: input.fromId,
      toId: input.toId,
      message: input.message.trim(),
      createdAt: timestamp,
    };

    await this.repository.save(updated);
    await this.repository.appendHandoff(handoff);
    return { topic: updated, handoff };
  }

}

export interface ChannelTopicServices {
  store: ChannelTopicStore;
  channelTopicRepository: ChannelTopicRepository;
  channelTopicService: ChannelTopicService;
}

function createChannelTopicServicesFromStore(
  store: ChannelTopicStore,
): ChannelTopicServices {
  const channelTopicRepository = new ChannelTopicRepository(store);
  const channelTopicService = new ChannelTopicService(channelTopicRepository);

  return {
    store,
    channelTopicRepository,
    channelTopicService,
  };
}

export async function createDbChannelTopicServices(
  repoRoot: string,
  options: { companyId?: string } = {},
): Promise<ChannelTopicServices> {
  return createChannelTopicServicesFromStore(
    await DbChannelTopicStore.open({ repoRoot, companyId: options.companyId }),
  );
}
