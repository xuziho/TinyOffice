import type { ChannelTopic, Handoff } from "./channel-topic.js";

export interface ChannelTopicState {
  channelTopics: ChannelTopic[];
  handoffs: Handoff[];
}

export function createEmptyChannelTopicState(): ChannelTopicState {
  return {
    channelTopics: [],
    handoffs: [],
  };
}
