import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SentinelConfig } from "../core/types.js";
import { readLockfile } from "../core/lockfile.js";
import { fetchLiveTools } from "../core/transport.js";
import ora from "ora";

interface QualityIssue { server: string; tool: string; level: "WARNING" | "INFO"; issue: string; }
interface QualityReport { totalTools: number; toolsWithIssues: number; issues: QualityIssue[]; completenessScore: number; typeCoverageScore: number; }

export async function audit(
  configPath: string, lockfilePath: string,
  targetServer: string, quiet: boolean
): Promise<void> {
  const config = JSON.parse(readFileSync(resolve(configPath), "utf-8")) as SentinelConfig;
  const lockfile = readLockfile(lockfilePath);
  const servers = targetServer
    ? Object.entries(config.servers).filter(([n]) => n === targetServer)
    : Object.entries(config.servers);

  const reports: Record<string, QualityReport> = {};

  for (const [name, serverConfig] of servers) {
    const spinner = quiet ? null : ora("Auditing " + name + "...").start();
    try {
      const live = await fetchLiveTools(name, serverConfig);
      const report = analyzeServer(name, live.tools);
      reports[name] = report;
      if (spinner) spinner.succeed(name + " (" + report.completenessScore + "/100)");
    } catch (err) { if (spinner) spinner.fail(name + ": " + (err instanceof Error ? err.message : String(err))); }
  }

  console.log("\nMCP Sentinel — Schema Quality Audit\n" + "=".repeat(55));
  for (const [server, report] of Object.entries(reports)) {
    console.log("\n" + server);
    console.log("  Completeness: " + bar(report.completenessScore) + " " + report.completenessScore + "%");
    console.log("  Type Coverage: " + bar(report.typeCoverageScore) + " " + report.typeCoverageScore + "%");
    console.log("  Tools: " + report.totalTools + " (" + report.toolsWithIssues + " with suggestions)");
    for (const issue of report.issues) {
      console.log("  [" + issue.level + "] " + issue.tool + ": " + issue.issue);
    }
  }
  console.log("");
}

function analyzeServer(serverName: string, tools: Record<string, any>): QualityReport {
  const issues: QualityIssue[] = [];
  let totalTools = 0, toolsWithIssues = 0, cp = 0, cm = 0, tp = 0, tm = 0;
  for (const [toolName, tool] of Object.entries(tools)) {
    totalTools++; let hasIssue = false; cm += 3; tm += 2;
    if (!tool.description || tool.description.length < 10) { issues.push({ server: serverName, tool: toolName, level: "WARNING", issue: "Missing or short description" }); hasIssue = true; } else cp++;
    const props = tool.inputSchema?.properties as Record<string, any> | undefined;
    if (!props || Object.keys(props).length === 0) cp++;
    let pd = 0, pt = 0, total = 0;
    if (props) {
      for (const [_, p] of Object.entries(props)) { total++; if (p?.description) pd++; if (p?.type && p.type !== "any") pt++; }
    }
    if (total > 0 && pd < total) { issues.push({ server: serverName, tool: toolName, level: "INFO", issue: pd + "/" + total + " params have descriptions" }); hasIssue = true; } else cp++;
    if (total > 0 && pt < total) { issues.push({ server: serverName, tool: toolName, level: "WARNING", issue: pt + "/" + total + " params have typed schemas" }); hasIssue = true; } else tp++;
    const required = tool.inputSchema?.required as string[] | undefined;
    if (props && (!required || required.length === 0)) { issues.push({ server: serverName, tool: toolName, level: "WARNING", issue: "No required fields specified" }); hasIssue = true; } else { cp++; tp++; }
    if (hasIssue) toolsWithIssues++;
  }
  return { totalTools, toolsWithIssues, issues, completenessScore: cm > 0 ? Math.round((cp / cm) * 100) : 100, typeCoverageScore: tm > 0 ? Math.round((tp / tm) * 100) : 100 };
}

function bar(score: number): string {
  if (score >= 90) return "[##########]"; if (score >= 70) return "[#######   ]"; if (score >= 50) return "[#####     ]"; return "[##        ]";
}
