import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SentinelConfig } from "../core/types.js";
import { readLockfile } from "../core/lockfile.js";
import { fetchLiveTools } from "../core/transport.js";
import { diffAll } from "../diff/engine.js";
import { reportConsole } from "../reporters/console.js";

export async function watch(
  configPath: string, lockfilePath: string,
  interval: number, targetServer: string
): Promise<void> {
  const config = JSON.parse(readFileSync(resolve(configPath), "utf-8")) as SentinelConfig;
  const lockfile = readLockfile(lockfilePath);
  const servers = targetServer
    ? Object.entries(config.servers).filter(([n]) => n === targetServer)
    : Object.entries(config.servers);

  console.log("MCP Sentinel watch daemon — " + servers.length + " server(s), every " + interval + "s\n");

  async function checkOnce(): Promise<void> {
    const liveData = [];
    for (const [name, serverConfig] of servers) {
      if (!lockfile.servers[name]) continue;
      try { liveData.push(await fetchLiveTools(name, serverConfig)); } catch { continue; }
    }
    if (liveData.length === 0) return;
    const results = diffAll(lockfile, liveData, config.rules);
    const drifted = results.filter((r) => r.status === "DRIFT");
    if (drifted.length > 0) {
      console.log("[" + new Date().toISOString().replace("T", " ").slice(0, 19) + "] DRIFT DETECTED");
      console.log(reportConsole(results));
    }
  }

  await checkOnce();
  setInterval(checkOnce, interval * 1000);
  process.on("SIGINT", () => { console.log("\nStopped."); process.exit(0); });
  await new Promise(() => {});
}
