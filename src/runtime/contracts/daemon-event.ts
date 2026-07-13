import type { ActionDispatchRequest } from "../../collaboration/contracts/action-dispatch.js";

export type EmployeeDaemonEventSource =
  | "channel_topic_dispatch"
  | "approval_resolution";

export type EmployeeDaemonSceneType =
  | "channel_thread"
  | "dm_thread";

export interface EmployeeDaemonEventSession {
  targetMemberId: string;
  sceneType: EmployeeDaemonSceneType;
  channelId?: string;
  sessionKey?: string;
}

export interface EmployeeDaemonEvent<TInput = unknown> {
  id: string;
  source: EmployeeDaemonEventSource;
  receivedAt: string;
  session?: EmployeeDaemonEventSession;
  request: ActionDispatchRequest<TInput>;
}
