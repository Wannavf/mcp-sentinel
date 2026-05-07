import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SentinelLockfile, DiffResult, Severity } from "../core/types.js";
import { diffServer } from "../diff/engine.js";
import { reportConsole } from "../reporters/console.js";
import { reportMarkdown } from "../reporters/markdown.js";
import { reportJson } from "../reporters/json.js";
import { reportSarif } from "../reporters/sarif.js";

export function lockfileDiff(
  oldPath: string,
  newPath: string,
  format: string
): string {
  const oldLock = JSON.parse(readFileSync(resolve(oldPath), "utf-8")) as SentinelLockfile;
  const newLock = JSON.parse(readFileSync(resolve(newPath), "utf-8")) as SentinelLockfile;

  const results: DiffResult[] = [];
  const allServers = new Set([...Object.keys(oldLock.servers), ...Object.keys(newLock.servers)]);

  for (const serverName of allServers) {
    const oldServer = oldLock.servers[serverName];
    const newServer = newLock.servers[serverName];

    if (!oldServer && newServer) {
      results.push({
        server: serverName, status: "DRIFT", severity: "MAJOR",
        changes: [{ ruleId: "TOOL_ADDED", severity: "MAJOR", tool: "(all)", field: "",
          summary: "Server " + serverName + " added", detail: "Not present in old lockfile",
          before: null, after: null }],
        addedTools: Object.keys(newServer.tools),
        removedTools: [],
        unchangedTools: 0,
      });
      continue;
    }

    if (oldServer && !newServer) {
      results.push({
        server: serverName, status: "DRIFT", severity: "MAJOR",
        changes: [{ ruleId: "TOOL_REMOVED", severity: "MAJOR", tool: "(all)", field: "",
          summary: "Server " + serverName + " removed", detail: "Not present in new lockfile",
          before: null, after: null }],
        addedTools: [],
        removedTools: Object.keys(oldServer.tools),
        unchangedTools: 0,
      });
      continue;
    }

    const liveData = {
      name: serverName,
      tools: Object.fromEntries(
        Object.entries(newServer!.tools).map(([name, tool]) => [
          name, {
            name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            annotations: tool.annotations,
          },
        ])
      ),
      protocolVersion: newServer!.protocolVersion,
    };

    results.push(diffServer(oldServer!, liveData));
  }

  switch (format) {
    case "json": return reportJson(results);
    case "markdown": return reportMarkdown(results);
    case "sarif": return reportSarif(results);
    default: return reportConsole(results);
  }
}
