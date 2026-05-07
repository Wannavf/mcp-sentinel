import type { LockedServer, SentinelLockfile, DiffResult, SchemaChange, Severity } from "../core/types.js";
import { diffTool } from "./rules.js";
import { hashTool } from "../core/hasher.js";

interface LiveTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface LiveServerData {
  name: string;
  tools: Record<string, LiveTool>;
  protocolVersion: string;
}

export function diffServer(
  locked: LockedServer,
  live: LiveServerData,
  ruleOverrides?: Record<string, Severity>
): DiffResult {
  const changes: SchemaChange[] = [];
  const addedTools: string[] = [];
  const removedTools: string[] = [];
  let unchangedCount = 0;

  const lockedTools = locked.tools ?? {};
  const liveTools = live.tools ?? {};

  for (const [name, tool] of Object.entries(lockedTools)) {
    if (!(name in liveTools)) {
      removedTools.push(name);
      changes.push({
        ruleId: "TOOL_REMOVED", severity: "MAJOR",
        tool: name, field: "",
        summary: "Tool removed: " + name,
        detail: "Tool " + name + " existed in lockfile but is no longer available",
        before: tool.inputSchema, after: null,
      });
    }
  }

  for (const [name, tool] of Object.entries(liveTools)) {
    if (!(name in lockedTools)) {
      addedTools.push(name);
      changes.push({
        ruleId: "TOOL_ADDED", severity: "PATCH",
        tool: name, field: "",
        summary: "New tool: " + name,
        detail: "Tool " + name + " is available on the server but not in the lockfile",
        before: null, after: tool.inputSchema,
      });
      continue;
    }

    const lockedTool = lockedTools[name]!;
    const liveHash = hashTool({
      hash: "",
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: null,
      annotations: {},
    });

    if (lockedTool.hash === liveHash) {
      unchangedCount++;
      continue;
    }

    const toolChanges = diffTool(
      name,
      lockedTool.inputSchema,
      tool.inputSchema,
      lockedTool.description,
      tool.description,
      ruleOverrides
    );
    changes.push(...toolChanges);
  }

  const maxSeverity = changes.reduce<Severity>(
    (max, c) => severityOrder(c.severity) > severityOrder(max) ? c.severity : max,
    "PATCH"
  );

  const status = changes.length === 0 ? "CLEAN" : "DRIFT";

  return { server: locked.serverInfo.name, status, severity: maxSeverity, changes, addedTools, removedTools, unchangedTools: unchangedCount };
}

export function diffAll(
  lockfile: SentinelLockfile,
  liveData: LiveServerData[],
  ruleOverrides?: Record<string, Severity>
): DiffResult[] {
  const results: DiffResult[] = [];
  for (const live of liveData) {
    const locked = lockfile.servers[live.name];
    if (!locked) {
      results.push({
        server: live.name, status: "DRIFT", severity: "MAJOR",
        changes: [{ ruleId: "TOOL_REMOVED", severity: "MAJOR", tool: "(all)", field: "", summary: "Server " + live.name + " not in lockfile", detail: "Server not found in lockfile — run sentinel snapshot first", before: null, after: null }],
        addedTools: [], removedTools: [],
        unchangedTools: 0,
      });
      continue;
    }
    results.push(diffServer(locked, live, ruleOverrides));
  }
  return results;
}

function severityOrder(s: Severity): number {
  if (s === "MAJOR") return 3;
  if (s === "MINOR") return 2;
  return 1;
}
