# Design: Remote MCP Backend for pi-gitnexus

## Problem

The upstream `tintinweb/pi-gitnexus` extension uses a local `gitnexus` CLI binary for:

1. **Auto-augment hooks** — spawn `gitnexus augment <pattern>` via stdio
2. **Registered tools** — spawn `gitnexus mcp` via stdio JSON-RPC

On this machine:

- The npm `gitnexus@1.6.3` binary is a stub (`exit 0`)
- Even with a working binary, LadybugDB segfaults (Node 22 Docker vs Node 24 host ABI mismatch)
- A centralized GitNexus server runs on bhd-main2 (`http://100.114.135.99:4747`) and writes `.gitnexus/` indexes locally via shared mount
- The server exposes MCP tools via StreamableHTTP at `/api/mcp`

## Approach: Dual Transport with Auto-Detection

Add a `RemoteMcpClient` alongside the existing `StdioMcpClient`. A factory selects based on config:

```
mode=auto    → probe local binary → works? use stdio : use remote
mode=local   → stdio only (existing behavior)
mode=remote  → StreamableHTTP to server
```

## Architecture

### Config (~/.pi/pi-gitnexus.json)

```jsonc
{
  "mode": "auto", // "auto" | "local" | "remote"
  "serverUrl": "http://100.114.135.99:4747/api/mcp",
  // existing fields...
  "cmd": "", // local command override
  "autoAugment": true,
  "augmentTimeout": 8, // seconds
}
```

### MCP Client Interface

```typescript
interface McpClient {
  callTool(
    name: string,
    args: Record<string, unknown>,
    cwd: string,
  ): Promise<string>;
  stop(): void;
}
```

### Components

| Component          | File                             | Purpose                                             |
| ------------------ | -------------------------------- | --------------------------------------------------- |
| `McpClientFactory` | `src/mcp-client.ts` (modify)     | Extract interface, add factory, keep StdioMcpClient |
| `RemoteMcpClient`  | `src/remote-mcp-client.ts` (new) | StreamableHTTP transport to server                  |
| `RepoResolver`     | `src/repo-resolver.ts` (new)     | Map host cwd → server repo name/path                |
| `AutoMcpClient`    | `src/mcp-client.ts` (new)        | Probe → select → cache transport                    |
| Augment hook       | `src/index.ts` (modify)          | Use remote client for augment via `query` tool      |

### Repo Resolution Strategy

The server knows repos by container paths (`/workspace/bhd/pi-plugins`) or registered names.
The host cwd is `/home/bhd/Documents/Projects/bhd/pi-plugins`.

Resolution:

1. Fetch server registry from `GET /api/repos` (or `list_repos` MCP tool)
2. Cache locally (in-memory, refreshed per session)
3. Match host cwd to server repo by:
   a. Git remote URL (most reliable)
   b. Basename of cwd matches basename of server path
   c. Fallback: pass `findGitNexusRoot(cwd)` as repo path

### Augment via Query

The server doesn't expose `augment` as an MCP tool. In remote mode:

- Auto-augment hook calls `callTool('query', { query: pattern, repo, limit: 3 })`
- This returns relevant graph context — serves the same purpose as augment
- The agent also has native `gitnexus_query` tool, so this is consistent

### Graceful Degradation

- Server unreachable → augment hook returns empty (same as current broken state, but explicit)
- No retry storms — single attempt per hook fire
- Log warning via `ctx.ui.notify()` on first failure per session

## Test Plan

### P0 — RemoteMcpClient (src/remote-mcp-client.ts)

- StreamableHTTP POST request/response cycle
- JSON-RPC 2.0 message format
- MCP initialize handshake
- Error handling: network failure, timeout, MCP error response
- Response parsing: text content extraction, truncation
- Connection reuse across calls

### P0 — RepoResolver (src/repo-resolver.ts)

- Parse registry response (array of {name, path, remoteUrl})
- Match host cwd by git remote URL
- Match host cwd by basename
- Fallback to findGitNexusRoot
- Cache behavior (store, invalidate, refresh)

### P0 — McpClientFactory (src/mcp-client.ts)

- Mode selection: local, remote, auto
- Auto probe: binary works → stdio, else → remote
- Config loading with defaults

### P1 — Augment hook integration (src/index.ts)

- Remote augment via query tool
- Fallback on error
- Pattern extraction unchanged

### P1 — Config (src/gitnexus.ts)

- serverUrl loading
- mode loading with validation
- Environment variable overrides

### Coverage Target: 60%+

## Files to Create/Modify

```
src/
  remote-mcp-client.ts  ← NEW
  repo-resolver.ts      ← NEW
  mcp-client.ts         ← MODIFY (extract interface, add factory + AutoMcpClient)
  gitnexus.ts           ← MODIFY (add mode/serverUrl to GitNexusConfig)
  index.ts              ← MODIFY (auto-augment uses remote when available)
tests/
  remote-mcp-client.test.ts  ← NEW
  repo-resolver.test.ts      ← NEW
  augment-remote.test.ts     ← NEW
  mcp-client.test.ts         ← MODIFY (add factory tests)
```

## Constraints

- NO changes to the GitNexus server — it's a read-only dependency
- NO new npm dependencies for HTTP (use native `fetch`)
- Existing tests MUST continue to pass (backward compat)
- Config is additive — existing fields keep their meaning
