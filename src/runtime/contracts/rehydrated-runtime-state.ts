import type { Approval } from "../../governance/domain/approval.js";
import type { EmployeePolicy } from "../../governance/domain/employee-policy.js";
import type { ChannelTopic } from "../../channel-topics/domain/channel-topic.js";

export interface RehydratedRuntimeState {
  channelTopic?: ChannelTopic;
  approvals: Approval[];
  policy?: EmployeePolicy;
  rehydratedAt: string;
}
