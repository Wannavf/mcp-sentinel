import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discover } from "../cli/discover.js";

test("discovers and imports mcp.json servers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-discover-"));
  writeFileSync(
    join(dir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        demo: {
          command: "node",
          args: ["server.js"],
        },
      },
    }),
    "utf-8"
  );

  const originalCwd = process.cwd();
  const originalStdin = process.stdin;
  try {
    process.chdir(dir);
    process.stdin.push("all\n");
    await discover("sentinel.config.json", true, false);
  } finally {
    process.chdir(originalCwd);
    process.stdin.pause();
  }

  const config = JSON.parse(readFileSync(join(dir, "sentinel.config.json"), "utf-8"));
  assert.equal(config.servers.demo.command, "node");
  assert.deepEqual(config.servers.demo.args, ["server.js"]);
  assert.equal(originalStdin, process.stdin);
});
