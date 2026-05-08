import blessed from "blessed";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readLockfile, writeLockfile } from "../core/lockfile.js";
import { fetchLiveTools, snapshotServer } from "../core/transport.js";
import type {
  DiffResult,
  SchemaChange,
  SentinelConfig,
  SentinelLockfile,
} from "../core/types.js";
import { diffAll } from "../diff/engine.js";

type ServerStatus = "clean" | "drift" | "loading" | "error" | "unknown";
type LogLevel = "info" | "ok" | "warn" | "error";

interface ServerRow {
  name: string;
  transport: string;
  status: ServerStatus;
  tools: number;
  drift: number;
  version: string;
  lastSnapshot: string;
  lastChanges: SchemaChange[];
}

interface AlertRow {
  server: string;
  tool: string;
  severity: "MAJOR" | "MINOR" | "PATCH";
  ruleId: string;
  summary: string;
  detail: string;
}

export async function dashboard(
  configPath: string,
  lockfilePath: string
): Promise<void> {
  const config = readConfig(configPath);
  const lockfile = readLockfileOrEmpty(lockfilePath);
  const servers = createServerRows(config, lockfile);

  let selectedServer = Object.keys(servers).sort()[0] ?? "";
  let alerts: AlertRow[] = [];
  let paused = false;
  let logFilter: LogLevel | "all" = "all";
  const logs: { level: LogLevel; text: string }[] = [];

  const screen = blessed.screen({
    smartCSR: true,
    title: "MCP Sentinel",
    fullUnicode: true,
    dockBorders: true,
  });

  const header = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    style: { fg: "white", bg: "blue" },
  });

  const serversBox = blessed.list({
    top: 3,
    left: 0,
    width: "28%",
    height: "100%-6",
    label: " Servers ",
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    border: "line",
    style: {
      border: { fg: "cyan" },
      selected: { bg: "blue", fg: "white", bold: true },
    },
  });

  const toolsTable = blessed.box({
    top: 3,
    left: "28%",
    width: "47%",
    height: "58%",
    label: " Selected Server Tools ",
    tags: true,
    mouse: true,
    keys: true,
    vi: true,
    scrollable: true,
    alwaysScroll: true,
    border: "line",
    style: {
      border: { fg: "cyan" },
    },
    scrollbar: { ch: " ", style: { bg: "cyan" } },
  });

  const activity = blessed.log({
    top: "61%",
    left: "28%",
    width: "47%",
    height: "36%",
    label: " Activity ",
    tags: true,
    keys: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    border: "line",
    style: { border: { fg: "cyan" } },
    scrollbar: { ch: " ", style: { bg: "cyan" } },
  });

  const alertsBox = blessed.list({
    top: 3,
    left: "75%",
    width: "25%",
    height: "58%",
    label: " Alerts ",
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    border: "line",
    style: {
      border: { fg: "yellow" },
      selected: { bg: "yellow", fg: "black", bold: true },
    },
  });

  const detailsBox = blessed.box({
    top: "61%",
    left: "75%",
    width: "25%",
    height: "36%",
    label: " Details ",
    tags: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    border: "line",
    style: { border: { fg: "cyan" } },
    content: "Select an alert to inspect it.",
  });

  const footer = blessed.box({
    bottom: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    style: { fg: "white", bg: "black" },
  });

  screen.append(header);
  screen.append(serversBox);
  screen.append(toolsTable);
  screen.append(activity);
  screen.append(alertsBox);
  screen.append(detailsBox);
  screen.append(footer);

  const renderHeader = (): void => {
    const values = Object.values(servers);
    const clean = values.filter((server) => server.status === "clean").length;
    const drift = values.filter((server) => server.status === "drift").length;
    const down = values.filter((server) => server.status === "error").length;
    const unknown = values.filter((server) => server.status === "unknown").length;
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    header.setContent(
      [
        " MCP Sentinel v1.0.0  schema drift monitor",
        ` servers ${values.length}   clean ${clean}   drift ${drift}   down ${down}   unknown ${unknown}   compat ${config.compatibility}   fail-on ${config.failOn}   ${now}`,
      ].join("\n")
    );
  };

  const renderServers = (): void => {
    const names = Object.keys(servers).sort();
    serversBox.setItems(
      names.length
        ? names.map((name) => {
            const row = servers[name]!;
            const drift = row.drift > 0 ? ` ${row.drift} changes` : "";
            return `${statusLabel(row.status)} ${name}  ${row.transport}  ${row.tools} tools${drift}`;
          })
        : ["No servers configured. Run sentinel discover --write."]
    );
    const selectedIndex = names.indexOf(selectedServer);
    if (selectedIndex >= 0) serversBox.select(selectedIndex);
  };

  const renderTools = (): void => {
    const locked = lockfile.servers[selectedServer];
    const changes = servers[selectedServer]?.lastChanges ?? [];
    const severityByTool = new Map<string, SchemaChange["severity"]>();
    for (const change of changes) {
      const previous = severityByTool.get(change.tool);
      if (!previous || severityRank(change.severity) > severityRank(previous)) {
        severityByTool.set(change.tool, change.severity);
      }
    }

    const rows = [
      `${pad("Tool", 28)} ${pad("Params", 6)} ${pad("Req", 4)} ${pad("State", 10)} Hash`,
      `${"-".repeat(28)} ${"-".repeat(6)} ${"-".repeat(4)} ${"-".repeat(10)} ${"-".repeat(12)}`,
    ];
    if (!locked) {
      rows.push("No lockfile yet. Press s to snapshot the selected server.");
    } else {
      for (const [toolName, tool] of Object.entries(locked.tools)) {
        const schema = tool.inputSchema as {
          properties?: Record<string, unknown>;
          required?: string[];
        };
        const severity = severityByTool.get(toolName);
        rows.push(
          `${pad(toolName, 28)} ${pad(String(Object.keys(schema.properties ?? {}).length), 6)} ` +
          `${pad(String((schema.required ?? []).length), 4)} ${pad(severity ? severity.toLowerCase() : "clean", 10)} ` +
          `${tool.hash.slice(7, 19)}`
        );
      }
    }
    toolsTable.setContent(rows.join("\n"));
  };

  const renderAlerts = (): void => {
    alertsBox.setItems(
      alerts.length
        ? alerts.map((alert) => `${alert.severity.padEnd(5)} ${alert.server}/${alert.tool} ${alert.ruleId}`)
        : ["No active alerts"]
    );
    if (alerts.length === 0) detailsBox.setContent("No active alerts.");
  };

  const renderFooter = (): void => {
    footer.setContent(
      [
        ` s snapshot selected   a snapshot all   c check selected   C check all   d print diff   / filter ${logFilter}   space ${paused ? "resume" : "pause"}   q quit`,
        ` config ${configPath}   lockfile ${lockfilePath}`,
      ].join("\n")
    );
  };

  const renderAll = (): void => {
    renderHeader();
    renderServers();
    renderTools();
    renderAlerts();
    renderFooter();
    screen.render();
  };

  const addLog = (level: LogLevel, source: string, message: string): void => {
    const line = `${time()} ${logLabel(level)} ${source.padEnd(14)} ${message}`;
    logs.push({ level, text: line });
    if (logs.length > 500) logs.shift();
    if (!paused && (logFilter === "all" || logFilter === level)) activity.log(line);
  };

  const refreshLogs = (): void => {
    activity.setContent("");
    for (const entry of logs) {
      if (logFilter === "all" || logFilter === entry.level) activity.log(entry.text);
    }
  };

  const snapshotOne = async (name: string): Promise<void> => {
    const serverConfig = config.servers[name];
    const row = servers[name];
    if (!serverConfig || !row) return;

    row.status = "loading";
    renderAll();
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
      row.status = "clean";
      row.tools = Object.keys(result.snapshot.tools).length;
      row.version = result.snapshot.serverInfo.version;
      row.lastSnapshot = new Date().toISOString();
      row.drift = 0;
      row.lastChanges = [];
      writeLockfile(lockfilePath, lockfile);
      addLog("ok", name, `snapshot captured ${row.tools} tools and wrote ${lockfilePath}`);
    } catch (err) {
      row.status = "error";
      addLog("error", name, errorMessage(err));
    }
    renderAll();
  };

  const checkOne = async (name: string): Promise<void> => {
    const serverConfig = config.servers[name];
    const row = servers[name];
    if (!serverConfig || !row) return;

    row.status = "loading";
    renderAll();
    try {
      const live = await fetchLiveTools(name, serverConfig);
      const result = diffAll(lockfile, [live], config.rules)[0] as DiffResult | undefined;
      if (!result) throw new Error("No diff result returned.");

      row.tools = Object.keys(live.tools).length;
      row.drift = result.changes.length;
      row.lastChanges = result.changes;
      row.status = result.status === "CLEAN" ? "clean" : "drift";

      if (result.changes.length === 0) {
        addLog("ok", name, "clean, no schema drift");
      } else {
        addLog(result.severity === "MAJOR" ? "error" : "warn", name, `${result.changes.length} change(s), worst ${result.severity}`);
        alerts = [
          ...result.changes.map((change) => ({
            server: name,
            tool: change.tool,
            severity: change.severity,
            ruleId: change.ruleId,
            summary: change.summary,
            detail: change.detail,
          })),
          ...alerts,
        ].slice(0, 100);
      }
    } catch (err) {
      row.status = "error";
      addLog("error", name, errorMessage(err));
    }
    renderAll();
  };

  screen.key(["q", "C-c"], () => process.exit(0));
  screen.key(["tab"], () => screen.focusNext());
  screen.key(["s"], () => { if (selectedServer) void snapshotOne(selectedServer); });
  screen.key(["c"], () => { if (selectedServer) void checkOne(selectedServer); });
  screen.key(["a"], () => { void Promise.all(Object.keys(servers).map((name) => snapshotOne(name))); });
  screen.key(["C"], () => { void Promise.all(Object.keys(servers).map((name) => checkOne(name))); });
  screen.key(["space"], () => {
    paused = !paused;
    if (!paused) refreshLogs();
    renderFooter();
    screen.render();
  });
  screen.key(["/"], () => {
    const levels: (LogLevel | "all")[] = ["all", "info", "ok", "warn", "error"];
    logFilter = levels[(levels.indexOf(logFilter) + 1) % levels.length] ?? "all";
    refreshLogs();
    renderFooter();
    screen.render();
  });
  screen.key(["d"], () => {
    const changes = servers[selectedServer]?.lastChanges ?? [];
    if (changes.length === 0) {
      addLog("info", selectedServer || "sentinel", "no changes to print; run check first");
      return;
    }
    for (const change of changes.slice(0, 10)) {
      addLog(change.severity === "MAJOR" ? "error" : "warn", selectedServer, `${change.severity} ${change.tool}.${change.field} ${change.ruleId}`);
    }
  });

  serversBox.on("select", (_item, index) => {
    selectedServer = Object.keys(servers).sort()[index] ?? selectedServer;
    renderTools();
    screen.render();
  });

  alertsBox.on("select", (_item, index) => {
    const alert = alerts[index];
    if (!alert) return;
    detailsBox.setContent(
      [
        `${alert.severity} ${alert.ruleId}`,
        "",
        `server: ${alert.server}`,
        `tool:   ${alert.tool}`,
        "",
        alert.summary,
        alert.detail ? `\n${alert.detail}` : "",
      ].join("\n")
    );
    screen.render();
  });

  setInterval(() => {
    renderHeader();
    screen.render();
  }, 1000);

  renderAll();
  addLog("info", "sentinel", `loaded ${Object.keys(servers).length} server(s) from ${configPath}`);
  addLog("info", "sentinel", `lockfile has ${Object.keys(lockfile.servers).length} server(s)`);
  serversBox.focus();
  screen.render();
}

