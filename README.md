# MCP Sentinel

Schema drift detection for MCP servers. Sentinel snapshots your MCP tool schemas into a lockfile, then tells you when a server changes a tool in a way that may break agents.

[![npm version](https://img.shields.io/npm/v/@wannavf/mcp-sentinel)](https://www.npmjs.com/package/@wannavf/mcp-sentinel)
[![npm downloads](https://img.shields.io/npm/dm/@wannavf/mcp-sentinel)](https://www.npmjs.com/package/@wannavf/mcp-sentinel)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Quick Start

```bash
npx -y @wannavf/mcp-sentinel init
npx -y @wannavf/mcp-sentinel discover --write
npx -y @wannavf/mcp-sentinel doctor
npx -y @wannavf/mcp-sentinel snapshot
npx -y @wannavf/mcp-sentinel check
npx -y @wannavf/mcp-sentinel diff
```

Sentinel creates `sentinel-lock.json` for your MCP server tool schemas. When a tool changes later, `sentinel check` exits non-zero for CI and `sentinel diff` shows what changed.

Already have MCP servers configured in Claude, Cursor, Windsurf, VS Code, or local MCP config files?

```bash
npx -y @wannavf/mcp-sentinel discover --write
```

Discovery shows candidate servers and lets you choose which ones to add to `sentinel.config.json`.

## Why

MCP servers expose tools, but the protocol does not give every tool schema its own version. A server can change a parameter from optional to required, remove an enum value, or tighten a constraint. Your agent may only discover that break at runtime.

Sentinel gives you:

- A deterministic lockfile for MCP tool schemas
- MAJOR, MINOR, and PATCH schema drift classification
- Console, JSON, Markdown, and SARIF reports
- GitHub Action support for CI
- Config discovery for common MCP clients and project files
- Stdio, Streamable HTTP, and SSE transport support
- A terminal dashboard for local inspection

## Install

```bash
npm install -g @wannavf/mcp-sentinel
```

Or use it without installing:

```bash
npx -y @wannavf/mcp-sentinel --help
```

## Commands

### `sentinel init`

Create `sentinel.config.json` and an empty `sentinel-lock.json`.

```bash
sentinel init
```

The default example uses the official filesystem MCP server and watches the current directory (`.`).

### `sentinel discover`

Find MCP server configs on your machine and optionally import them.

```bash
sentinel discover
sentinel discover --write
sentinel discover --json
```

Discovery scans common MCP config locations plus MCP-shaped JSON files in the current project. If a server is not stored in a config file, add it manually.

### `sentinel doctor`

Validate config, server entries, and lockfile readiness.

```bash
sentinel doctor
sentinel doctor --config sentinel.config.json --lockfile sentinel-lock.json
```

### `sentinel snapshot`

Connect to configured MCP servers and record current tool schemas.

```bash
sentinel snapshot
sentinel snapshot --server filesystem
```

### `sentinel check`

Compare live tool schemas against the lockfile. Exit code is `0` when clean and non-zero when drift meets the configured failure severity.

```bash
sentinel check
sentinel check --fail-on MINOR
sentinel check --server github
```

### `sentinel diff`

Show detailed schema changes.

```bash
sentinel diff
sentinel diff --format json
sentinel diff --format markdown
sentinel diff --format sarif
```

### `sentinel update`

Accept the current live schemas as the new baseline.

```bash
sentinel update
sentinel update --server filesystem
```

### `sentinel watch`

Poll servers and report schema drift.

```bash
sentinel watch
sentinel watch --interval 10
```

### `sentinel audit`

Score schema quality, including missing descriptions and weak type coverage.

```bash
sentinel audit
sentinel audit --server filesystem
```

### `sentinel lockfile-diff`

Compare two lockfiles without connecting to live servers.

```bash
sentinel lockfile-diff --old sentinel-lock.old.json --new sentinel-lock.json
sentinel lockfile-diff -o old.json -n new.json --format markdown
```

### `sentinel dashboard`

Open the interactive terminal dashboard.

```bash
sentinel dashboard
sentinel db
```

Keys: `s` snapshot selected, `a` snapshot all, `c` check selected, `C` check all, `d` print recent diff, `/` filter activity, `space` pause activity, `q` quit.

## Configuration

`sentinel.config.json`:

```json
{
  "compatibility": "BACKWARD",
  "failOn": "MAJOR",
  "servers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  },
  "rules": {
    "DESCRIPTION_SEMANTICS_CHANGED": "PATCH"
  }
}
```

Each `servers` entry is one MCP server Sentinel can connect to.

### Stdio Servers

```json
{
  "servers": {
    "my-server": {
      "transport": "stdio",
      "command": "node",
      "args": ["C:\\path\\to\\my-mcp-server.js"]
    }
  }
}
```

### Streamable HTTP Servers

```json
{
  "servers": {
    "remote": {
      "transport": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### SSE Servers

```json
{
  "servers": {
    "legacy-remote": {
      "transport": "sse",
      "url": "http://localhost:3000/sse"
    }
  }
}
```

After adding servers:

```bash
sentinel doctor
sentinel snapshot
sentinel check
```

## Classification Rules

MAJOR examples:

- Tool removed
- Required parameter removed
- Parameter type changed
- Optional parameter made required
- Constraint tightened, such as `minimum: 0` to `minimum: 1`
- Enum value removed
- Output field removed

MINOR examples:

- Optional parameter removed
- Default value changed
- Annotation changed
- Output field added as required

PATCH examples:

- Optional parameter added
- Tool added
- Enum value added
- Description updated

## Lockfile

`sentinel-lock.json` is deterministic and git-friendly:

```json
{
  "formatVersion": 2,
  "generatedAt": "2026-05-08T20:00:00.000Z",
  "generatedBy": "@wannavf/mcp-sentinel@1.0.0",
  "contentHash": "sha256:...",
  "servers": {
    "filesystem": {
      "transport": "stdio",
      "protocolVersion": "0.6.2",
      "serverInfo": {
        "name": "filesystem",
        "version": "0.6.2"
      },
      "snapshotAt": "2026-05-08T20:00:00.000Z",
      "schemaHash": "",
      "tools": {
        "read_file": {
          "hash": "sha256:...",
          "description": "Read the complete contents of a file",
          "inputSchema": {
            "type": "object",
            "properties": {
              "path": { "type": "string" }
            },
            "required": ["path"]
          },
          "outputSchema": null,
          "annotations": {}
        }
      }
    }
  }
}
```

## CI

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

### SARIF

```yaml
- run: npx -y @wannavf/mcp-sentinel diff --format sarif > sentinel.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: sentinel.sarif
```

## Project

```text
sentinel/
  src/
    cli/        11 commands
    core/       lockfile, transport, hashing, types
    diff/       schema diff engine and rules
    reporters/  console, JSON, Markdown, SARIF
    test/       node:test coverage
  action.yml
  sentinel.config.json
  package.json
```

## Status

v1.0.0 is focused on practical schema drift detection. Formal compatibility proofs with generated counterexamples and richer PR comment automation are planned future work.

## License

MIT
