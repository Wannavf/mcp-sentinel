import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SentinelConfig } from "../core/types.js";
import { readLockfile, writeLockfile } from "../core/lockfile.js";
import { snapshotServer } from "../core/transport.js";
import ora from "ora";

export async function update(
  configPath: string, lockfilePath: string,
  targetServer: string, quiet: boolean
): Promise<void> {
  const config = JSON.parse(readFileSync(resolve(configPath), "utf-8")) as SentinelConfig;
  const lockfile = readLockfile(lockfilePath);
  const servers = targetServer
    ? Object.entries(config.servers).filter(([n]) => n === targetServer)
    : Object.entries(config.servers);

  let count = 0;
  for (const [name, serverConfig] of servers) {
    const spinner = quiet ? null : ora("Updating " + name + "...").start();
    try {
      const result = await snapshotServer(name, serverConfig);
      const existing = lockfile.servers[name];
      lockfile.servers[name] = {
        transport: result.snapshot.transport,
        protocolVersion: result.snapshot.protocolVersion,
        serverInfo: result.snapshot.serverInfo,
        schemaHash: "",
        snapshotAt: new Date().toISOString(),
        tools: result.snapshot.tools,
        command: existing?.command, args: existing?.args, url: existing?.url,
      };
      count++; if (spinner) spinner.succeed(name);
    } catch (err) { if (spinner) spinner.fail(name + ": " + (err instanceof Error ? err.message : String(err))); }
  }
  if (count === 0) throw new Error("No servers could be updated");
  writeLockfile(lockfilePath, lockfile);
  if (!quiet) console.log("Updated " + count + " server(s)");
}
