import { createHash } from "node:crypto";
import type http from "node:http";
import type { Duplex } from "node:stream";

import {
  createCommandAck,
  type RuntimeEvent,
  type RuntimeCommand,
} from "../contracts/runtime-realtime-contract.js";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface RuntimeWebSocketChannelOptions {
  path?: string;
  handleCommand?: (command: RuntimeCommand) => Promise<RuntimeEvent[] | void>;
}

export interface RuntimeWebSocketChannel {
  publishEvent(event: RuntimeEvent): void;
}

export class RuntimeCommandRejectedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimeCommandRejectedError";
    this.code = code;
  }
}

export function attachRuntimeWebSocketChannel(
  server: http.Server,
  options: RuntimeWebSocketChannelOptions = {},
): RuntimeWebSocketChannel {
  const routePath = options.path || "/api/runtime/ws";
  const clients = new Set<Duplex>();

  server.once("close", () => {
    for (const client of [...clients]) {
      client.destroy();
    }
    clients.clear();
  });

  server.on("upgrade", (req, socket) => {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname !== routePath) {
      return;
    }

    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !key.trim()) {
      socket.destroy();
      return;
    }

    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${buildAcceptKey(key)}`,
      "",
      "",
    ].join("\r\n"));
    clients.add(socket);
    const removeClient = () => clients.delete(socket);
    socket.on("close", removeClient);
    socket.on("end", removeClient);
    socket.on("error", removeClient);

    socket.on("data", (chunk) => {
      if (isCloseFrame(chunk)) {
        socket.end();
        return;
      }
      const message = decodeTextFrame(chunk);
      if (!message) {
        return;
      }

      let command: RuntimeCommand | undefined;
      try {
        const parsed = JSON.parse(message);
        if (isRuntimeCommand(parsed)) {
          command = parsed;
        }
      } catch {
        command = undefined;
      }

      if (!command) {
        socket.write(encodeTextFrame(JSON.stringify(createCommandAck({
          commandId: "unknown",
          status: "rejected",
          acceptedAt: new Date().toISOString(),
          error: {
            code: "invalid_runtime_command",
            message: "Runtime WebSocket message must be a runtime command.",
          },
        }))));
        return;
      }

      void handleRuntimeCommand(socket, command, options.handleCommand, clients);
    });
  });

  return {
    publishEvent(event) {
      broadcastWebSocketMessage(clients, event);
    },
  };
}

async function handleRuntimeCommand(
  socket: Duplex,
  command: RuntimeCommand,
  handler: RuntimeWebSocketChannelOptions["handleCommand"],
  clients: Set<Duplex>,
): Promise<void> {
  try {
    const events = handler ? await handler(command) : undefined;
    writeWebSocketMessage(socket, createCommandAck({
      commandId: command.commandId,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    }));
    for (const event of events || []) {
      broadcastWebSocketMessage(clients, event);
    }
  } catch (error) {
    const rejected = error instanceof RuntimeCommandRejectedError;
    writeWebSocketMessage(socket, createCommandAck({
      commandId: command.commandId,
      status: rejected ? "rejected" : "failed",
      acceptedAt: new Date().toISOString(),
      error: {
        code: rejected ? error.code : "runtime_command_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    }));
  }
}

function broadcastWebSocketMessage(clients: Set<Duplex>, message: unknown): void {
  for (const client of [...clients]) {
    writeWebSocketMessage(client, message, () => clients.delete(client));
  }
}

function writeWebSocketMessage(socket: Duplex, message: unknown, onError?: () => void): void {
  try {
    socket.write(encodeTextFrame(JSON.stringify(message)));
  } catch {
    onError?.();
  }
}

function buildAcceptKey(key: string): string {
  return createHash("sha1")
    .update(`${key}${WEBSOCKET_GUID}`)
    .digest("base64");
}

function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RuntimeCommand>;
  return (
    candidate.schema === "runtime-command" &&
    candidate.version === 1 &&
    typeof candidate.commandId === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.issuedAt === "string" &&
    Boolean(candidate.payload) &&
    typeof candidate.payload === "object"
  );
}

function isCloseFrame(buffer: Buffer): boolean {
  return buffer.length >= 1 && (buffer[0] & 0x0f) === 0x8;
}

function decodeTextFrame(buffer: Buffer): string | undefined {
  if (buffer.length < 2) {
    return undefined;
  }

  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) {
    return undefined;
  }
  if (opcode !== 0x1) {
    return undefined;
  }

  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) {
      return undefined;
    }
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return undefined;
    }
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    if (high !== 0) {
      return undefined;
    }
    length = low;
    offset += 8;
  }

  let mask: Buffer | undefined;
  if (masked) {
    if (buffer.length < offset + 4) {
      return undefined;
    }
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + length) {
    return undefined;
  }

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return payload.toString("utf8");
}

function encodeTextFrame(message: string): Buffer {
  const payload = Buffer.from(message, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([
      Buffer.from([0x81, payload.length]),
      payload,
    ]);
  }
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeUInt32BE(0, 2);
  header.writeUInt32BE(payload.length, 6);
  return Buffer.concat([header, payload]);
}
