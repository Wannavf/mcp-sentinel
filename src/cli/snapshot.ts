import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SentinelLockfile, SentinelConfig } from "../core/types.js";
import { snapshotServer } from "../core/transport.js";
import { writeLockfile } from "../core/lockfile.js";
import ora from "ora";

export async function snapshot(
  configPath: string, lockfilePath: string,
  targetServer: string, quiet: boolean
): Promise<void> {
  const config = JSON.parse(readFileSync(resolve(configPath), "utf-8")) as SentinelConfig;
  const servers = targetServer
    ? Object.fromEntries(Object.entries(config.servers).filter(([n]) => n === targetServer))
    : config.servers;

  if (Object.keys(servers).length === 0) {
    throw new Error("No servers found" + (targetServer ? " matching " + targetServer : ""));
  }

  const lockfile: SentinelLockfile = {
    formatVersion: 2, generatedAt: "", generatedBy: "", contentHash: "", servers: {},
  };

  for (const [name, serverConfig] of Object.entries(servers)) {
    const spinner = quiet ? null : ora("Snapshotting " + name + "...").start();
    try {
      const result = await snapshotServer(name, serverConfig);
      lockfile.servers[name] = {
        transport: result.snapshot.transport,
        protocolVersion: result.snapshot.protocolVersion,
        serverInfo: result.snapshot.serverInfo,
        schemaHash: "",
        snapshotAt: new Date().toISOString(),
        tools: result.snapshot.tools,
      };
      const count = Object.keys(result.snapshot.tools).length;
      if (spinner) spinner.succeed(name + " (" + count + " tools)");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (spinner) spinner.fail(name + " - " + msg);
      throw err;
    }
  }

  writeLockfile(lockfilePath, lockfile);
  if (!quiet) console.log("Lockfile written to " + lockfilePath + " with " + Object.keys(lockfile.servers).length + " server(s)");
}
