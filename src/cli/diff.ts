import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DiffResult, SentinelConfig, Severity } from "../core/types.js";
import { readLockfile } from "../core/lockfile.js";
import { fetchLiveTools } from "../core/transport.js";
import { diffAll } from "../diff/engine.js";
import { reportConsole } from "../reporters/console.js";
import { reportMarkdown } from "../reporters/markdown.js";
import { reportJson } from "../reporters/json.js";
import { reportSarif } from "../reporters/sarif.js";
import ora from "ora";

export type DiffFormat = "console" | "json" | "markdown" | "sarif";

export async function diff(
  configPath: string,
  lockfilePath: string,
  format: DiffFormat,
  failOn: Severity,
  server: string,
  quiet: boolean
): Promise<boolean> {
  const config = JSON.parse(readFileSync(resolve(configPath), "utf-8")) as SentinelConfig;
  const lockfile = readLockfile(lockfilePath);
  const liveData = [];

  const servers = server
    ? Object.entries(config.servers).filter(([n]) => n === server)
    : Object.entries(config.servers);

  if (servers.length === 0) {
    throw new Error("No matching servers found in config");
  }

  for (const [name, serverConfig] of servers) {
    if (!lockfile.servers[name]) continue;
    const spinner = quiet ? null : ora("Connecting to " + name + "...").start();
    try {
      liveData.push(await fetchLiveTools(name, serverConfig));
      if (spinner) spinner.succeed(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (spinner) spinner.fail(name + ": " + msg);
    }
  }

  const results = diffAll(lockfile, liveData, config.rules);

  switch (format) {
    case "json": console.log(reportJson(results)); break;
    case "markdown": console.log(reportMarkdown(results)); break;
    case "sarif": console.log(reportSarif(results)); break;
    default: console.log(reportConsole(results)); break;
  }

  return checkFail(results, failOn);
}

function checkFail(results: DiffResult[], failOn: Severity): boolean {
  const order: Severity[] = ["MAJOR", "MINOR", "PATCH"];
  const worst = results.reduce<Severity>((w, r) => {
    const ri = order.indexOf(r.severity);
    return ri >= 0 && ri <= order.indexOf(w) ? r.severity : w;
  }, "PATCH");
  return order.indexOf(worst) > order.indexOf(failOn);
}
