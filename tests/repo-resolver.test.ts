import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fetch for registry API
const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal('fetch', mockFetch);

// Mutable mock for child_process.exec — use vi.hoisted to avoid hoisting issues
const { execMockImpl } = vi.hoisted(() => {
  const impl = {
    fn: (_cmd: string, _opts: any, cb: any) => { cb(null, '', ''); },
  };
  return { execMockImpl: impl };
});

// Mock gitnexus module
vi.mock('../src/gitnexus', () => ({
  findGitNexusRoot: vi.fn((cwd: string) => cwd),
  spawnEnv: process.env,
}));

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn((cmd: string, opts: any, cb: any) => {
    execMockImpl.fn(cmd, opts, cb);
  }),
}));

import { RepoResolver } from '../src/repo-resolver';

describe('RepoResolver', () => {
  let resolver: RepoResolver;

  const sampleRegistry = [
    { name: 'pi-plugins', path: '/workspace/bhd/pi-plugins', remoteUrl: 'https://github.com/tintinweb/pi-gitnexus.git' },
    { name: 'systemedge', path: '/workspace/bhd/systemedge', remoteUrl: 'https://github.com/org/systemedge.git' },
    { name: 'noco-mesh', path: '/workspace/bhd/noco-mesh', remoteUrl: null },
  ];

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockClear();
    execMockImpl.fn = (_cmd: string, _opts: any, cb: any) => { cb(null, '', ''); };
    resolver = new RepoResolver({ serverUrl: 'http://localhost:4747' });
  });

  afterEach(() => {
    mockFetch.mockClear();
  });

  it('resolveRepo: matches by git remote URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleRegistry,
    } as Response);

    execMockImpl.fn = (cmd: string, _opts: any, cb: any) => {
      if (cmd.includes('git remote')) {
        cb(null, 'origin\thttps://github.com/org/systemedge.git (fetch)\n', '');
      } else {
        cb(new Error('unknown command'), '', '');
      }
    };

    const result = await resolver.resolveRepo('/home/bhd/Documents/Projects/bhd/systemedge');
    expect(result).toBe('/workspace/bhd/systemedge');
  });

  it('resolveRepo: matches by basename fallback', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleRegistry,
    } as Response);

    execMockImpl.fn = (cmd: string, _opts: any, cb: any) => {
      if (cmd.includes('git remote')) {
        cb(null, 'origin\thttps://github.com/other/repo.git (fetch)\n', '');
      } else {
        cb(new Error('unknown command'), '', '');
      }
    };

    const result = await resolver.resolveRepo('/home/bhd/Documents/Projects/bhd/noco-mesh');
    expect(result).toBe('/workspace/bhd/noco-mesh');
  });

  it('resolveRepo: returns findGitNexusRoot as fallback', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleRegistry,
    } as Response);

    const result = await resolver.resolveRepo('/home/bhd/Documents/Projects/bhd/unknown-repo');
    expect(result).toBe('/home/bhd/Documents/Projects/bhd/unknown-repo');
  });

  it('resolveRepo: caches registry after first fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleRegistry,
    } as Response);

    await resolver.resolveRepo('/home/bhd/some/repo');
    await resolver.resolveRepo('/home/bhd/some/other');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshRegistry: clears cache and re-fetches', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => sampleRegistry,
    } as Response);

    await resolver.resolveRepo('/home/bhd/repo1');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await resolver.refreshRegistry();
    await resolver.resolveRepo('/home/bhd/repo2');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('getRegistry: returns cached registry', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleRegistry,
    } as Response);

    await resolver.resolveRepo('/home/bhd/repo');

    const registry = resolver.getRegistry();
    expect(registry).toEqual(sampleRegistry);
  });

  it('handles empty registry gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const result = await resolver.resolveRepo('/home/bhd/some/repo');
    expect(result).toBe('/home/bhd/some/repo');
  });

  it('handles server unreachable gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await resolver.resolveRepo('/home/bhd/some/repo');
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('multiple repos with same basename returns first match', async () => {
    const multiRegistry = [
      { name: 'app-1', path: '/workspace/team-a/app', remoteUrl: 'https://github.com/team-a/app.git' },
      { name: 'app-2', path: '/workspace/team-b/app', remoteUrl: 'https://github.com/team-b/app.git' },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => multiRegistry,
    } as Response);

    const result = await resolver.resolveRepo('/home/bhd/projects/app');
    expect(result).toBe('/workspace/team-a/app');
  });

  it('multiple repos with same basename resolved by remote URL', async () => {
    const multiRegistry = [
      { name: 'app-1', path: '/workspace/team-a/app', remoteUrl: 'https://github.com/team-a/app.git' },
      { name: 'app-2', path: '/workspace/team-b/app', remoteUrl: 'https://github.com/team-b/app.git' },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => multiRegistry,
    } as Response);

    execMockImpl.fn = (cmd: string, _opts: any, cb: any) => {
      if (cmd.includes('git remote')) {
        cb(null, 'origin\thttps://github.com/team-b/app.git (fetch)\n', '');
      } else {
        cb(new Error('unknown command'), '', '');
      }
    };

    const result = await resolver.resolveRepo('/home/bhd/projects/app');
    expect(result).toBe('/workspace/team-b/app');
  });
});
