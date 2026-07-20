import { McpRuntimeGateway } from "./mcp-runtime-gateway.js";
import { PostgresMcpRepository } from "./postgres-mcp-repository.js";
import type { McpAssignmentScope, McpTransportKind } from "./domain.js";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function identifier(value: unknown, name: string): string {
  const result = requiredString(value, name);
  if (!ID_PATTERN.test(result)) throw new Error(`${name} must use lowercase hyphen-case.`);
  return result;
}

function stringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function referenceMap(value: unknown, name: string): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([target, hostVariable]) => {
    if (!target.trim() || typeof hostVariable !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(hostVariable)) {
      throw new Error(`${name} must map non-empty target names to host environment variable names.`);
    }
    return [target.trim(), hostVariable];
  }));
}

function bool(value: unknown, defaultValue = true): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") throw new Error("enabled must be a boolean.");
  return value;
}

function assertNoInlineSecrets(input: { args: string[]; url?: string }): void {
  const sensitiveFlag = /^--?(?:access[-_]?token|token|secret|password|api[-_]?key|authorization|cookie)(?:=|$)/i;
  if (input.args.some((arg) => sensitiveFlag.test(arg))) {
    throw new Error("MCP server arguments cannot contain credential flags or values; inject credentials through Connection environment references.");
  }
  if (input.url) {
    const parsed = new URL(input.url);
    if (parsed.username || parsed.password || [...parsed.searchParams.keys()].some((key) => /token|secret|password|key|auth/i.test(key))) {
      throw new Error("MCP server URLs cannot contain credentials; inject authentication through Connection header references.");
    }
  }
}

export class McpAdminService {
  constructor(private readonly repoRoot: string, private readonly environment: NodeJS.ProcessEnv = process.env) {}

  async loadState(companyId: string): Promise<unknown> {
    const repository = await PostgresMcpRepository.open(this.repoRoot);
    try {
      const servers = await repository.listServers();
      const connections = await repository.listConnections();
      const assignments = await repository.listAssignments(companyId);
      return {
        schema: "tinyoffice-mcp-admin", version: 1, companyId, servers,
        connections: connections.map((connection) => ({
          ...connection,
          resolvedEnvironment: Object.fromEntries(
            [...Object.values(connection.envRefs), ...Object.values(connection.headerRefs)]
              .map((name) => [name, this.environment[name] !== undefined]),
          ),
        })),
        assignments,
      };
    } finally { repository.close(); }
  }

  async saveServer(body: Record<string, unknown>): Promise<void> {
    const transport = requiredString(body.transport, "transport") as McpTransportKind;
    if (transport !== "stdio" && transport !== "streamable_http") throw new Error("transport must be stdio or streamable_http.");
    const command = typeof body.command === "string" && body.command.trim() ? body.command.trim() : undefined;
    const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : undefined;
    if (transport === "stdio" && (!command || url)) throw new Error("stdio MCP servers require command and cannot define url.");
    if (transport === "streamable_http" && (!url || command)) throw new Error("streamable_http MCP servers require url and cannot define command.");
    if (url && !/^https?:\/\//.test(url)) throw new Error("MCP server url must use http or https.");
    const args = stringArray(body.args, "args");
    assertNoInlineSecrets({ args, ...(url ? { url } : {}) });
    const repository = await PostgresMcpRepository.open(this.repoRoot);
    try {
      await repository.saveServer({
        serverId: identifier(body.serverId, "serverId"), displayName: requiredString(body.displayName, "displayName"),
        transport, ...(command ? { command } : {}), args, ...(url ? { url } : {}),
        enabled: bool(body.enabled),
      });
    } finally { repository.close(); }
  }

  async saveConnection(body: Record<string, unknown>): Promise<void> {
    const repository = await PostgresMcpRepository.open(this.repoRoot);
    try {
      await repository.saveConnection({
        connectionId: identifier(body.connectionId, "connectionId"),
        serverId: identifier(body.serverId, "serverId"), displayName: requiredString(body.displayName, "displayName"),
        envRefs: referenceMap(body.envRefs, "envRefs"), headerRefs: referenceMap(body.headerRefs, "headerRefs"),
        enabled: bool(body.enabled),
      });
    } finally { repository.close(); }
  }

  async saveAssignment(companyId: string, body: Record<string, unknown>): Promise<string> {
    const scopeKind = requiredString(body.scopeKind, "scopeKind") as McpAssignmentScope;
    if (scopeKind !== "company" && scopeKind !== "employee") throw new Error("scopeKind must be company or employee.");
    const memberId = typeof body.memberId === "string" && body.memberId.trim() ? body.memberId.trim() : undefined;
    if (scopeKind === "employee" && !memberId) throw new Error("employee MCP assignments require memberId.");
    if (scopeKind === "company" && memberId) throw new Error("company MCP assignments cannot define memberId.");
    const repository = await PostgresMcpRepository.open(this.repoRoot);
    try {
      return await repository.saveAssignment({
        companyId,
        ...(body.assignmentId ? { assignmentId: requiredString(body.assignmentId, "assignmentId") } : {}),
        connectionId: identifier(body.connectionId, "connectionId"), scopeKind, ...(memberId ? { memberId } : {}),
        enabled: bool(body.enabled),
      });
    } finally { repository.close(); }
  }

  async deleteAssignment(companyId: string, assignmentId: string): Promise<void> {
    const repository = await PostgresMcpRepository.open(this.repoRoot);
    try { await repository.deleteAssignment(companyId, requiredString(assignmentId, "assignmentId")); }
    finally { repository.close(); }
  }

  async checkConnection(companyId: string, memberId: string): Promise<unknown> {
    const discovery = await new McpRuntimeGateway(this.repoRoot, { environment: this.environment }).discoverAssignedTools({ companyId, memberId });
    return { schema: "tinyoffice-mcp-connection-check", version: 1, companyId, memberId, ...discovery };
  }
}
