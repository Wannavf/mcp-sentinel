import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline";

export async function init(dir: string): Promise<void> {
  const configPath = resolve(dir, "sentinel.config.json");
  const lockfilePath = resolve(dir, "sentinel-lock.json");

  if (existsSync(configPath)) {
    console.log("sentinel.config.json already exists. Run sentinel snapshot to update.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((r) => rl.question(q, r));

  console.log("");
  console.log("MCP Sentinel — interactive setup");
  console.log("Press Enter to accept defaults.\n");

  const servers: Record<string, { command: string; args: string[] }> = {};

  let add = true;
  while (add) {
    const name = await ask("Server name (or blank to finish): ");
    if (!name.trim()) { add = false; break; }

    const command = await ask("  Command (e.g., npx): ");
    const args = await ask("  Args, space-separated (e.g., -y @modelcontextprotocol/server-filesystem /data): ");

    servers[name.trim()] = {
      command: command.trim() || "npx",
      args: args.trim() ? args.trim().split(/\s+/) : [],
    };
    console.log("  Added " + name + "\n");
  }

  rl.close();

  if (Object.keys(servers).length === 0) {
    console.log("No servers configured. Create sentinel.config.json manually.");
    return;
  }

  const config = {
    compatibility: "BACKWARD",
    failOn: "MAJOR",
    servers,
    rules: {
      DESCRIPTION_SEMANTICS_CHANGED: "PATCH",
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  writeFileSync(lockfilePath, JSON.stringify({ formatVersion: 2, generatedAt: "", generatedBy: "", contentHash: "", servers: {} }, null, 2) + "\n", "utf-8");

  console.log("Written: " + configPath);
  console.log("Written: " + lockfilePath + " (empty — run sentinel snapshot to populate)");
  console.log("");
  console.log("Next: sentinel snapshot");
}
