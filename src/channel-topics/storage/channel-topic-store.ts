import type { ChannelTopicState } from "../domain/channel-topic-state.js";

export interface ChannelTopicStore {
  load(): Promise<ChannelTopicState>;
  save(state: ChannelTopicState): Promise<void>;
  update<T>(updater: (state: ChannelTopicState) => Promise<T> | T): Promise<T>;
  close(): void;
}