function readConfig(path: string): SentinelConfig {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf-8")) as SentinelConfig;
  } catch {
    return { compatibility: "BACKWARD", failOn: "MAJOR", servers: {} };
  }
}

function readLockfileOrEmpty(path: string): SentinelLockfile {
  try {
    return readLockfile(path);
  } catch {
    return {
      formatVersion: 2,
      generatedAt: "",
      generatedBy: "",
      contentHash: "",
      servers: {},
    };
  }
}

function createServerRows(
  config: SentinelConfig,
  lockfile: SentinelLockfile
): Record<string, ServerRow> {
  const rows: Record<string, ServerRow> = {};
  for (const [name, serverConfig] of Object.entries(config.servers)) {
    const locked = lockfile.servers[name];
    rows[name] = {
      name,
      transport: serverConfig.transport ?? "stdio",
      status: locked ? "clean" : "unknown",
      tools: locked ? Object.keys(locked.tools).length : 0,
      drift: 0,
      version: locked?.serverInfo.version ?? "-",
      lastSnapshot: locked?.snapshotAt ?? "",
      lastChanges: [],
    };
  }
  return rows;
}

function statusLabel(status: ServerStatus): string {
  switch (status) {
    case "clean": return "{green-fg}OK{/green-fg}";
    case "drift": return "{yellow-fg}DRIFT{/yellow-fg}";
    case "loading": return "{cyan-fg}...{/cyan-fg}";
    case "error": return "{red-fg}DOWN{/red-fg}";
    case "unknown": return "{grey-fg}NEW{/grey-fg}";
  }
}

function severityRank(severity: SchemaChange["severity"]): number {
  if (severity === "MAJOR") return 3;
  if (severity === "MINOR") return 2;
  return 1;
}

function logLabel(level: LogLevel): string {
  switch (level) {
    case "info": return chalk.cyan("INFO");
    case "ok": return chalk.green("OK  ");
    case "warn": return chalk.yellow("WARN");
    case "error": return chalk.red("ERR ");
  }
}

function time(): string {
  return new Date().toTimeString().slice(0, 8);
}

function pad(value: string, width: number): string {
  const sliced = value.length > width ? value.slice(0, Math.max(0, width - 1)) + "." : value;
  return sliced.padEnd(width);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
