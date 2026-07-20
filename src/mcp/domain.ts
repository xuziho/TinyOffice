export type McpTransportKind = "stdio" | "streamable_http";
export type McpAssignmentScope = "company" | "employee";
export type McpAuditStatus = "started" | "succeeded" | "failed" | "canceled" | "timed_out";

export interface McpServerRecord {
  serverId: string;
  displayName: string;
  transport: McpTransportKind;
  command?: string;
  args: string[];
  url?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpConnectionRecord {
  connectionId: string;
  serverId: string;
  displayName: string;
  envRefs: Record<string, string>;
  headerRefs: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpResolvedConnection extends McpConnectionRecord {
  server: McpServerRecord;
}

export interface McpAssignmentRecord {
  companyId: string;
  assignmentId: string;
  connectionId: string;
  scopeKind: McpAssignmentScope;
  memberId?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpToolSummary {
  connectionId: string;
  connectionName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpToolDiscoveryReport {
  tools: McpToolSummary[];
  unavailableConnections: Array<{
    connectionId: string;
    connectionName: string;
    error: string;
  }>;
}
