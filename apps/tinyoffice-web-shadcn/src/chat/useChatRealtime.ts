import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { chatQueryKeys } from "./chatQueryKeys";
import type { TinyOfficeRealtimeEvent } from "tinyoffice/realtime-contracts";

const TINYOFFICE_REALTIME_SOCKET_IO_PATH = "/api/realtime/socket.io";
const TINYOFFICE_REALTIME_SOCKET_EVENT = "tinyoffice.realtime";

export type ChatRealtimeInvalidationTarget =
  | "roomMessages"
  | "projection"
  | "directory"
  | "accessRequests"
  | "employeeRuntimeSummary"
  | "tasks"
  | "sessions";

export function chatRealtimeInvalidationsForEvent(event: TinyOfficeRealtimeEvent): ChatRealtimeInvalidationTarget[] {
  if (event.type === "chat.message.created") {
    return ["roomMessages", "projection"];
  }
  if (event.type === "chat.entry.created" || event.type === "chat.projection.changed") {
    return ["projection"];
  }
  if (event.type === "company.directory.changed") {
    return ["directory"];
  }
  if (event.type === "chat.read_state.updated") {
    return ["projection"];
  }
  if (event.type === "access.request.changed") {
    return ["accessRequests"];
  }
  if (event.type === "work_run.updated") {
    return ["employeeRuntimeSummary", "tasks", "sessions"];
  }
  if (event.type === "work_task.updated") {
    return ["employeeRuntimeSummary", "tasks"];
  }
  if (event.type === "session.updated" || event.type === "process_trace.appended") {
    return ["employeeRuntimeSummary", "sessions"];
  }
  return [];
}

export function useChatRealtime({
  companyId,
  memberId,
  onEvent,
}: {
  companyId?: string;
  memberId?: string;
  onEvent?(event: TinyOfficeRealtimeEvent): void;
}): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!companyId || !memberId || typeof window === "undefined") {
      return;
    }

    const query: Record<string, string> = { companyId, viewerMemberId: memberId };

    const socket = io(window.location.origin, {
      path: TINYOFFICE_REALTIME_SOCKET_IO_PATH,
      query,
      transports: ["websocket"],
    });
    socket.on(TINYOFFICE_REALTIME_SOCKET_EVENT, (event: TinyOfficeRealtimeEvent) => {
      if (!event || event.companyId !== companyId) {
        return;
      }
      onEvent?.(event);
      const invalidations = chatRealtimeInvalidationsForEvent(event);
      if (invalidations.includes("roomMessages") && "roomId" in event) {
        void invalidateRoomMessages(queryClient, companyId, event.roomId);
      }
      if (invalidations.includes("projection")) {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.projectionScope(companyId) });
      }
      if (invalidations.includes("directory")) {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.directory(companyId) });
      }
      if (invalidations.includes("accessRequests")) {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.accessRequests(companyId) });
      }
      if (invalidations.includes("employeeRuntimeSummary")) {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.employeeRuntimeSummary(companyId) });
      }
      if (invalidations.includes("tasks")) {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.tasksScope(companyId) });
      }
      if (invalidations.includes("sessions")) {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessionsScope(companyId) });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [companyId, memberId, onEvent, queryClient]);
}

function invalidateRoomMessages(
  queryClient: ReturnType<typeof useQueryClient>,
  companyId: string,
  roomId: string,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: chatQueryKeys.roomMessagesScope(companyId, roomId) });
}
