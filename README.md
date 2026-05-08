# MCP Sentinel

**Schema drift detection for MCP servers — the lockfile MCP should have shipped with.**

MCP Sentinel snapshots your MCP server tool schemas, detects breaking changes, and classifies them as MAJOR, MINOR, or PATCH — so your agents never break on silent schema drift.

[![npm version](https://img.shields.io/npm/v/@wannavf/mcp-sentinel)](https://www.npmjs.com/package/@wannavf/mcp-sentinel)
[![npm downloads](https://img.shields.io/npm/dm/@wannavf/mcp-sentinel)](https://www.npmjs.com/package/@wannavf/mcp-sentinel)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Quick Start

```bash
npx @wannavf/mcp-sentinel init
sentinel snapshot
sentinel check
sentinel diff
```

Sentinel creates a `sentinel-lock.json` for your MCP server tool schemas. When a tool changes later, `sentinel check` fails CI and `sentinel diff` shows exactly what changed.

```text
filesystem: DRIFT detected

MAJOR  read_file.path
       PARAM_CONSTRAINT_TIGHTENED
       minimum changed from 0 to 1

PATCH  search_files
       TOOL_ADDED
       New tool is available on the server
```

## What It Catches

- Removed tools and parameters
- Required fields added to tool inputs
- Type changes like `string` to `number`
- Tightened constraints like `minimum`, `maximum`, `minLength`, and enums
- Output schema changes that can break downstream agents
- Missing descriptions and weak schema coverage

---

## Why Sentinel

9,400+ MCP servers. 97 million SDK downloads per month. **Zero per-tool versioning in the protocol.**

When a server changes `amount: { minimum: 0 }` to `amount: { minimum: 1 }`, your agent silently breaks. No error message. The MCP spec has `list_changed` to say "something changed" — but not what, and not whether it matters.

**Sentinel tells you what changed, how severe it is, and whether your agents will break.**

---

## What Makes Sentinel Different

| | Other tools | Sentinel |
|---|---|---|
| Detect schema changes | Maybe | 20 classification rules |
| Classify MAJOR/MINOR/PATCH | No | Semantic JSON Schema diff |
| CI integration | Some | GitHub Action + SARIF output |
| Schema quality audit | No | Completeness + type coverage |
| Lockfile with hashes | No | SHA-256 per-tool, merge-friendly |
| Multiple output formats | Rare | Console, JSON, Markdown, SARIF |

## Install

```bash
npm install -g @wannavf/mcp-sentinel
```

Or use zero-install:
```bash
npx @wannavf/mcp-sentinel init
```

---

## Commands

### `sentinel init`

Interactive setup wizard.

```bash
sentinel init
```

### `sentinel snapshot`

Connect to configured MCP servers and record all tool schemas.

```bash
sentinel snapshot
sentinel snapshot --server filesystem
```

### `sentinel check`

Compare live schemas against lockfile. Returns exit code 0 (clean) or 1 (drift).

```bash
sentinel check
sentinel check --fail-on MINOR
sentinel check --server github
```

### `sentinel diff`

Detailed change report. 4 output formats.

```bash
sentinel diff                            # Console (color)
sentinel diff --format json              # Machine-readable
sentinel diff --format markdown          # Markdown report for issues/PRs
sentinel diff --format sarif             # GitHub Code Scanning
```

### `sentinel update`

Accept current schemas as new baseline.

```bash
sentinel update
sentinel update --server github
```

### `sentinel watch`

Long-running daemon. Polls servers and alerts on drift.

```bash
sentinel watch
sentinel watch --interval 10
```

### `sentinel audit`

Score schema quality: completeness, type coverage, missing descriptions.

```bash
sentinel audit
sentinel audit --server filesystem
```

### `sentinel lockfile-diff`

Compare two lockfiles without connecting to live servers.

```bash
sentinel lockfile-diff --old old.json --new new.json
sentinel lockfile-diff -o old.json -n new.json --format markdown
```

### `sentinel dashboard`

Interactive terminal UI with keyboard controls.

```bash
sentinel dashboard
```

---

## Classification Rules (20 total)

### MAJOR — Breaking

| Rule | Example |
|------|---------|
| `TOOL_REMOVED` | `delete_file` no longer exists |
| `PARAM_REMOVED` | Required parameter deleted |
| `PARAM_TYPE_CHANGED` | `count: string` → `count: number` |
| `PARAM_MADE_REQUIRED` | Optional → required |
| `PARAM_CONSTRAINT_TIGHTENED` | `minimum: 0` → `minimum: 1` |
| `REQUIRED_FIELD_ADDED` | New required parameter |
| `ENUM_VALUE_REMOVED` | `format: [json, csv]` → `[json]` |
| `OUTPUT_TYPE_CHANGED` | Output type changed |
| `OUTPUT_FIELD_REMOVED` | Field removed from output |
| `TOOL_RENAMED` | Tool name changed |

### MINOR — Potentially Breaking

| Rule | Example |
|------|---------|
| `PARAM_REMOVED_OPTIONAL` | Optional parameter deleted |
| `DESCRIPTION_SEMANTICS_CHANGED` | Description meaning changed |
| `DEFAULT_VALUE_CHANGED` | Default value changed |
| `PARAM_CONSTRAINT_LOOSENED` | `minimum: 1` → `minimum: 0` |
| `ANNOTATION_CHANGED` | `readOnlyHint` changed |
| `OUTPUT_FIELD_ADDED_REQUIRED` | New required output field |

### PATCH — Safe

| Rule | Example |
|------|---------|
| `PARAM_ADDED_OPTIONAL` | New optional parameter |
| `TOOL_ADDED` | New tool added |
| `ENUM_VALUE_ADDED` | New enum value |
| `DESCRIPTION_UPDATED` | Typo fix |

---

## Lockfile Format

`sentinel-lock.json` — git-mergeable, self-contained, deterministic.

```jsonc
{
  "formatVersion": 2,
  "contentHash": "sha256:a1b2...",
  "servers": {
    "filesystem": {
      "serverInfo": { "name": "filesystem", "version": "0.6.2" },
      "snapshotAt": "2026-05-07T14:32:00Z",
      "tools": {
        "read_file": {
          "hash": "sha256:i9j0...",
          "description": "Read the complete contents of a file",
          "inputSchema": {
            "type": "object",
            "properties": { "path": { "type": "string" } },
            "required": ["path"]
          }
        }
      }
    }
  }
}
```

- **Sorted keys** at every level — no merge conflicts on unrelated changes
- **SHA-256 hashes** per tool — fast-path: skip deep diff when hash matches
- **Content hash** — one-hash comparison for dirty-checking

---

## CI Integration

### GitHub Action

```yaml
name: MCP Schema Check
on: [pull_request]
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Wannavf/mcp-sentinel@main
        with:
          fail-on: MAJOR
```

### GitHub Code Scanning (SARIF)

```yaml
- run: npx @wannavf/mcp-sentinel diff --format sarif > sentinel.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: sentinel.sarif
```

---

## Configuration

`sentinel.config.json`:

The default example watches the current folder (`.`). Replace it with another path if your MCP server should expose a different directory.

```json
{
  "compatibility": "BACKWARD",
  "failOn": "MAJOR",
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  },
  "rules": {
    "DESCRIPTION_SEMANTICS_CHANGED": "PATCH",
    "PARAM_REMOVED_OPTIONAL": "MAJOR"
  }
}
```

### Compatibility Modes

| Mode | Behavior |
|------|---------|
| `STRICT` | Any change fails |
| `BACKWARD` | Old agents must work with new schema |
| `FORWARD` | New agents must work with old schema |
| `FULL` | Both directions must be compatible |
| `NONE` | Report only, never fail |

---

## Project

```
sentinel/
├── src/
│   ├── cli/             9 commands (init, snapshot, check, diff, update, watch, audit, lockfile-diff, tui)
│   ├── core/             4 modules (types, lockfile, transport, hasher)
│   ├── diff/             3 modules (engine, rules, compatibility)
│   └── reporters/        4 modules (console, markdown, json, sarif)
├── action.yml            GitHub Action
├── sentinel.config.json  Example config
└── package.json          npm ready
```

**Dependencies:** `@modelcontextprotocol/sdk` (MCP transport), `commander` (CLI), `blessed` (TUI), `blessed-contrib` (TUI widgets), `ora` (spinners), `chalk` (colors), `fast-json-stable-stringify` (deterministic hashing).

---

## License

MIT
