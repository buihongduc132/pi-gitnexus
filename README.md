# pi-gitnexus

[![npm](https://img.shields.io/npm/v/pi-gitnexus)](https://www.npmjs.com/package/pi-gitnexus)
[![license](https://img.shields.io/npm/l/pi-gitnexus)](https://spdx.org/licenses/MIT)

[GitNexus](https://github.com/abhigyanpatwari/GitNexus) knowledge graph integration for [pi](https://github.com/mariozechner/pi). Enriches every search, file read, and symbol lookup with call chains, callers/callees, and execution flows — automatically.

<img height="298" alt="pi-gitnexus screenshot" src="https://github.com/buihongduc132/pi-gitnexus/raw/master/media/screenshot.png" />

## Features

- **Automatic graph enrichment** — appends call-chain context to `read`, `grep`, `find`, `bash`, and `read_many` results
- **Symbol lookups** — callers, callees, execution flows, and impact analysis via MCP tools
- **Three transport modes** — local binary (stdio), remote HTTP, or auto-detect
- **MCP server** — exposes `gitnexus_query`, `gitnexus_context`, `gitnexus_impact`, `gitnexus_detect_changes`, and more
- **Search augmentation** — filenames in grep/find results are enriched with per-file graph context in parallel
- **Configurable** — `pi-gitnexus.json` for mode, server URL, and per-repo settings

## Installation

### For humans (npm)

```bash
npm install pi-gitnexus
```

### For AI agents (pi settings.json)

Add to your pi `settings.json` packages array:

```json
{
  "packages": ["pi-gitnexus"]
}
```

### Git-sourced

In `settings.json`, reference the repo directly:

```json
{
  "packages": ["github:buihongduc132/pi-gitnexus"]
}
```

Or clone into `profile/git/github.com/buihongduc132/`:

```bash
git clone https://github.com/buihongduc132/pi-gitnexus.git profile/git/github.com/buihongduc132/pi-gitnexus
```

## Usage

Once installed, pi-gitnexus registers hooks and MCP tools automatically. No configuration needed for remote mode (default).

### MCP Tools

| Tool | Description |
|------|-------------|
| `gitnexus_query` | Query execution flows by concept |
| `gitnexus_context` | Get full symbol context (callers, callees, flows) |
| `gitnexus_impact` | Blast radius / impact analysis for a symbol |
| `gitnexus_detect_changes` | Detect affected symbols from recent code changes |
| `gitnexus_rename` | Safe rename across the call graph |
| `gitnexus_cypher` | Raw Cypher queries against the graph |

### Search Enrichment

When the agent runs `grep`, `find`, `bash`, `read`, or `read_many`, pi-gitnexus appends graph context inline:

```
Agent reads auth/session.ts
  → file content returned normally
  → [GitNexus] appended: callers of the module, imports, related tests

Agent runs grep("validateUser")
  → grep results returned normally
  → [GitNexus] appended: Called by: login, signup / Calls: checkPermissions, getUser
```

## Configuration

Config file: `~/.pi/pi-gitnexus.json`

```json
{
  "mode": "remote",
  "serverUrl": "http://100.114.135.99:4747/api/mcp"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `mode` | `"auto"` | Transport: `"local"` (stdio), `"remote"` (HTTP), or `"auto"` (probe local, fallback remote) |
| `serverUrl` | `"http://100.114.135.99:4747/api/mcp"` | Remote GitNexus server URL |

Environment overrides:

| Variable | Description |
|----------|-------------|
| `GITNEXUS_MODE` | Override mode (`local`, `remote`, `auto`) |
| `GITNEXUS_SERVER_URL` | Override remote server URL |

## License

MIT

## Fork Attribution

This package is a fork of [tintinweb/pi-gitnexus](https://github.com/tintinweb/pi-gitnexus), originally licensed under MIT.

Repository: [buihongduc132/pi-gitnexus](https://github.com/buihongduc132/pi-gitnexus)
