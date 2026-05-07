import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SentinelConfig, Severity } from "../core/types.js";
import { readLockfile } from "../core/lockfile.js";
import { fetchLiveTools } from "../core/transport.js";
import { diffAll } from "../diff/engine.js";
import { reportConsole } from "../reporters/console.js";
import ora from "ora";
import type { LiveServerData } from "../core/transport.js";

export async function check(
  configPath: string, lockfilePath: string,
  failOn: Severity, targetServer: string, quiet: boolean
): Promise<boolean> {
  const config = JSON.parse(readFileSync(resolve(configPath), "utf-8")) as SentinelConfig;
  const lockfile = readLockfile(lockfilePath);

  const servers = targetServer
    ? Object.entries(config.servers).filter(([n]) => n === targetServer)
    : Object.entries(config.servers);

  const liveData: LiveServerData[] = [];
  for (const [name, serverConfig] of servers) {
    if (!lockfile.servers[name]) { if (!quiet) console.log("Server " + name + " not in lockfile"); continue; }
    const spinner = quiet ? null : ora("Checking " + name + "...").start();
    try { liveData.push(await fetchLiveTools(name, serverConfig)); if (spinner) spinner.succeed(name); }
    catch (err) { if (spinner) spinner.fail(name + ": " + (err instanceof Error ? err.message : String(err))); }
  }

  if (liveData.length === 0) { console.log("No servers to check."); return false; }

  const results = diffAll(lockfile, liveData, config.rules);
  if (!quiet) console.log(reportConsole(results));

  const order: Severity[] = ["MAJOR", "MINOR", "PATCH"];
  const worst = results.reduce<Severity>((w, r) => {
    const ri = order.indexOf(r.severity);
    return ri >= 0 && ri <= order.indexOf(w) ? r.severity : w;
  }, "PATCH");
  return order.indexOf(worst) > order.indexOf(failOn);
}
