import type { AccessRequestDecision, AccessRequestDto } from "tinyoffice/frontend-api-contracts";

export function accessRequestsForRoom(requests: AccessRequestDto[], roomId: string | undefined): AccessRequestDto[] {
  const normalizedRoomId = roomId?.trim();
  if (!normalizedRoomId) {
    return [];
  }
  return requests.filter((request) =>
    request.status === "pending" &&
    accessRequestForegroundRoomId(request) === normalizedRoomId
  );
}

export function accessRequestForegroundRoomId(request: AccessRequestDto): string | undefined {
  const foregroundRoomId = request.foregroundTarget?.roomId.trim();
  if (foregroundRoomId) {
    return foregroundRoomId;
  }
  if (request.contextKind === "dm_thread" || request.contextKind === "channel_topic") {
    return request.contextId.trim() || undefined;
  }
  return undefined;
}

export function accessDecisionContinuationMessage(input: {
  request: AccessRequestDto;
  decision: AccessRequestDecision;
  note?: string;
}): string {
  const resource = input.request.requestedResource?.trim();
  const action = input.request.requestedAction.trim();
  const target = resource ? `${action} ${resource}` : action;
  const note = input.note?.trim();

  if (input.decision === "reject") {
    return [
      `Access rejected for ${target}.`,
      note ? `Reason: ${note}` : "Do not retry this access unless the request changes.",
    ].join("\n");
  }

  const scope = input.decision === "allow_once"
    ? "once"
    : input.request.contextKind === "work_run"
      ? "for this WorkRun"
      : "in this conversation";
  return [
    `Access approved ${scope} for ${target}.`,
    note ? `Note: ${note}` : undefined,
    "Please retry the blocked action now through the original tool path.",
  ].filter((line): line is string => Boolean(line)).join("\n");
}
