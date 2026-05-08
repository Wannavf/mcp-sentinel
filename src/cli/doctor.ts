import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import type { SentinelConfig, ServerConfig } from "../core/types.js";
import { readLockfile, validateLockfile } from "../core/lockfile.js";

interface DoctorIssue {
  level: "ok" | "warn" | "error";
  message: string;
}

export function validateConfig(config: SentinelConfig, lockfilePath: string): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const serverEntries = Object.entries(config.servers ?? {});

  if (serverEntries.length === 0) {
    issues.push({ level: "error", message: "No MCP servers are configured." });
  } else {
    issues.push({ level: "ok", message: `${serverEntries.length} MCP server(s) configured.` });
  }

  for (const [name, server] of serverEntries) {
    issues.push(...validateServer(name, server));
  }

  if (!existsSync(resolve(lockfilePath))) {
    issues.push({ level: "warn", message: `No lockfile found at ${lockfilePath}. Run sentinel snapshot.` });
    return issues;
  }

  try {
    const lockfile = readLockfile(lockfilePath);
    const lockIssues = validateLockfile(lockfile);
    if (lockIssues.length === 0) {
      issues.push({ level: "ok", message: `Lockfile ${lockfilePath} is valid.` });
    } else {
      for (const issue of lockIssues) {
        issues.push({ level: "warn", message: issue });
      }
    }
  } catch (err) {
    issues.push({ level: "error", message: `Could not read ${lockfilePath}: ${errorMessage(err)}` });
  }

  return issues;
}

export async function doctor(configPath: string, lockfilePath: string): Promise<boolean> {
  const resolvedConfig = resolve(configPath);
  console.log(chalk.bold("MCP Sentinel doctor"));
  console.log("");

  if (!existsSync(resolvedConfig)) {
    console.log(chalk.red("ERR ") + `No config found at ${configPath}.`);
    console.log("Run " + chalk.cyan("sentinel discover --write") + " or " + chalk.cyan("sentinel init") + ".");
    return false;
  }

  let config: SentinelConfig;
  try {
    config = JSON.parse(readFileSync(resolvedConfig, "utf-8").replace(/^\uFEFF/, "")) as SentinelConfig;
  } catch (err) {
    console.log(chalk.red("ERR ") + `Could not parse ${configPath}: ${errorMessage(err)}`);
    return false;
  }

  const issues = validateConfig(config, lockfilePath);
  for (const issue of issues) {
    console.log(label(issue.level) + issue.message);
  }

  const hasError = issues.some((issue) => issue.level === "error");
  const hasWarn = issues.some((issue) => issue.level === "warn");

  console.log("");
  if (hasError) {
    console.log(chalk.red("Not ready yet. Fix the errors above, then run sentinel doctor again."));
  } else if (hasWarn) {
    console.log(chalk.yellow("Usable, but there are warnings to clean up."));
  } else {
    console.log(chalk.green("All good. You can run sentinel snapshot, check, diff, or dashboard."));
  }

  return !hasError;
}

function validateServer(name: string, server: ServerConfig): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const transport = server.transport ?? "stdio";

  if (!["stdio", "http", "sse"].includes(transport)) {
    issues.push({ level: "error", message: `${name}: unsupported transport "${transport}".` });
    return issues;
  }

  if (transport === "stdio") {
    if (!server.command) {
      issues.push({ level: "error", message: `${name}: stdio server is missing command.` });
    } else {
      issues.push({ level: "ok", message: `${name}: stdio command looks configured.` });
    }
    return issues;
  }

  if (!server.url) {
    issues.push({ level: "error", message: `${name}: ${transport} server is missing url.` });
    return issues;
  }

  try {
    new URL(server.url);
    issues.push({ level: "ok", message: `${name}: ${transport} url looks valid.` });
  } catch {
    issues.push({ level: "error", message: `${name}: ${transport} url is not a valid URL.` });
  }

  return issues;
}

function label(level: DoctorIssue["level"]): string {
  if (level === "ok") return chalk.green("OK  ");
  if (level === "warn") return chalk.yellow("WARN ");
  return chalk.red("ERR ");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
