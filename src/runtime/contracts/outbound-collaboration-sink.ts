import type { ActionResult } from "../../collaboration/contracts/action-result.js";
import type {
  EmployeeDaemonEvent,
  EmployeeDaemonSceneType,
} from "./daemon-event.js";
import type { RehydratedRuntimeState } from "./rehydrated-runtime-state.js";

export interface OutboundCollaborationEmission<TPayload = unknown> {
  employeeId: string;
  eventId: string;
  source: EmployeeDaemonEvent["source"];
  emittedAt: string;
  actionName: string;
  threadId: string;
  channelId?: string;
  sceneType?: EmployeeDaemonSceneType;
  sessionKey?: string;
  result: ActionResult<TPayload>;
  rehydrated: RehydratedRuntimeState;
}

export interface OutboundCollaborationSink {
  emit<TPayload>(
    emission: OutboundCollaborationEmission<TPayload>,
  ): Promise<void> | void;
}
