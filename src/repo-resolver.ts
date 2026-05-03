import { exec } from 'child_process';
import { basename } from 'path';
import { findGitNexusRoot } from './gitnexus';

export interface RepoEntry {
  name: string;
  path: string;
  remoteUrl?: string | null;
}

export interface RepoResolverConfig {
  serverUrl: string;
}

/**
 * RepoResolver — maps a host cwd to a server-side repo path.
 *
 * Strategy:
 *  1. Fetch registry from GET <serverUrl>/api/repos
 *  2. Match by git remote URL (most reliable)
 *  3. Match by basename of cwd vs basename of server path
 *  4. Fallback: return findGitNexusRoot(cwd)
 *
 * Uses instance-level cache so separate resolver instances don't share state.
 */
export class RepoResolver {
  private serverUrl: string;
  private registry: RepoEntry[] = [];
  private registryFetched = false;
  private resolutionCache = new Map<string, string | null>();

  constructor(config: RepoResolverConfig) {
    this.serverUrl = config.serverUrl.replace(/\/+$/, '');
  }

  /**
   * Fetch the repo registry from the server.
   * Only fetches once per instance; subsequent calls return cached data.
   */
  private async fetchRegistry(): Promise<RepoEntry[]> {
    if (this.registryFetched) return this.registry;

    try {
      const res = await fetch(`${this.serverUrl}/api/repos`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this.registry = [];
        this.registryFetched = true;
        return this.registry;
      }

      const data = (await res.json()) as RepoEntry[];
      this.registry = Array.isArray(data) ? data : [];
      this.registryFetched = true;
      return this.registry;
    } catch {
      this.registry = [];
      this.registryFetched = true;
      return this.registry;
    }
  }

  /** Clear cached registry and resolution cache. Re-fetches on next resolveRepo. */
  async refreshRegistry(): Promise<void> {
    this.registry = [];
    this.registryFetched = false;
    this.resolutionCache.clear();
    await this.fetchRegistry();
  }

  /** Return the currently cached registry entries. */
  getRegistry(): RepoEntry[] {
    return this.registry;
  }

  /**
   * Resolve a host cwd to a server-side repo path (string).
   * Uses instance-level resolution cache.
   */
  async resolveRepo(cwd: string): Promise<string | null> {
    if (this.resolutionCache.has(cwd)) {
      return this.resolutionCache.get(cwd)!;
    }

    // Ensure registry is loaded
    await this.fetchRegistry();

    const result = await this.doResolve(cwd);
    this.resolutionCache.set(cwd, result);
    return result;
  }

  private async doResolve(cwd: string): Promise<string | null> {
    const hostBasename = basename(cwd);

    // Try to get git remote URL from host cwd
    const hostRemoteUrl = await this.getGitRemoteUrl(cwd);

    // Strategy 1: match by git remote URL
    if (hostRemoteUrl) {
      const match = this.registry.find(
        (r) => r.remoteUrl && normalizeGitUrl(r.remoteUrl) === normalizeGitUrl(hostRemoteUrl),
      );
      if (match) return match.path;
    }

    // Strategy 2: match by basename
    const basenameMatch = this.registry.find(
      (r) => basename(r.path) === hostBasename || r.name === hostBasename,
    );
    if (basenameMatch) return basenameMatch.path;

    // Strategy 3: fallback — findGitNexusRoot
    return findGitNexusRoot(cwd);
  }

  private getGitRemoteUrl(cwd: string): Promise<string | null> {
    return new Promise((resolve_) => {
      exec('git remote -v', { cwd, timeout: 5000 }, (err, stdout) => {
        if (err) { resolve_(null); return; }
        // Parse "origin\t<url> (fetch)" format
        const match = stdout?.match(/\S+\s+(\S+)\s+\(fetch\)/);
        resolve_(match ? match[1] : null);
      });
    });
  }
}

/**
 * Normalize a git remote URL for comparison.
 * Strips trailing .git, protocol prefixes, and user@host: prefixes.
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim();
  if (normalized.endsWith('.git')) normalized = normalized.slice(0, -4);
  if (normalized.includes(':') && !normalized.startsWith('http')) {
    normalized = normalized.split(':').pop() ?? normalized;
  }
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^[^@]+@/, '');
  normalized = normalized.replace(/\\/g, '/');
  return normalized;
}
