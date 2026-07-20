import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { McpResolvedConnection, McpToolDiscoveryReport, McpToolSummary } from "./domain.js";
import { PostgresMcpRepository } from "./postgres-mcp-repository.js";

const DEFAULT_MCP_TIMEOUT_MS = 30_000;
const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[-_]?key/i;

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function summarizeArgumentsForAudit(argumentsValue: Record<string, unknown>): unknown {
  const entries = Object.entries(argumentsValue).slice(0, 100);
  return {
    argumentKeys: entries.map(([key]) => key),
    argumentTypes: Object.fromEntries(entries.map(([key, value]) => [key, valueType(value)])),
    sensitiveArgumentKeys: entries.filter(([key]) => SENSITIVE_KEY.test(key)).map(([key]) => key),
  };
}

function summarizeResultForAudit(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return { resultType: valueType(result) };
  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  return {
    resultType: "object",
    topLevelKeys: Object.keys(record).slice(0, 100),
    contentCount: content.length,
    contentTypes: content.map((item) => item && typeof item === "object" && !Array.isArray(item)
      ? String((item as Record<string, unknown>).type ?? "object") : valueType(item)),
    isError: record.isError === true,
    hasStructuredContent: record.structuredContent !== undefined,
  };
}

function sanitizeErrorForAudit(error: unknown): string {
  return errorMessage(error)
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[Redacted]")
    .replace(/((?:token|secret|password|api[-_]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[Redacted]")
    .slice(0, 2_000);
}

function resolveReferences(refs: Record<string, string>, environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(refs).map(([targetName, hostVariable]) => {
    const value = environment[hostVariable];
    if (value === undefined) throw new Error(`MCP credential environment variable is not configured: ${hostVariable}`);
    return [targetName, value];
  }));
}

function createTransport(connection: McpResolvedConnection, environment: NodeJS.ProcessEnv): Transport {
  if (connection.server.transport === "stdio") {
    return new StdioClientTransport({
      command: connection.server.command as string,
      args: connection.server.args,
      env: { ...getDefaultEnvironment(), ...resolveReferences(connection.envRefs, environment) },
      stderr: "ignore",
    });
  }
  const headers = resolveReferences(connection.headerRefs, environment);
  return new StreamableHTTPClientTransport(new URL(connection.server.url as string), {
    requestInit: { headers },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function completionStatus(error: unknown, signal?: AbortSignal): "failed" | "canceled" | "timed_out" {
  if (signal?.aborted) return "canceled";
  return /timed?\s*out|requesttimeout/i.test(errorMessage(error)) ? "timed_out" : "failed";
}

interface McpGatewayRepository {
  close(): void;
  listAssignedConnections(companyId: string, memberId: string): Promise<McpResolvedConnection[]>;
  getAssignedConnection(companyId: string, memberId: string, connectionId: string): Promise<McpResolvedConnection>;
  beginAudit(input: { companyId: string; connectionId: string; memberId: string; sessionKey?: string; toolName: string; sanitizedInput: unknown }): Promise<{ eventId: string; startedAt: number }>;
  completeAudit(input: { companyId: string; eventId: string; startedAt: number; status: "succeeded" | "failed" | "canceled" | "timed_out"; sanitizedOutput?: unknown; error?: string }): Promise<void>;
}

type McpGatewayOptions = {
  environment?: NodeJS.ProcessEnv;
  openRepository?: () => Promise<McpGatewayRepository>;
  createTransport?: (connection: McpResolvedConnection, environment: NodeJS.ProcessEnv) => Transport;
};

async function withClient<T>(input: {
  connection: McpResolvedConnection;
  environment: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  run(client: Client): Promise<T>;
  createTransport: (connection: McpResolvedConnection, environment: NodeJS.ProcessEnv) => Transport;
}): Promise<T> {
  const client = new Client({ name: "tinyoffice", version: "0.1.0" });
  try {
    await client.connect(input.createTransport(input.connection, input.environment), {
      signal: input.signal,
      timeout: input.timeoutMs,
    });
    return await input.run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export class McpRuntimeGateway {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly openRepository: () => Promise<McpGatewayRepository>;
  private readonly transportFactory: (connection: McpResolvedConnection, environment: NodeJS.ProcessEnv) => Transport;

  constructor(private readonly repoRoot: string, options: McpGatewayOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.openRepository = options.openRepository ?? (() => PostgresMcpRepository.open(this.repoRoot));
    this.transportFactory = options.createTransport ?? createTransport;
  }

  async listAssignedTools(input: {
    companyId: string; memberId: string; signal?: AbortSignal; timeoutMs?: number;
  }): Promise<McpToolSummary[]> {
    return (await this.discoverAssignedTools(input)).tools;
  }

  async discoverAssignedTools(input: {
    companyId: string; memberId: string; signal?: AbortSignal; timeoutMs?: number;
  }): Promise<McpToolDiscoveryReport> {
    const repository = await this.openRepository();
    try {
      const connections = await repository.listAssignedConnections(input.companyId, input.memberId);
      const toolGroups = await Promise.all(connections.map(async (connection) => {
        try {
          const response = await withClient({
            connection, environment: this.environment, signal: input.signal,
            timeoutMs: input.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
            createTransport: this.transportFactory,
            run: (client) => client.listTools(undefined, {
              signal: input.signal, timeout: input.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
            }),
          });
          return {
            tools: response.tools.map((tool): McpToolSummary => ({
              connectionId: connection.connectionId,
              connectionName: connection.displayName,
              name: tool.name,
              ...(tool.description ? { description: tool.description } : {}),
              inputSchema: tool.inputSchema,
              ...(tool.annotations ? { annotations: tool.annotations as Record<string, unknown> } : {}),
            })),
          };
        } catch (error) {
          if (input.signal?.aborted) throw error;
          return {
            tools: [],
            unavailable: {
              connectionId: connection.connectionId,
              connectionName: connection.displayName,
              error: sanitizeErrorForAudit(error),
            },
          };
        }
      }));
      return {
        tools: toolGroups.flatMap((group) => group.tools),
        unavailableConnections: toolGroups.flatMap((group) => group.unavailable ? [group.unavailable] : []),
      };
    } finally {
      repository.close();
    }
  }

  async callAssignedTool(input: {
    companyId: string; memberId: string; connectionId: string; toolName: string;
    arguments?: Record<string, unknown>; sessionKey?: string; signal?: AbortSignal; timeoutMs?: number;
  }): Promise<unknown> {
    const repository = await this.openRepository();
    let audit: { eventId: string; startedAt: number } | undefined;
    try {
      const connection = await repository.getAssignedConnection(input.companyId, input.memberId, input.connectionId);
      audit = await repository.beginAudit({
        companyId: input.companyId, connectionId: input.connectionId, memberId: input.memberId,
        sessionKey: input.sessionKey, toolName: input.toolName,
        sanitizedInput: summarizeArgumentsForAudit(input.arguments ?? {}),
      });
      const result = await withClient({
        connection, environment: this.environment, signal: input.signal,
        timeoutMs: input.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
        createTransport: this.transportFactory,
        run: (client) => client.callTool(
          { name: input.toolName, arguments: input.arguments ?? {} },
          undefined,
          { signal: input.signal, timeout: input.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS },
        ),
      });
      await repository.completeAudit({
        companyId: input.companyId, eventId: audit.eventId, startedAt: audit.startedAt,
        status: "succeeded", sanitizedOutput: summarizeResultForAudit(result),
      });
      return result;
    } catch (error) {
      if (audit) {
        await repository.completeAudit({
          companyId: input.companyId, eventId: audit.eventId, startedAt: audit.startedAt,
          status: completionStatus(error, input.signal), error: sanitizeErrorForAudit(error),
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      repository.close();
    }
  }
}
