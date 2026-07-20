import { randomUUID } from "node:crypto";

import {
  openConfiguredPostgresConnection,
  releaseCompanyPostgresConnection,
  type CompanyPostgresClient,
  type CompanyPostgresPoolLike,
} from "../runtime/company-config/postgres-runtime-connection.js";
import type {
  McpAssignmentRecord,
  McpAuditStatus,
  McpConnectionRecord,
  McpResolvedConnection,
  McpServerRecord,
} from "./domain.js";

function jsonObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function serverFromRow(row: Record<string, unknown>): McpServerRecord {
  return {
    serverId: String(row.server_id),
    displayName: String(row.display_name),
    transport: row.transport as McpServerRecord["transport"],
    ...(row.command ? { command: String(row.command) } : {}),
    args: stringArray(row.args_json),
    ...(row.url ? { url: String(row.url) } : {}),
    enabled: Boolean(row.enabled),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function connectionFromRow(row: Record<string, unknown>): McpConnectionRecord {
  return {
    connectionId: String(row.connection_id),
    serverId: String(row.server_id),
    displayName: String(row.connection_display_name ?? row.display_name),
    envRefs: jsonObject(row.env_refs_json),
    headerRefs: jsonObject(row.header_refs_json),
    enabled: Boolean(row.connection_enabled ?? row.enabled),
    createdAt: new Date(String(row.connection_created_at ?? row.created_at)).toISOString(),
    updatedAt: new Date(String(row.connection_updated_at ?? row.updated_at)).toISOString(),
  };
}

export class PostgresMcpRepository {
  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
  ) {}

  static async open(repoRoot: string): Promise<PostgresMcpRepository> {
    const connection = await openConfiguredPostgresConnection(repoRoot);
    if (!connection) throw new Error("MCP requires the configured PostgreSQL runtime database.");
    return new PostgresMcpRepository(connection.client, connection.pool);
  }

  close(): void {
    releaseCompanyPostgresConnection({ client: this.client, pool: this.pool });
  }

  async listServers(): Promise<McpServerRecord[]> {
    const result = await this.client.query("SELECT * FROM mcp_servers ORDER BY display_name, server_id");
    return result.rows.map((row) => serverFromRow(row));
  }

  async listConnections(): Promise<McpConnectionRecord[]> {
    const result = await this.client.query("SELECT * FROM mcp_connections ORDER BY display_name, connection_id");
    return result.rows.map((row) => connectionFromRow(row));
  }

  async listAssignments(companyId: string): Promise<McpAssignmentRecord[]> {
    const result = await this.client.query(
      "SELECT * FROM mcp_assignments WHERE company_id = $1 ORDER BY created_at, assignment_id",
      [companyId],
    );
    return result.rows.map((row) => ({
      companyId: String(row.company_id), assignmentId: String(row.assignment_id),
      connectionId: String(row.connection_id), scopeKind: row.scope_kind as McpAssignmentRecord["scopeKind"],
      ...(row.member_id ? { memberId: String(row.member_id) } : {}), enabled: Boolean(row.enabled),
      createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async saveServer(input: {
    serverId: string; displayName: string; transport: McpServerRecord["transport"];
    command?: string; args: string[]; url?: string; enabled: boolean;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.client.query(
      `INSERT INTO mcp_servers (server_id, display_name, transport, command, args_json, url, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $8)
       ON CONFLICT (server_id) DO UPDATE SET display_name = EXCLUDED.display_name, transport = EXCLUDED.transport,
         command = EXCLUDED.command, args_json = EXCLUDED.args_json, url = EXCLUDED.url,
         enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      [input.serverId, input.displayName, input.transport, input.command ?? null, JSON.stringify(input.args),
        input.url ?? null, input.enabled, now],
    );
  }

  async saveConnection(input: {
    connectionId: string; serverId: string; displayName: string;
    envRefs: Record<string, string>; headerRefs: Record<string, string>; enabled: boolean;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.client.query(
      `INSERT INTO mcp_connections
       (connection_id, server_id, display_name, env_refs_json, header_refs_json, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $7)
       ON CONFLICT (connection_id) DO UPDATE SET server_id = EXCLUDED.server_id,
         display_name = EXCLUDED.display_name, env_refs_json = EXCLUDED.env_refs_json,
         header_refs_json = EXCLUDED.header_refs_json, enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      [input.connectionId, input.serverId, input.displayName, JSON.stringify(input.envRefs),
        JSON.stringify(input.headerRefs), input.enabled, now],
    );
  }

  async saveAssignment(input: {
    companyId: string; assignmentId?: string; connectionId: string;
    scopeKind: McpAssignmentRecord["scopeKind"]; memberId?: string; enabled: boolean;
  }): Promise<string> {
    const assignmentId = input.assignmentId ?? randomUUID();
    const now = new Date().toISOString();
    await this.client.query(
      `INSERT INTO mcp_assignments
       (company_id, assignment_id, connection_id, scope_kind, member_id, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (company_id, assignment_id) DO UPDATE SET connection_id = EXCLUDED.connection_id,
         scope_kind = EXCLUDED.scope_kind, member_id = EXCLUDED.member_id,
         enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      [input.companyId, assignmentId, input.connectionId, input.scopeKind, input.memberId ?? null, input.enabled, now],
    );
    return assignmentId;
  }

  async deleteAssignment(companyId: string, assignmentId: string): Promise<void> {
    const result = await this.client.query(
      "DELETE FROM mcp_assignments WHERE company_id = $1 AND assignment_id = $2 RETURNING assignment_id",
      [companyId, assignmentId],
    );
    if (result.rows.length === 0) throw new Error(`MCP assignment not found: ${assignmentId}`);
  }

  async listAssignedConnections(companyId: string, memberId: string): Promise<McpResolvedConnection[]> {
    const result = await this.client.query(
      `SELECT c.connection_id, c.server_id, c.display_name AS connection_display_name,
              c.env_refs_json, c.header_refs_json, c.enabled AS connection_enabled,
              c.created_at AS connection_created_at, c.updated_at AS connection_updated_at,
              s.server_id AS resolved_server_id, s.display_name AS server_display_name,
              s.transport, s.command, s.args_json, s.url, s.enabled AS server_enabled,
              s.created_at AS server_created_at, s.updated_at AS server_updated_at
         FROM mcp_assignments a
         JOIN mcp_connections c ON c.connection_id = a.connection_id
         JOIN mcp_servers s ON s.server_id = c.server_id
        WHERE a.company_id = $1 AND a.enabled = true AND c.enabled = true AND s.enabled = true
          AND (a.scope_kind = 'company' OR (a.scope_kind = 'employee' AND a.member_id = $2))
        ORDER BY c.display_name, c.connection_id`,
      [companyId, memberId],
    );
    const unique = new Map<string, McpResolvedConnection>();
    for (const row of result.rows) {
      const connection = connectionFromRow(row);
      unique.set(connection.connectionId, {
        ...connection,
        server: serverFromRow({
          server_id: row.resolved_server_id,
          display_name: row.server_display_name,
          transport: row.transport,
          command: row.command,
          args_json: row.args_json,
          url: row.url,
          enabled: row.server_enabled,
          created_at: row.server_created_at,
          updated_at: row.server_updated_at,
        }),
      });
    }
    return [...unique.values()];
  }

  async getAssignedConnection(companyId: string, memberId: string, connectionId: string): Promise<McpResolvedConnection> {
    const match = (await this.listAssignedConnections(companyId, memberId))
      .find((connection) => connection.connectionId === connectionId);
    if (!match) throw new Error(`MCP connection is not assigned to this employee: ${connectionId}`);
    return match;
  }

  async beginAudit(input: {
    companyId: string; connectionId: string; memberId: string; sessionKey?: string;
    toolName: string; sanitizedInput: unknown;
  }): Promise<{ eventId: string; startedAt: number }> {
    const eventId = randomUUID();
    const startedAt = Date.now();
    await this.client.query(
      `INSERT INTO mcp_tool_audit_events
       (company_id, event_id, connection_id, member_id, session_key, tool_name, status, input_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'started', $7::jsonb, $8)`,
      [input.companyId, eventId, input.connectionId, input.memberId, input.sessionKey ?? null,
        input.toolName, JSON.stringify(input.sanitizedInput), new Date(startedAt).toISOString()],
    );
    return { eventId, startedAt };
  }

  async completeAudit(input: {
    companyId: string; eventId: string; startedAt: number; status: Exclude<McpAuditStatus, "started">;
    sanitizedOutput?: unknown; error?: string;
  }): Promise<void> {
    const completedAt = Date.now();
    await this.client.query(
      `UPDATE mcp_tool_audit_events
          SET status = $3, output_json = $4::jsonb, duration_ms = $5, error = $6, completed_at = $7
        WHERE company_id = $1 AND event_id = $2`,
      [input.companyId, input.eventId, input.status,
        input.sanitizedOutput === undefined ? null : JSON.stringify(input.sanitizedOutput),
        completedAt - input.startedAt, input.error ?? null, new Date(completedAt).toISOString()],
    );
  }
}
