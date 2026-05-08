import assert from "node:assert/strict";
import test from "node:test";
import { validateLockfile } from "../core/lockfile.js";

test("validates empty lockfiles", () => {
  const errors = validateLockfile({
    formatVersion: 2,
    generatedAt: "",
    generatedBy: "",
    contentHash: "",
    servers: {},
  });

  assert.deepEqual(errors, ["Lockfile contains no servers"]);
});

test("accepts a populated lockfile", () => {
  const errors = validateLockfile({
    formatVersion: 2,
    generatedAt: "2026-05-08T00:00:00.000Z",
    generatedBy: "mcp-sentinel",
    contentHash: "sha256:test",
    servers: {
      filesystem: {
        transport: "stdio",
        protocolVersion: "1.0.0",
        serverInfo: { name: "filesystem", version: "1.0.0" },
        schemaHash: "sha256:test",
        snapshotAt: "2026-05-08T00:00:00.000Z",
        tools: {
          read_file: {
            hash: "sha256:test",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
      },
    },
  });

  assert.deepEqual(errors, []);
});
