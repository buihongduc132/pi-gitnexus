import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock, mockRemoteClient } = vi.hoisted(() => {
  const spawn = vi.fn();
  const remoteClient = {
    callTool: vi.fn(),
    stop: vi.fn(),
  };
  return { spawnMock: spawn, mockRemoteClient: remoteClient };
});

vi.mock('cross-spawn', () => ({
  default: spawnMock,
}));

vi.mock('../src/gitnexus', () => ({
  loadSavedConfig: vi.fn(() => ({})),
  validateMcpMode: vi.fn((m: unknown) => (m === 'local' || m === 'remote' || m === 'auto' ? m : 'auto')),
  DEFAULT_SERVER_URL: 'http://100.114.135.99:4747/api/mcp',
  MAX_OUTPUT_CHARS: 8 * 1024,
  spawnEnv: process.env,
  gitnexusCmd: ['gitnexus'],
}));

// Don't mock remote-mcp-client directly — it interferes with remote-mcp-client.test.ts
// Instead, mock mcp-client-stdio which is used by createClient('local')
vi.mock('../src/mcp-client-stdio', () => ({
  StdioMcpClient: vi.fn(function(this: any) {
    this.callTool = vi.fn();
    this.stop = vi.fn();
    this.probeLocalBinary = vi.fn();
  }),
}));

vi.mock('../src/mcp-client', () => ({
  McpClient: undefined,
  createMcpError: vi.fn(),
  mcpClient: { callTool: vi.fn(), stop: vi.fn() },
  StdioMcpClient: vi.fn(function(this: any) {
    this.callTool = vi.fn();
    this.stop = vi.fn();
  }),
  AutoMcpClient: vi.fn(function(this: any) {
    this.callTool = vi.fn();
    this.stop = vi.fn();
  }),
  createMcpClient: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({})),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/bhd'),
}));

vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
  homedir: () => '/home/bhd',
  basename: (p: string) => p.split('/').pop() ?? '',
  sep: '/',
}));

import { McpClientFactory } from '../src/mcp-client-factory';
import { StdioMcpClient } from '../src/mcp-client';

describe('McpClientFactory', () => {
  beforeEach(() => {
    // Reset call counts but keep implementations
    mockRemoteClient.callTool.mockClear();
    mockRemoteClient.stop.mockClear();
    delete process.env.GITNEXUS_SERVER_URL;
    delete process.env.GITNEXUS_MODE;
  });

  it('createClient with mode="local" returns StdioMcpClient', async () => {
    const client = await McpClientFactory.createClient({ mode: 'local' });
    expect(client).toBeDefined();
    expect(StdioMcpClient).toHaveBeenCalled();
  });

  it('createClient with mode="remote" returns a client', async () => {
    const client = await McpClientFactory.createClient({ mode: 'remote', serverUrl: 'http://localhost:4747/api/mcp' });
    expect(client).toBeDefined();
    expect(typeof client.callTool).toBe('function');
    expect(typeof client.stop).toBe('function');
  });

  it('config loading: defaults to auto mode and default server URL', () => {
    const config = McpClientFactory.loadConfig();
    expect(config.mode).toBe('auto');
    expect(config.serverUrl).toBe('http://100.114.135.99:4747/api/mcp');
  });

  it('config defaults: mode from env GITNEXUS_MODE', () => {
    process.env.GITNEXUS_MODE = 'remote';
    const config = McpClientFactory.loadConfig();
    expect(config.mode).toBe('remote');
    delete process.env.GITNEXUS_MODE;
  });

  it('config defaults: serverUrl from env GITNEXUS_SERVER_URL', () => {
    process.env.GITNEXUS_SERVER_URL = 'http://env-host:4747/api/mcp';
    const config = McpClientFactory.loadConfig();
    expect(config.serverUrl).toBe('http://env-host:4747/api/mcp');
    delete process.env.GITNEXUS_SERVER_URL;
  });

  it('config loading: reads from config file when it exists', async () => {
    const { existsSync, readFileSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValueOnce(true);
    vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify({ mode: 'remote', serverUrl: 'http://file-url:4747/api/mcp' }));

    const config = McpClientFactory.loadConfig();
    expect(config.mode).toBe('remote');
    expect(config.serverUrl).toBe('http://file-url:4747/api/mcp');
  });

  it('config loading: handles corrupt config file', async () => {
    const { existsSync, readFileSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValueOnce(true);
    vi.mocked(readFileSync).mockImplementationOnce(() => { throw new Error('corrupt'); });

    const config = McpClientFactory.loadConfig();
    expect(config.mode).toBe('auto');
  });

  it('createClient with mode="auto" probes local binary', async () => {
    // Set up spawn to succeed (binary available)
    const proc = new (require('events').EventEmitter)();
    proc.kill = vi.fn();
    spawnMock.mockReturnValue(proc);
    queueMicrotask(() => proc.emit('close', 0));

    const client = await McpClientFactory.createClient({ mode: 'auto' });
    expect(client).toBeDefined();
  });

  it('createClient with mode="auto" falls back to remote when binary fails', async () => {
    // Set up spawn to fail (binary not available)
    const proc = new (require('events').EventEmitter)();
    proc.kill = vi.fn();
    spawnMock.mockReturnValue(proc);
    queueMicrotask(() => proc.emit('close', 1));

    const client = await McpClientFactory.createClient({ mode: 'auto' });
    expect(client).toBeDefined();
  });
});
