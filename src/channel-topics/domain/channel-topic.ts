export type ChannelTopicIdentitySource = "tinyoffice_room";

export interface ChannelTopicSeenCursor {
  postId?: string;
  roomId?: string;
  messageId?: string;
  seenAt: string;
}

export interface ChannelTopic {
  id: string;
  roomId?: string;
  conversationId?: string;
  chatEntryId?: string;
  identitySource: ChannelTopicIdentitySource;
  participantIds: string[];
  ownerId: string;
  lastActivityAt: string;
  seenCursors?: Record<string, ChannelTopicSeenCursor>;
}

export type Topic = ChannelTopic;

export interface Handoff {
  id: string;
  topicId: string;
  roomId?: string;
  conversationId?: string;
  chatEntryId?: string;
  actionId?: string;
  fromId: string;
  toId: string;
  message: string;
  createdAt: string;
}
