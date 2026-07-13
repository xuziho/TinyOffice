export interface CollaborationRuntimeActionSpec {
  actionName: never;
  summary: string;
}

export const collaborationActionSpecs: Record<CollaborationRuntimeActionSpec["actionName"], CollaborationRuntimeActionSpec> = {
};

export const BASE_COLLABORATION_ACTION_NAMES = Object.freeze(
  Object.keys(collaborationActionSpecs) as CollaborationRuntimeActionSpec["actionName"][],
);
