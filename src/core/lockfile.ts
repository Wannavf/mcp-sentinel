import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { hashContent } from "./hasher.js";
import type { SentinelLockfile } from "./types.js";

const FORMAT_VERSION = 2;

export function readLockfile(path: string): SentinelLockfile {
  const raw = readFileSync(resolve(path), "utf-8");
  const lockfile = JSON.parse(raw) as SentinelLockfile;
  if (!lockfile.formatVersion || lockfile.formatVersion < 2) {
    throw new Error("Unsupported lockfile format version " + lockfile.formatVersion);
  }
  return lockfile;
}

export function writeLockfile(path: string, lockfile: SentinelLockfile): void {
  lockfile.formatVersion = FORMAT_VERSION;
  lockfile.generatedAt = new Date().toISOString();
  lockfile.generatedBy = "@wannavf/mcp-sentinel@1.0.0";
  lockfile.contentHash = hashContent(JSON.stringify(lockfile, sortedReplacer, 2));
  writeFileSync(resolve(path), JSON.stringify(lockfile, sortedReplacer, 2) + "\n", "utf-8");
}

export function validateLockfile(lockfile: SentinelLockfile): string[] {
  const errors: string[] = [];
  if (!lockfile.servers || Object.keys(lockfile.servers).length === 0) {
    errors.push("Lockfile contains no servers");
    return errors;
  }
  for (const [name, server] of Object.entries(lockfile.servers)) {
    if (!server.tools || Object.keys(server.tools).length === 0) {
      errors.push("Server " + name + " has no tools");
    }
    if (!server.protocolVersion) {
      errors.push("Server " + name + " missing protocolVersion");
    }
  }
  return errors;
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
