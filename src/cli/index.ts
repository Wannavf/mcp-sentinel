#!/usr/bin/env node
import { Command } from "commander";
import { snapshot } from "./snapshot.js";
import { check } from "./check.js";
import { diff } from "./diff.js";
import { update } from "./update.js";
import { watch } from "./watch.js";
import { audit } from "./audit.js";
import { init } from "./init.js";
import { discover } from "./discover.js";
import { doctor } from "./doctor.js";
import { lockfileDiff } from "./lockfile-diff.js";
import { dashboard } from "./tui.js";

const program = new Command();

program
  .name("sentinel")
  .description("MCP Sentinel \u2014 Schema drift detection for MCP servers. The lockfile MCP should have shipped with.")
  .version("1.0.0");

program
  .command("init")
  .description("Interactive setup: create sentinel.config.json and empty lockfile")
  .option("-d, --dir <path>", "Target directory", ".")
  .action(async (opts) => {
    try { await init(opts.dir); } catch (err) {
      console.error("sentinel: " + (err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

program
  .command("discover")
  .description("Find MCP server configs on this machine and optionally import them")
  .option("-c, --config <path>", "Path to sentinel.config.json", "sentinel.config.json")
  .option("-w, --write", "Choose discovered servers and write them to config")
  .option("--json", "Print discovered servers as JSON")
  .action(async (opts) => {
    try { await discover(opts.config, Boolean(opts.write), Boolean(opts.json)); }
    catch (err) { console.error("sentinel: " + (err instanceof Error ? err.message : String(err))); process.exit(1); }
  });

program
  .command("doctor")
  .description("Validate Sentinel config, server entries, and lockfile readiness")
  .option("-c, --config <path>", "Path to sentinel.config.json", "sentinel.config.json")
  .option("-l, --lockfile <path>", "Path to sentinel-lock.json", "sentinel-lock.json")
  .action(async (opts) => {
    try {
      const ok = await doctor(opts.config, opts.lockfile);
      process.exit(ok ? 0 : 1);
    } catch (err) {
      console.error("sentinel: " + (err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  });

program
  .command("snapshot")
  .description("Connect to configured MCP servers and record all tool schemas to a lockfile")
  .option("-c, --config <path>", "Path to sentinel.config.json", "sentinel.config.json")
  .option("-o, --output <path>", "Path to output lockfile", "sentinel-lock.json")
  .option("-s, --server <name>", "Only snapshot this specific server")
  .option("-q, --quiet", "Suppress progress output")
  .action(async (opts) => {
    try { await snapshot(opts.config, opts.output, opts.server, opts.quiet); }
    catch (err) { console.error("sentinel: " + (err instanceof Error ? err.message : String(err))); process.exit(1); }
  });

program
  .command("check")
  .description("Compare live tool schemas against the lockfile for drift")
  .option("-c, --config <path>", "Path to sentinel.config.json", "sentinel.config.json")
  .option("-l, --lockfile <path>", "Path to sentinel-lock.json", "sentinel-lock.json")
  .option("-s, --server <name>", "Only check this specific server")
  .option("--fail-on <severity>", "Exit 1 if any change >= severity (MAJOR|MINOR|PATCH)", "MAJOR")
  .option("-q, --quiet", "Suppress progress output")
  .action(async (opts) => {
    try { const p = await check(opts.config, opts.lockfile, opts.failOn, opts.server, opts.quiet); process.exit(p ? 0 : 1); }
    catch (err) { console.error("sentinel: " + (err instanceof Error ? err.message : String(err))); process.exit(2); }
  });

program
  .command("diff")
  .description("Show detailed schema changes between lockfile and live servers")
  .option("-c, --config <path>", "Path to sentinel.config.json", "sentinel.config.json")
  .option("-l, --lockfile <path>", "Path to sentinel-lock.json", "sentinel-lock.json")
  .option("-s, --server <name>", "Only diff this specific server")
  .option("--format <format>", "Output format: console | json | markdown | sarif", "console")
  .option("--fail-on <severity>", "Exit 1 if any change >= severity", "PATCH")
  .option("-q, --quiet", "Suppress progress output")
  .action(async (opts) => {
    try { const p = await diff(opts.config, opts.lockfile, opts.format, opts.failOn, opts.server, opts.quiet); process.exit(p ? 0 : 1); }
    catch (err) { console.error("sentinel: " + (err instanceof Error ? err.message : String(err))); process.exit(2); }
  });

program
  .command("update")
  .description("Accept current schemas as the new baseline (update lockfile)")
  .option("-c, --config <path>", "Path to sentinel.config.json", "sentinel.config.json")
  .option("-o, --output <path>", "Path to sentinel-lock.json", "sentinel-lock.json")
  .option("-s, --server <name>", "Only update this specific server")
  .option("-q, --quiet", "Suppress progress output")
  .action(async (opts) => {
    try { await update(opts.config, opts.output, opts.server, opts.quiet); }
    catch (err) { console.error("sentinel: " + (err instanceof Error ? err.message : String(err))); process.exit(1); }
  });

program
  .command("watch")
  .description("Run as a long-lived daemon, polling for schema changes")
  .option("-c, --config <path>", "Path to sentinel.config.json", "sentinel.config.json")
  .option("-l, --lockfile <path>", "Path to sentinel-lock.json", "sentinel-lock.json")
  .option("-s, --server <name>", "Only watch this specific server")
  .option("--interval <seconds>", "Polling interval in seconds", "30")
  .action(async (opts) => {
    try { await watch(opts.config, opts.lockfile, parseInt(opts.interval, 10), opts.server); }
    catch (err) { console.error("sentinel: " + (err instanceof Error ? err.message : String(err))); process.exit(1); }
  });

program
  .command("audit")
  .description("Score MCP server schema quality: completeness, type coverage, risks")
  .option("-c, --config <path>", "Path to sentinel.config.json", "sentinel.config.json")
  .option("-l, --lockfile <path>", "Path to sentinel-lock.json", "sentinel-lock.json")
  .option("-s, --server <name>", "Only audit this specific server")
  .option("-q, --quiet", "Suppress progress output")
  .action(async (opts) => {
    try { await audit(opts.config, opts.lockfile, opts.server, opts.quiet); }
    catch (err) { console.error("sentinel: " + (err instanceof Error ? err.message : String(err))); process.exit(1); }
  });

program
  .command("lockfile-diff")
  .description("Compare two lockfiles against each other (no live servers)")
  .option("-o, --old <path>", "Path to the old lockfile", "sentinel-lock.old.json")
  .option("-n, --new <path>", "Path to the new lockfile", "sentinel-lock.json")
  .option("--format <format>", "Output format: console | json | markdown | sarif", "console")
  .action(async (opts) => {
    try { const out = lockfileDiff(opts.old, opts.new, opts.format); console.log(out); }
    catch (err) { console.error("sentinel: " + (err instanceof Error ? err.message : String(err))); process.exit(1); }
  });

program
  .command("dashboard")
  .alias("db")
  .description("Open interactive terminal dashboard")
  .option("-c, --config <path>", "Path to sentinel.config.json", "sentinel.config.json")
  .option("-l, --lockfile <path>", "Path to sentinel-lock.json", "sentinel-lock.json")
  .action(async (opts) => {
    try { await dashboard(opts.config, opts.lockfile); }
    catch (err) { console.error("sentinel: " + (err instanceof Error ? err.message : String(err))); process.exit(1); }
  });

program.parse();
