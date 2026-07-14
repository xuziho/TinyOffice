import type http from "node:http";

import { Server as SocketIoServer, type Socket } from "socket.io";

import {
  assertTinyOfficeRealtimeEvent,
  createTinyOfficeRealtimeEvent,
  type TinyOfficeRealtimeEvent,
  type TinyOfficeRealtimeEventPayload,
  type TinyOfficeRealtimePublisher,
} from "../../collaboration/contracts/tinyoffice-realtime-contract.js";
import { registerTinyOfficeRealtimePublisher } from "../../collaboration/contracts/tinyoffice-realtime-publisher-registry.js";

export const TINYOFFICE_REALTIME_SOCKET_IO_PATH = "/api/realtime/socket.io";
export const TINYOFFICE_REALTIME_SOCKET_EVENT = "tinyoffice.realtime";

export interface TinyOfficeRealtimeGatewayOptions {
  path?: string;
}

export interface TinyOfficeRealtimeGateway extends TinyOfficeRealtimePublisher {
  publish(event: TinyOfficeRealtimeEventPayload): TinyOfficeRealtimeEvent;
}

type ClientIdentity = {
  companyId?: string;
  viewerMemberId?: string;
};

export function attachTinyOfficeRealtimeGateway(
  server: http.Server,
  options: TinyOfficeRealtimeGatewayOptions = {},
): TinyOfficeRealtimeGateway {
  const io = new SocketIoServer(server, {
    path: options.path || TINYOFFICE_REALTIME_SOCKET_IO_PATH,
    serveClient: false,
    transports: ["websocket"],
  });
  let sequence = 0;

  io.on("connection", (socket) => {
    socket.data.tinyofficeRealtime = identityFromSocket(socket);
  });

  const gateway: TinyOfficeRealtimeGateway = {
    publish(payload) {
      sequence += 1;
      const event = createTinyOfficeRealtimeEvent(payload, { sequence });
      broadcast(io, event);
      return event;
    },
  };
  const unregister = registerTinyOfficeRealtimePublisher(gateway);
  server.once("close", unregister);
  return gateway;
}

function broadcast(io: SocketIoServer, event: TinyOfficeRealtimeEvent): void {
  assertTinyOfficeRealtimeEvent(event);
  for (const socket of io.sockets.sockets.values()) {
    const identity = socket.data.tinyofficeRealtime as ClientIdentity | undefined;
    if (identity && shouldDeliver(identity, event)) {
      socket.emit(TINYOFFICE_REALTIME_SOCKET_EVENT, event);
    }
  }
}

function identityFromSocket(socket: Socket): ClientIdentity {
  return {
    companyId: stringFrom(socket.handshake.query.companyId),
    viewerMemberId: stringFrom(socket.handshake.query.viewerMemberId),
  };
}

function shouldDeliver(client: ClientIdentity, event: TinyOfficeRealtimeEvent): boolean {
  if (client.companyId && client.companyId !== event.companyId) {
    return false;
  }
  if (event.type === "chat.projection.changed" && client.viewerMemberId) {
    return client.viewerMemberId === event.viewerMemberId;
  }
  if (event.type === "chat.read_state.updated" && client.viewerMemberId) {
    return client.viewerMemberId === event.memberId;
  }
  return true;
}

function stringFrom(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return stringFrom(value[0]);
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
