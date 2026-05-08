/**
 * MCP Sentinel — Dashboard TUI
 *
 * Keys:
 *   ↑/↓ or j/k  navigate servers
 *   s           snapshot selected server
 *   a           snapshot all servers
 *   c           check selected server (drift)
 *   C           check all servers
 *   d           diff selected server
 *   /           focus log filter (cycles info/warn/error/all)
 *   space       pause/resume log stream
 *   tab         cycle focus
 *   q / Ctrl-C  quit
 */

import blessed from "blessed";
import contrib from "blessed-contrib";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  SentinelLockfile,
  SentinelConfig,
  DiffResult,
  SchemaChange,
} from "../core/types.js";
import { readLockfile } from "../core/lockfile.js";
import { snapshotServer, fetchLiveTools } from "../core/transport.js";
import { diffAll } from "../diff/engine.js";

/* ---------- types ---------- */

type SeverityLvl = "info" | "warn" | "error" | "proof" | "ok";
type ServerStatus =
  | "clean"
  | "drift-minor"
  | "drift-major"
  | "loading"
  | "error"
  | "unknown";

interface ServerRow {
  name: string;
  tools: number;
  status: ServerStatus;
  drift: number;
  lastSnap: string;
  version: string;
  transport: string;
  rps: number;
  calls: number;
  spark: number[];
  lastChanges?: SchemaChange[];
}

interface AlertRow {
  id: string;
  level: "major" | "minor" | "warn" | "error";
  server: string;
  tool: string;
  rule: string;
  title: string;
  summary: string;
  detail: string;
  z3?: "BROKEN" | "SAFE" | "—";
  counterexample?: string;
  occurrences: number;
  ts: string;
}

/* ---------- severity helpers (chalk for log lines) ---------- */

const sevTag = (lvl: SeverityLvl): string => {
  switch (lvl) {
    case "info":  return chalk.cyan.bold("INFO ");
    case "ok":    return chalk.green.bold("OK   ");
    case "warn":  return chalk.yellow.bold("WARN ");
    case "error": return chalk.red.bold("ERR  ");
    case "proof": return chalk.magenta.bold("PROOF");
  }
};

const sevBar = (lvl: SeverityLvl): string => {
  switch (lvl) {
    case "info":  return "{cyan-fg}▎{/cyan-fg}";
    case "ok":    return "{green-fg}▎{/green-fg}";
    case "warn":  return "{yellow-fg}▎{/yellow-fg}";
    case "error": return "{red-fg}▎{/red-fg}";
    case "proof": return "{magenta-fg}▎{/magenta-fg}";
  }
};

const statusDot = (s: ServerStatus): string => {
  switch (s) {
    case "clean":       return "{green-fg}●{/green-fg} {green-fg}clean{/green-fg}";
    case "drift-minor": return "{yellow-fg}●{/yellow-fg} {yellow-fg}minor{/yellow-fg}";
    case "drift-major": return "{red-fg}●{/red-fg} {red-fg}MAJOR{/red-fg}";
    case "loading":     return "{cyan-fg}◐{/cyan-fg} {cyan-fg}sync…{/cyan-fg}";
    case "error":       return "{red-fg}✗{/red-fg} {red-fg}down{/red-fg} ";
    default:            return "{grey-fg}?{/grey-fg} {grey-fg}—    {/grey-fg}";
  }
};

const severityToStatus = (
  status: "CLEAN" | "DRIFT",
  severity: "MAJOR" | "MINOR" | "PATCH"
): ServerStatus => {
  if (status === "CLEAN") return "clean";
  if (severity === "MAJOR") return "drift-major";
  if (severity === "MINOR") return "drift-minor";
  return "clean";
};

/* ---------- main ---------- */

