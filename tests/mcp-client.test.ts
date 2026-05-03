import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

// Hoisted mocks
const { spawnMock, mockRemoteClient, mockRemoteCallTool } = vi.hoisted(() => {
  const spawn = vi.fn();
  const remoteCallTool = vi.fn();
  const remoteClient = { callTool: remoteCallTool, stop: vi.fn() };
  return { spawnMock: spawn, mockRemoteClient: remoteClient, mockRemoteCallTool: remoteCallTool };
});

vi.mock('cross-spawn', () => ({
  default: spawnMock,
}));

vi.mock('../src/gitnexus', () => ({
  MAX_OUTPUT_CHARS: 8 * 1024,
  spawnEnv: process.env,
  gitnexusCmd: ['gitnexus'],
}));

vi.mock('../src/mcp-client-factory', () => ({
  McpClientFactory: {
    createClient: vi.fn().mockResolvedValue(mockRemoteClient),
    loadConfig: vi.fn().mockReturnValue({ mode: 'remote', serverUrl: 'http://localhost:4747/api/mcp' }),
  },
}));

class FakeStream extends EventEmitter {
  write = vi.fn();
  setEncoding = vi.fn();
}

describe('mcp-client', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    mockRemoteCallTool.mockReset();
  });

  describe('StdioMcpClient', () => {
    it('throws when the MCP tool response is flagged as an error', async () => {
      const stdout = new FakeStream();
      const stdin = new FakeStream();
      const proc = new EventEmitter() as EventEmitter & {
        stdout: FakeStream;
        stdin: FakeStream;
        kill: (signal?: string) => boolean;
      };
      proc.stdout = stdout;
      proc.stdin = stdin;
      proc.kill = vi.fn(() => true);

      let callId: number | undefined;
      stdin.write.mockImplementation((payload: string) => {
        const msg = JSON.parse(payload.trim());
        if (msg.method === 'initialize') {
          queueMicrotask(() => stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n'));
        } else if (msg.method === 'tools/call') {
          callId = msg.id;
          queueMicrotask(() => stdout.emit('data', JSON.stringify({
            jsonrpc: '2.0',
            id: callId,
            result: {
              isError: true,
              content: [{ type: 'text', text: 'repo selection failed' }],
            },
          }) + '\n'));
        }
        return true;
      });

      spawnMock.mockReturnValue(proc);

      const { mcpClient } = await import('../src/mcp-client');

      await expect(mcpClient.callTool('query', { query: 'auth' }, '/repo')).rejects.toThrow('[GitNexus] repo selection failed');
      mcpClient.stop();
    });

    it('stop() is idempotent', async () => {
      const { mcpClient } = await import('../src/mcp-client');
      expect(() => mcpClient.stop()).not.toThrow();
      expect(() => mcpClient.stop()).not.toThrow();
    });
  });

  describe('createMcpError', () => {
    it('wraps Error instances with [GitNexus] prefix', async () => {
      const { createMcpError } = await import('../src/mcp-client');
      const err = createMcpError(new Error('test'));
      expect(err.message).toBe('[GitNexus] test');
    });

    it('wraps string errors', async () => {
      const { createMcpError } = await import('../src/mcp-client');
      const err = createMcpError('string error');
      expect(err.message).toBe('[GitNexus] string error');
    });

    it('uses fallback for non-error, non-string values', async () => {
      const { createMcpError } = await import('../src/mcp-client');
      const err = createMcpError(42, 'default msg');
      expect(err.message).toBe('[GitNexus] default msg');
    });

    it('uses fallback when error message is empty', async () => {
      const { createMcpError } = await import('../src/mcp-client');
      const err = createMcpError(new Error(''), 'fallback');
      expect(err.message).toBe('[GitNexus] fallback');
    });
  });

  describe('createMcpClient factory', () => {
    it('returns an McpClient for mode=local', async () => {
      const { createMcpClient } = await import('../src/mcp-client');
      const client = createMcpClient('local', 'http://localhost:4747');
      expect(client).toBeDefined();
      expect(typeof client.callTool).toBe('function');
      expect(typeof client.stop).toBe('function');
      client.stop();
    });

    it('returns a RemoteMcpClient for mode=remote', async () => {
      const { createMcpClient } = await import('../src/mcp-client');
      const client = createMcpClient('remote', 'http://localhost:4747/api/mcp');
      expect(client).toBeDefined();
      expect(typeof client.callTool).toBe('function');
      client.stop();
    });

    it('returns an AutoMcpClient for mode=auto', async () => {
      const { createMcpClient } = await import('../src/mcp-client');
      const client = createMcpClient('auto', 'http://localhost:4747/api/mcp');
      expect(client).toBeDefined();
      expect(typeof client.callTool).toBe('function');
      client.stop();
    });
  });
});
