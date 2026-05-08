import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import * as readline from "node:readline";
import type { SentinelConfig, ServerConfig } from "../core/types.js";

interface DiscoveredServer {
  name: string;
  source: string;
  config: ServerConfig;
}

const DEFAULT_CONFIG: SentinelConfig = {
  compatibility: "BACKWARD",
  failOn: "MAJOR",
  servers: {},
  rules: {
    DESCRIPTION_SEMANTICS_CHANGED: "PATCH",
  },
};

export async function discover(
  configPath: string,
  write: boolean,
  json: boolean
): Promise<void> {
  const servers = discoverServers(process.cwd());

  if (json) {
    console.log(JSON.stringify(servers, null, 2));
    return;
  }

  if (servers.length === 0) {
    console.log("No MCP server configs found.");
    console.log("Tip: run sentinel init to create a starter filesystem config.");
    return;
  }

  console.log("");
  console.log("MCP Sentinel — discovered MCP server candidates");
  console.log("");
  servers.forEach((server, idx) => {
    const command = server.config.command
      ? [server.config.command, ...(server.config.args ?? [])].join(" ")
      : server.config.url ?? "(unknown)";
    console.log(
      `${idx + 1}. ${server.name}  ${server.config.transport ?? "stdio"}`
    );
    console.log("   " + command);
    console.log("   from " + server.source);
  });
  console.log("");

  if (!write) {
    console.log("Run sentinel discover --write to choose servers and update sentinel.config.json.");
    return;
  }

  const chosen = await chooseServers(servers);
  if (chosen.length === 0) {
    console.log("No servers selected.");
    return;
  }

  const existing = readConfig(configPath);
  for (const server of chosen) {
    existing.servers[uniqueServerName(server.name, existing.servers)] = server.config;
  }
  writeFileSync(resolve(configPath), JSON.stringify(existing, null, 2) + "\n", "utf-8");
  console.log("Updated " + configPath + " with " + chosen.length + " server(s).");
}

function discoverServers(cwd: string): DiscoveredServer[] {
  const found: DiscoveredServer[] = [];
  const seen = new Set<string>();

  for (const file of discoverConfigFiles(cwd)) {
    for (const server of readServersFromFile(file)) {
      const key = server.name + "\0" + JSON.stringify(server.config);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(server);
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function discoverConfigFiles(cwd: string): string[] {
  const files = new Set<string>();
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";

  const known = [
    join(cwd, "sentinel.config.json"),
    join(cwd, "package.json"),
    join(cwd, "mcp.json"),
    join(cwd, ".mcp.json"),
    join(cwd, ".cursor", "mcp.json"),
    home && join(home, ".cursor", "mcp.json"),
    home && join(home, ".config", "claude", "claude_desktop_config.json"),
    home && join(home, ".config", "Cursor", "mcp.json"),
    appData && join(appData, "Claude", "claude_desktop_config.json"),
    appData && join(appData, "Cursor", "User", "mcp.json"),
    appData && join(appData, "Code", "User", "mcp.json"),
    appData && join(appData, "Windsurf", "User", "mcp.json"),
    localAppData && join(localAppData, "Claude", "claude_desktop_config.json"),
  ].filter(Boolean);

  for (const file of known) {
    if (existsSync(file)) files.add(resolve(file));
  }

  scanForMcpJson(cwd, 4, files);
  return [...files];
}

function scanForMcpJson(dir: string, depth: number, files: Set<string>): void {
  if (depth < 0) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if ([".git", "node_modules", "dist", "build", ".next"].includes(entry)) continue;
    const path = join(dir, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      scanForMcpJson(path, depth - 1, files);
      continue;
    }
    if (!stat.isFile()) continue;
    const lower = entry.toLowerCase();
    if (
      lower === "package.json" ||
      lower === "mcp.json" ||
      lower === ".mcp.json" ||
      lower === "claude_desktop_config.json" ||
      (lower.includes("mcp") && lower.endsWith(".json"))
    ) {
      files.add(resolve(path));
    }
  }
}

function readServersFromFile(file: string): DiscoveredServer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
  } catch {
    return [];
  }

  const found: DiscoveredServer[] = [];
  collectServers(parsed, file, found);
  return found;
}

function collectServers(value: unknown, source: string, found: DiscoveredServer[]): void {
  if (!isRecord(value)) return;

  for (const key of ["mcpServers", "servers"]) {
    const servers = value[key];
    if (!isRecord(servers)) continue;
    for (const [name, rawConfig] of Object.entries(servers)) {
      const config = normalizeServerConfig(rawConfig);
      if (!config) continue;
      found.push({ name, source, config });
    }
  }

  const packageScripts = value["scripts"];
  if (basename(source) === "package.json" && isRecord(packageScripts)) {
    for (const [name, script] of Object.entries(packageScripts)) {
      if (typeof script !== "string" || !name.toLowerCase().includes("mcp")) continue;
      found.push({
        name,
        source,
        config: { command: "npm", args: ["run", name] },
      });
    }
  }
}

function normalizeServerConfig(raw: unknown): ServerConfig | null {
  if (!isRecord(raw)) return null;

  const transport = raw["transport"];
  const url = raw["url"];
  const command = raw["command"];
  const args = raw["args"];
  const env = raw["env"];

  if (typeof url === "string") {
    return {
      transport: transport === "sse" ? "sse" : "http",
      url,
      env: isStringRecord(env) ? env : undefined,
    };
  }

  if (typeof command !== "string") return null;
  return {
    transport: "stdio",
    command,
    args: Array.isArray(args) ? args.filter((arg): arg is string => typeof arg === "string") : [],
    env: isStringRecord(env) ? env : undefined,
  };
}

async function chooseServers(servers: DiscoveredServer[]): Promise<DiscoveredServer[]> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolveAnswer) => {
    rl.question("Select servers to import (numbers, comma-separated, or all): ", resolveAnswer);
  });
  rl.close();

  const trimmed = answer.trim().toLowerCase();
  if (!trimmed) return [];
  if (trimmed === "all") return servers;

  const indexes = trimmed
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((idx) => Number.isInteger(idx) && idx >= 1 && idx <= servers.length);

  return [...new Set(indexes)].map((idx) => servers[idx - 1]!);
}

function readConfig(configPath: string): SentinelConfig {
  try {
    const parsed = JSON.parse(readFileSync(resolve(configPath), "utf-8")) as SentinelConfig;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      servers: parsed.servers ?? {},
      rules: parsed.rules ?? DEFAULT_CONFIG.rules,
    };
  } catch {
    return { ...DEFAULT_CONFIG, servers: {} };
  }
}

function uniqueServerName(name: string, servers: Record<string, ServerConfig>): string {
  if (!servers[name]) return name;
  let idx = 2;
  while (servers[`${name}-${idx}`]) idx++;
  return `${name}-${idx}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}