export async function dashboard(
  configPath: string,
  lockfilePath: string
): Promise<void> {
  let config: SentinelConfig;
  let lockfile: SentinelLockfile;
  try {
    config = JSON.parse(readFileSync(resolve(configPath), "utf-8")) as SentinelConfig;
  } catch {
    config = { compatibility: "BACKWARD", failOn: "MAJOR", servers: {} };
  }
  try {
    lockfile = readLockfile(lockfilePath);
  } catch {
    lockfile = {
      formatVersion: 2,
      generatedAt: "",
      generatedBy: "",
      contentHash: "",
      servers: {},
    };
  }

  /* ----- screen + grid ----- */

  const screen = blessed.screen({
    smartCSR: true,
    title: "MCP Sentinel",
    fullUnicode: true,
    dockBorders: true,
  });

  const grid = new contrib.grid({ rows: 24, cols: 24, screen });

  /* ----- top bar (rows 0–1) ----- */

  const topBar = blessed.box({
    top: 0, left: 0, width: "100%", height: 1,
    tags: true,
    style: { fg: "white", bg: "blue" },
  });
  screen.append(topBar);

  const metricsBar = blessed.box({
    top: 1, left: 0, width: "100%", height: 3,
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "grey" } },
  });
  screen.append(metricsBar);

  /* ----- main panels ----- */

  const serverList = blessed.list({
    top: 4, left: 0, width: "25%", height: "60%-4",
    label: " {bold}servers{/bold} {grey-fg}[↑↓]{/grey-fg} ",
    tags: true,
    keys: true, vi: true, mouse: true,
    border: { type: "line" },
    style: {
      border: { fg: "grey" },
      selected: { bg: "blue", fg: "white", bold: true },
      item: { fg: "white" },
    },
    items: [" loading…"],
  });
  screen.append(serverList);

  const sparkline = contrib.sparkline({
    top: "60%", left: 0, width: "25%", height: "20%-2",
    label: " calls/60s ",
    tags: true,
    style: { fg: "cyan" },
    border: { type: "line" },
  });
  screen.append(sparkline);

  const logPanel = blessed.log({
    top: 4, left: "25%", width: "50%", height: "55%-4",
    label: " {bold}live tool calls{/bold} {grey-fg}[space=pause /=filter]{/grey-fg} ",
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "grey" } },
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    scrollbar: { ch: " ", style: { bg: "cyan" } },
  });
  screen.append(logPanel);

  const inspector = contrib.table({
    top: "55%", left: "25%", width: "50%", height: "25%-2",
    label: " inspector ",
    keys: true,
    fg: "white",
    selectedFg: "white",
    selectedBg: "blue",
    interactive: true,
    border: { type: "line" },
    columnSpacing: 2,
    columnWidth: [22, 7, 9, 10, 16],
  } as any);
  screen.append(inspector as any);

  const alertsList = blessed.list({
    top: 4, left: "75%", width: "25%", height: "55%-4",
    label: " {bold}alerts{/bold} {grey-fg}[a=ack]{/grey-fg} ",
    tags: true,
    keys: true, vi: true, mouse: true,
    border: { type: "line" },
    style: {
      border: { fg: "red" },
      selected: { bg: "red", fg: "white", bold: true },
      item: { fg: "white" },
    },
    items: [" no alerts"],
  });
  screen.append(alertsList);

  const alertDetail = blessed.box({
    top: "55%", left: "75%", width: "25%", height: "25%-2",
    label: " alert detail ",
    tags: true,
    border: { type: "line" },
    style: { border: { fg: "grey" } },
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    content: " select an alert",
  });
  screen.append(alertDetail);

  const statusBar = blessed.box({
    bottom: 0, left: 0, width: "100%", height: 1,
    tags: true,
    style: { fg: "black", bg: "yellow" },
  });
  screen.append(statusBar);

  /* ----- state ----- */

  const serverRows: Record<string, ServerRow> = {};
  for (const [name, srv] of Object.entries(config.servers)) {
    const lk = lockfile.servers[name];
    serverRows[name] = {
      name,
      tools: lk ? Object.keys(lk.tools).length : 0,
      status: "unknown",
      drift: 0,
      lastSnap: lk?.snapshotAt?.slice(0, 16).replace("T", " ") ?? "—",
      version: lk?.serverInfo?.version ?? "—",
      transport: srv.transport ?? "stdio",
      rps: 0,
      calls: 0,
      spark: Array(24).fill(0),
    };
  }

  let selectedServer: string = Object.keys(serverRows).sort()[0] ?? "";
  let alerts: AlertRow[] = [];
  let logFilter: SeverityLvl | "all" = "all";
  let paused = false;
  const allLogs: { lvl: SeverityLvl; line: string }[] = [];

  /* ----- render helpers ----- */

  const fmtTime = (): string => {
    const d = new Date();
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  };

  const renderTopBar = (): void => {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const hints = [
      "{bold}↑↓{/bold} select",
      "{bold}s{/bold} snapshot",
      "{bold}c{/bold} check",
      "{bold}d{/bold} diff",
      "{bold}/{/bold} filter",
      "{bold}q{/bold} quit",
    ].join("  ");
    topBar.setContent(
      ` {bold}MCP SENTINEL{/bold}  {grey-fg}schema-drift monitor · v0.2.0{/grey-fg}    ${hints}    {white-fg}${now}{/white-fg} `
    );
  };

  const renderMetrics = (): void => {
    const all = Object.values(serverRows);
    const clean = all.filter(s => s.status === "clean").length;
    const drifted = all.filter(s => s.status.startsWith("drift")).length;
    const down = all.filter(s => s.status === "error").length;
    const calls = all.reduce((a, s) => a + s.calls, 0);
    const rps = all.reduce((a, s) => a + s.rps, 0);

    const cell = (label: string, value: string, color: string) =>
      `{${color}-fg}${value.padEnd(8)}{/${color}-fg} {grey-fg}${label}{/grey-fg}`;

    metricsBar.setContent(
      ` ${cell("servers", String(all.length),       "white")}` +
      `   ${cell("clean",  String(clean),            "green")}` +
      `   ${cell("drift",  String(drifted),          "yellow")}` +
      `   ${cell("down",   String(down),             "red")}` +
      `   ${cell("calls",  String(calls),            "white")}` +
      `   ${cell("rps",    rps.toFixed(1),           "cyan")}` +
      `   {grey-fg}compat{/grey-fg} {white-fg}${config.compatibility}{/white-fg}` +
      `   {grey-fg}fail-on{/grey-fg} {white-fg}${config.failOn}{/white-fg}`
    );
  };

  const renderServers = (): void => {
    const items = Object.values(serverRows)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(s => {
        const dot = statusDot(s.status);
        const driftBadge = s.drift > 0
          ? ` {inverse}${s.drift}Δ{/inverse}`
          : "";
        return ` ${dot}  ${s.name.padEnd(14)} {grey-fg}v${s.version.padEnd(6)}{/grey-fg} ${String(s.tools).padStart(2)}t${driftBadge}`;
      });
    serverList.setItems(items.length ? items : [" no servers configured"]);
    const idx = Object.keys(serverRows).sort().indexOf(selectedServer);
    if (idx >= 0) serverList.select(idx);
  };

  const renderSparkline = (): void => {
    const s = serverRows[selectedServer];
    if (!s) {
      sparkline.setData([selectedServer || "—"], [[0]]);
    } else {
      sparkline.setData([`${s.name} · ${s.rps.toFixed(2)} rps`], [s.spark]);
    }
  };

  const renderInspector = (): void => {
    const lk = lockfile.servers[selectedServer];
    const headers = ["tool", "params", "required", "state", "hash"];
    if (!lk) {
      inspector.setData({ headers, data: [["—", "—", "—", "—", "—"]] });
      inspector.setLabel(` inspector · {grey-fg}no lockfile{/grey-fg} `);
      return;
    }
    inspector.setLabel(` inspector · {bold}${selectedServer}{/bold}  {grey-fg}snap ${lk.snapshotAt.slice(0,16).replace("T"," ")}{/grey-fg} `);
    const driftByTool = new Map<string, "MAJOR" | "MINOR" | "PATCH">();
    for (const c of serverRows[selectedServer]?.lastChanges ?? []) {
      const cur = driftByTool.get(c.tool);
      if (!cur || sevRank(c.severity) > sevRank(cur)) {
        driftByTool.set(c.tool, c.severity);
      }
    }
    const data = Object.entries(lk.tools).map(([name, tool]) => {
      const props = (tool.inputSchema as any)?.properties ?? {};
      const req = ((tool.inputSchema as any)?.required ?? []) as string[];
      const sev = driftByTool.get(name);
      const state = sev === "MAJOR" ? "● MAJOR"
                  : sev === "MINOR" ? "● minor"
                  : "● clean";
      return [
        name,
        String(Object.keys(props).length),
        String(req.length),
        state,
        tool.hash.slice(7, 19) + "…",
      ];
    });
    inspector.setData({ headers, data: data.length ? data : [["—","—","—","—","—"]] });
  };

  const renderAlerts = (): void => {
    const items = alerts.map(a => {
      const lvl = a.level === "major" || a.level === "error" ? "{red-fg}●{/red-fg}"
                : a.level === "minor" ? "{yellow-fg}●{/yellow-fg}"
                : "{yellow-fg}●{/yellow-fg}";
      const z3 = a.z3 === "BROKEN" ? " {magenta-fg}[z3:BROKEN]{/magenta-fg}"
               : a.z3 === "SAFE"   ? " {green-fg}[z3:SAFE]{/green-fg}"
               : "";
      return ` ${lvl} {bold}${a.title}{/bold}${z3}\n   {grey-fg}${a.server}::${a.tool} · ${a.rule} ×${a.occurrences}{/grey-fg}`;
    });
    alertsList.setItems(items.length ? items : [" {green-fg}✓ no active alerts{/green-fg}"]);
  };

  const renderAlertDetail = (idx: number): void => {
    const a = alerts[idx];
    if (!a) {
      alertDetail.setContent(" select an alert");
      return;
    }
    const lvl = a.level === "major" || a.level === "error" ? "red"
              : "yellow";
    const lines: string[] = [];
    lines.push(` {${lvl}-fg}{bold}${a.title}{/bold}{/${lvl}-fg}`);
    lines.push(` {grey-fg}${a.id} · ${a.ts}{/grey-fg}`);
    lines.push("");
    lines.push(` {grey-fg}server{/grey-fg} ${a.server}`);
    lines.push(` {grey-fg}tool  {/grey-fg} ${a.tool}`);
    lines.push(` {grey-fg}rule  {/grey-fg} {${lvl}-fg}${a.rule}{/${lvl}-fg}`);
    lines.push("");
    lines.push(` {grey-fg}diff{/grey-fg}`);
    lines.push(` {white-fg}${a.summary}{/white-fg}`);
    if (a.detail) {
      lines.push("");
      lines.push(` ${a.detail}`);
    }
    if (a.counterexample && a.counterexample !== "n/a") {
      lines.push("");
      lines.push(` {magenta-fg}{bold}z3 counterexample{/bold}{/magenta-fg}`);
      lines.push(` {magenta-fg}${a.counterexample}{/magenta-fg}`);
    }
    alertDetail.setContent(lines.join("\n"));
  };

  const renderStatus = (): void => {
    const filterStr = logFilter === "all" ? "all" : logFilter;
    const pauseStr = paused ? "{red-fg}⏸ paused{/red-fg}" : "{green-fg}● streaming{/green-fg}";
    statusBar.setContent(
      ` watch · 5s    lockfile: ${lockfilePath}    filter: ${filterStr}    ${pauseStr}    {black-fg}q quit · tab focus · space pause{/black-fg} `
    );
  };

  /* ----- log stream ----- */

  const log = (lvl: SeverityLvl, src: string, tool: string, msg: string): void => {
    const line =
      `${sevBar(lvl)} {grey-fg}${fmtTime()}{/grey-fg}  ${sevTagTag(lvl)}  ` +
      `${src.padEnd(12)} {grey-fg}${tool.padEnd(22)}{/grey-fg} ${msg}`;
    allLogs.push({ lvl, line });
    if (allLogs.length > 1000) allLogs.shift();
    if (paused) return;
    if (logFilter === "all" || logFilter === lvl) logPanel.log(line);
  };

  const sevTagTag = (lvl: SeverityLvl): string => {
    switch (lvl) {
      case "info":  return "{cyan-fg}{bold}INFO {/bold}{/cyan-fg}";
      case "ok":    return "{green-fg}{bold}OK   {/bold}{/green-fg}";
      case "warn":  return "{yellow-fg}{bold}WARN {/bold}{/yellow-fg}";
      case "error": return "{red-fg}{bold}ERR  {/bold}{/red-fg}";
      case "proof": return "{magenta-fg}{bold}PROOF{/bold}{/magenta-fg}";
    }
  };

  const reflowLogs = (): void => {
    logPanel.setContent("");
    for (const { lvl, line } of allLogs) {
      if (logFilter === "all" || logFilter === lvl) logPanel.log(line);
    }
  };

  /* ----- actions ----- */

  const checkOne = async (name: string): Promise<void> => {
    const cfg = config.servers[name];
    if (!cfg) { log("error", name, "—", "not in config"); return; }
    const row = serverRows[name];
    if (!row) return;
    row.status = "loading";
    renderServers(); screen.render();
    try {
      const live = await fetchLiveTools(name, cfg);
      const result = diffAll(lockfile, [live], config.rules)[0] as DiffResult | undefined;
      if (!result) { row.status = "error"; return; }
      row.tools = Object.keys(live.tools).length;
      row.status = severityToStatus(result.status, result.severity);
      row.drift = result.changes.length;
      row.lastChanges = result.changes;

      if (result.changes.length === 0) {
        log("ok", name, "—", "clean — no drift");
      } else {
        log(result.severity === "MAJOR" ? "error" : "warn", name, "—",
          `${result.changes.length} change(s) — ${result.severity}`);
        for (const c of result.changes) {
          const level: AlertRow["level"] =
            c.severity === "MAJOR" ? "major"
            : c.severity === "MINOR" ? "minor"
            : "warn";
          alerts.unshift({
            id: `A-${Math.floor(Math.random() * 9000 + 1000)}`,
            level,
            server: name,
            tool: c.tool,
            rule: c.ruleId,
            title: c.summary,
            summary: `${formatVal(c.before)} → ${formatVal(c.after)}`,
            detail: c.detail,
            z3: undefined,
            counterexample: undefined,
            occurrences: 1,
            ts: new Date().toISOString().slice(0, 19).replace("T", " "),
          });
        }
        if (alerts.length > 50) alerts = alerts.slice(0, 50);
      }
    } catch (err) {
      row.status = "error";
      log("error", name, "—", err instanceof Error ? err.message : String(err));
    }
    renderAll();
  };

  const formatVal = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
    return String(v).slice(0, 60);
  };

  const sevRank = (s: "MAJOR" | "MINOR" | "PATCH"): number =>
    s === "MAJOR" ? 3 : s === "MINOR" ? 2 : 1;

  const snapshotOne = async (name: string): Promise<void> => {
    const cfg = config.servers[name];
    if (!cfg) { log("error", name, "—", "not in config"); return; }
    const row = serverRows[name];
    if (!row) return;
    row.status = "loading";
    renderServers(); screen.render();
    try {
      const result = await snapshotServer(name, cfg);
      lockfile.servers[name] = {
        transport: result.snapshot.transport,
        protocolVersion: result.snapshot.protocolVersion,
        serverInfo: result.snapshot.serverInfo,
        schemaHash: "",
        snapshotAt: new Date().toISOString(),
        tools: result.snapshot.tools,
      };
      row.tools = Object.keys(result.snapshot.tools).length;
      row.version = result.snapshot.serverInfo.version;
      row.lastSnap = new Date().toISOString().slice(0, 16).replace("T", " ");
      row.status = "clean";
      row.drift = 0;
      log("ok", name, "—", `snapshot complete — ${row.tools} tools`);
    } catch (err) {
      row.status = "error";
      log("error", name, "—", err instanceof Error ? err.message : String(err));
    }
    renderAll();
  };

  /* ----- render-all ----- */

  const renderAll = (): void => {
    renderTopBar();
    renderMetrics();
    renderServers();
    renderSparkline();
    renderInspector();
    renderAlerts();
    renderStatus();
    screen.render();
  };

  /* ----- key bindings ----- */

  screen.key(["q", "C-c"], () => process.exit(0));
  screen.key(["tab"], () => screen.focusNext());

  serverList.on("select", (_item, idx) => {
    const names = Object.keys(serverRows).sort();
    selectedServer = names[idx] ?? selectedServer;
    renderInspector();
    renderSparkline();
    screen.render();
  });

  alertsList.on("select item", (_item, idx) => {
    renderAlertDetail(idx);
    screen.render();
  });

  screen.key(["s"], () => { if (selectedServer) void snapshotOne(selectedServer); });
  screen.key(["c"], () => { if (selectedServer) void checkOne(selectedServer); });
  screen.key(["S-a"], () => {
    log("info", "sentinel", "—", "snapshotting all servers…");
    void Promise.all(Object.keys(serverRows).map(n => snapshotOne(n)));
  });
  screen.key(["S-c"], () => {
    log("info", "sentinel", "—", "checking all servers…");
    void Promise.all(Object.keys(serverRows).map(n => checkOne(n)));
  });
  screen.key(["a"], () => {
    const idx = (alertsList as any).selected ?? 0;
    if (alerts[idx]) {
      const removed = alerts.splice(idx, 1)[0];
      log("info", "sentinel", "—", `acked ${removed!.id}`);
      renderAlerts();
      screen.render();
    }
  });
  screen.key(["space"], () => {
    paused = !paused;
    if (!paused) reflowLogs();
    renderStatus();
    screen.render();
  });
  screen.key(["/"], () => {
    const cycle: (SeverityLvl | "all")[] = ["all", "info", "warn", "error"];
    logFilter = cycle[(cycle.indexOf(logFilter) + 1) % cycle.length] ?? "all";
    reflowLogs();
    renderStatus();
    screen.render();
  });
  screen.key(["d"], () => {
    if (!selectedServer) return;
    const changes = serverRows[selectedServer]?.lastChanges ?? [];
    if (changes.length === 0) {
      log("info", selectedServer, "diff", "no changes — run 'c' to check first");
      return;
    }
    for (const c of changes.slice(0, 6)) {
      log(c.severity === "MAJOR" ? "error" : c.severity === "MINOR" ? "warn" : "info",
        selectedServer, c.tool, `[${c.severity}] ${c.ruleId}: ${c.summary}`);
    }
  });

  /* ----- live tickers ----- */

  setInterval(() => { renderTopBar(); screen.render(); }, 1000);

  setInterval(() => {
    for (const s of Object.values(serverRows)) {
      if (s.status === "error") continue;
      s.spark.shift();
      s.spark.push(Math.max(0, Math.round(s.rps * 2 + (Math.random() - 0.5) * 2)));
      s.rps = Math.max(0, s.rps + (Math.random() - 0.5) * 0.3);
    }
    renderSparkline();
    renderMetrics();
    screen.render();
  }, 1500);

  /* ----- boot ----- */

  renderAll();
  log("info", "sentinel", "boot",
    `loaded ${Object.keys(serverRows).length} server(s) from ${configPath}`);
  log("info", "sentinel", "boot",
    `lockfile: ${lockfile.servers ? Object.keys(lockfile.servers).length : 0} servers locked`);
  log("info", "sentinel", "—",
    `press 'C' to check all · 'A' to snapshot all`);

  serverList.focus();
  screen.render();
}
