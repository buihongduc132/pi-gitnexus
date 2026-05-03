import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCallTool, mockStop } = vi.hoisted(() => ({
  mockCallTool: vi.fn(),
  mockStop: vi.fn(),
}));

const mockRemoteClient = { callTool: mockCallTool, stop: mockStop };

vi.mock('../src/mcp-client-factory', () => ({
  McpClientFactory: {
    createClient: vi.fn().mockResolvedValue(mockRemoteClient),
    loadConfig: vi.fn().mockReturnValue({ mode: 'remote', serverUrl: 'http://localhost:4747/api/mcp' }),
  },
}));

vi.mock('../src/gitnexus', () => ({
  findGitNexusIndex: vi.fn(() => true),
  findGitNexusRoot: vi.fn((cwd: string) => cwd),
  MAX_OUTPUT_CHARS: 8 * 1024,
  spawnEnv: process.env,
}));

import { augmentRemote, clearAugmentCache } from '../src/augment-remote';

describe('augment-remote integration', () => {
  beforeEach(() => {
    clearAugmentCache();
    mockCallTool.mockReset();
    mockStop.mockReset();
  });

  it('remote mode: augment calls callTool("query", {query: pattern, repo})', async () => {
    mockCallTool.mockResolvedValueOnce('[GitNexus]\nsome context here');

    const result = await augmentRemote('myFunction', '/home/bhd/repo', '/workspace/bhd/repo');

    expect(mockCallTool).toHaveBeenCalledWith(
      'query',
      expect.objectContaining({
        query: 'myFunction',
        repo: '/workspace/bhd/repo',
      }),
      '/home/bhd/repo',
    );
    expect(result).toContain('some context here');
  });

  it('remote mode: returns "[GitNexus]" prefixed result', async () => {
    mockCallTool.mockResolvedValueOnce('[GitNexus]\nresult-data');

    const result = await augmentRemote('pattern', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(result).toBe('[GitNexus]\nresult-data');
  });

  it('remote mode: returns empty string on error (graceful degradation)', async () => {
    mockCallTool.mockRejectedValueOnce(new Error('server unreachable'));

    const result = await augmentRemote('pattern', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(result).toBe('');
  });

  it('remote mode: caches augmented results (augmentedCache)', async () => {
    mockCallTool.mockResolvedValue('[GitNexus]\ncontext-data');

    const result1 = await augmentRemote('funcA', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(result1).toContain('context-data');

    const result2 = await augmentRemote('funcA', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(result2).toContain('context-data');

    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });

  it('remote mode: caches empty results (emptyCache)', async () => {
    mockCallTool.mockResolvedValueOnce('');

    const result1 = await augmentRemote('noMatch', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(result1).toBe('');

    const result2 = await augmentRemote('noMatch', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(result2).toBe('');

    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });

  it('remote mode: case-insensitive cache keys', async () => {
    mockCallTool.mockResolvedValue('[GitNexus]\ncase-test');

    const result1 = await augmentRemote('MyFunction', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(result1).toContain('case-test');

    const result2 = await augmentRemote('myfunction', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(result2).toContain('case-test');

    expect(mockCallTool).toHaveBeenCalledTimes(1);
  });

  it('remote mode: clearAugmentCache clears both caches', async () => {
    mockCallTool.mockResolvedValueOnce('[GitNexus]\ntemp');

    await augmentRemote('tempPattern', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(mockCallTool).toHaveBeenCalledTimes(1);

    clearAugmentCache();

    // After clearing, should call tool again
    mockCallTool.mockResolvedValueOnce('[GitNexus]\nrefreshed');
    const result = await augmentRemote('tempPattern', '/home/bhd/repo', '/workspace/bhd/repo');
    expect(result).toContain('refreshed');
    expect(mockCallTool).toHaveBeenCalledTimes(2);
  });
});
