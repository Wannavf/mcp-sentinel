import chalk from "chalk";
import type { DiffResult, SchemaChange } from "../core/types.js";

export function reportConsole(results: DiffResult[]): string {
  const lines: string[] = [];

  if (results.length === 0) {
    lines.push(chalk.green("No servers compared."));
    return lines.join("\n");
  }

  const clean = results.filter((r) => r.status === "CLEAN");
  const drifted = results.filter((r) => r.status === "DRIFT");

  lines.push("");
  lines.push(chalk.bold("MCP Sentinel - Schema Drift Report"));
  lines.push("=".repeat(50));

  if (clean.length > 0) {
    lines.push(chalk.green("Servers with no drift: " + clean.map((r) => r.server).join(", ")));
  }

  for (const result of drifted) {
    const icon = result.severity === "MAJOR" ? chalk.red("MAJOR") : result.severity === "MINOR" ? chalk.yellow("MINOR") : chalk.blue("PATCH");
    lines.push("");
    lines.push(chalk.bold(result.server + " [" + icon + chalk.bold("]")));
    lines.push("-".repeat(40));

    for (const change of result.changes) {
      const prefix = change.severity === "MAJOR" ? chalk.red("[MAJOR]") : change.severity === "MINOR" ? chalk.yellow("[MINOR]") : chalk.blue("[PATCH]");
      lines.push("  " + prefix + " " + chalk.bold(change.ruleId) + ": " + change.summary);
    }

    if (result.addedTools.length > 0) {
      lines.push(chalk.dim("  New tools: " + result.addedTools.join(", ")));
    }
    if (result.removedTools.length > 0) {
      lines.push(chalk.red("  Removed tools: " + result.removedTools.join(", ")));
    }
  }

  const totalChanges = results.reduce((sum, r) => sum + r.changes.length, 0);
  const majors = results.reduce((sum, r) => sum + r.changes.filter((c) => c.severity === "MAJOR").length, 0);
  const minors = results.reduce((sum, r) => sum + r.changes.filter((c) => c.severity === "MINOR").length, 0);
  const patches = results.reduce((sum, r) => sum + r.changes.filter((c) => c.severity === "PATCH").length, 0);

  lines.push("");
  lines.push("=".repeat(50));
  lines.push(chalk.bold("Summary: " + totalChanges + " change(s) across " + results.length + " server(s)"));
  lines.push("  " + chalk.red(majors + " major") + "  " + chalk.yellow(minors + " minor") + "  " + chalk.blue(patches + " patch"));

  return lines.join("\n");
}
