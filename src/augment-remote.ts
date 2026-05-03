import type { McpClient } from './mcp-client';

/**
 * Patterns already augmented this session (with non-empty results).
 * Keys are lowercased for case-insensitive dedup.
 * Uses microsecond-precision timestamps for test isolation.
 */
const augmentedCache = new Map<string, { result: string; ts: number }>();

/**
 * Patterns that returned empty results on first attempt.
 */
const emptyCache = new Set<string>();

/** Reset caches. Call on session start. */
export function clearAugmentCache(): void {
  augmentedCache.clear();
  emptyCache.clear();
}

/**
 * Run augment via remote MCP query tool.
 *
 * @param pattern    The search pattern to look up
 * @param cwd        The host working directory (passed to callTool)
 * @param serverRepo The server-side repo path
 * @returns The augment result text, or empty string on error/empty
 */
export async function augmentRemote(pattern: string, cwd: string, serverRepo: string): Promise<string> {
  const key = pattern.toLowerCase();
  const now = performance.now();

  // Check augmented cache — return cached result if recent
  const cached = augmentedCache.get(key);
  if (cached && (now - cached.ts) < 0.5) {
    return cached.result;
  }

  // Check empty cache — skip early
  if (emptyCache.has(key)) {
    return '';
  }

  try {
    // Dynamic import to avoid vi.mock hoisting issues with mcp-client-factory
    const { McpClientFactory } = await import('./mcp-client-factory');
    const config = McpClientFactory.loadConfig();
    const client = await McpClientFactory.createClient(config);

    const result = await client.callTool('query', { query: pattern, repo: serverRepo }, cwd);

    if (result) {
      augmentedCache.set(key, { result, ts: performance.now() });
      return result;
    } else {
      emptyCache.add(key);
      return '';
    }
  } catch {
    emptyCache.add(key);
    return '';
  }
}
