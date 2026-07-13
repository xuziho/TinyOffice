import type { ChannelTopic } from "./channel-topic.js";

export type ChannelTopicInput = Partial<ChannelTopic> & {
  updatedAt?: string;
};

function normalizeSeenCursors(value: unknown): ChannelTopic["seenCursors"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const cursors: NonNullable<ChannelTopic["seenCursors"]> = {};
  for (const [memberId, cursor] of Object.entries(value)) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      continue;
    }
    const postId = (cursor as { postId?: unknown }).postId;
    const roomId = (cursor as { roomId?: unknown }).roomId;
    const messageId = (cursor as { messageId?: unknown }).messageId;
    const seenAt = (cursor as { seenAt?: unknown }).seenAt;
    const normalizedPostId = typeof postId === "string" && postId.trim()
      ? postId.trim()
      : undefined;
    const normalizedRoomId = typeof roomId === "string" && roomId.trim()
      ? roomId.trim()
      : undefined;
    const normalizedMessageId = typeof messageId === "string" && messageId.trim()
      ? messageId.trim()
      : undefined;
    if (!normalizedPostId && !normalizedRoomId && !normalizedMessageId) {
      continue;
    }
    cursors[memberId] = {
      ...(normalizedPostId ? { postId: normalizedPostId } : {}),
      ...(normalizedRoomId ? { roomId: normalizedRoomId } : {}),
      ...(normalizedMessageId ? { messageId: normalizedMessageId } : {}),
      seenAt: normalizeTimestamp(typeof seenAt === "string" ? seenAt : undefined),
    };
  }
  return Object.keys(cursors).length > 0 ? cursors : undefined;
}

function normalizeTimestamp(value?: string): string {
  if (!value) {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

export function normalizeChannelTopicInput(topic: ChannelTopicInput): ChannelTopic {
  const ownerId = topic.ownerId || "unknown-owner";
  const participantIds = topic.participantIds || [];
  const roomId = typeof topic.roomId === "string" && topic.roomId.trim()
    ? topic.roomId.trim()
    : undefined;
  const conversationId = typeof topic.conversationId === "string" && topic.conversationId.trim()
    ? topic.conversationId.trim()
    : roomId;
  const chatEntryId = typeof topic.chatEntryId === "string" && topic.chatEntryId.trim()
    ? topic.chatEntryId.trim()
    : undefined;
  const identitySource = "tinyoffice_room";
  return {
    id: topic.id || "unknown-topic",
    ...(roomId ? { roomId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(chatEntryId ? { chatEntryId } : {}),
    identitySource,
    ownerId,
    participantIds: Array.from(new Set([ownerId, ...participantIds])),
    lastActivityAt: normalizeTimestamp(topic.lastActivityAt || topic.updatedAt),
    seenCursors: normalizeSeenCursors(topic.seenCursors),
  };
}
