export interface SentinelLockfile {
  formatVersion: number;
  generatedAt: string;
  generatedBy: string;
  contentHash: string;
  servers: Record<string, LockedServer>;
}

export interface LockedServer {
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
  };
  schemaHash: string;
  snapshotAt: string;
  tools: Record<string, LockedTool>;
}

export interface LockedTool {
  hash: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | null;
  annotations?: Record<string, unknown>;
}

export interface SentinelConfig {
  compatibility: CompatibilityMode;
  failOn: Severity;
  servers: Record<string, ServerConfig>;
  rules?: Record<string, Severity>;
}

export interface ServerConfig {
  transport?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export type CompatibilityMode = "STRICT" | "BACKWARD" | "FORWARD" | "FULL" | "NONE";
export type Severity = "MAJOR" | "MINOR" | "PATCH";

export interface DiffResult {
  server: string;
  status: "CLEAN" | "DRIFT";
  severity: Severity;
  changes: SchemaChange[];
  addedTools: string[];
  removedTools: string[];
  unchangedTools: number;
}

export interface SchemaChange {
  ruleId: string;
  severity: Severity;
  tool: string;
  field: string;
  summary: string;
  detail: string;
  before: unknown;
  after: unknown;
}

export interface SnapshotOptions {
  config: string;
  output: string;
  quiet: boolean;
}

export interface CheckOptions {
  config: string;
  lockfile: string;
  failOn: Severity;
  compatibility: CompatibilityMode;
  quiet: boolean;
}

export interface DiffOptions {
  config: string;
  lockfile: string;
  format: "console" | "json" | "markdown" | "sarif";
  failOn: Severity;
  compatibility: CompatibilityMode;
}
