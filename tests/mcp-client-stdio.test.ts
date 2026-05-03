import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();

vi.mock('cross-spawn', () => ({
  default: spawnMock,
}));

vi.mock('../src/gitnexus', () => ({
  MAX_OUTPUT_CHARS: 8 * 1024,
  spawnEnv: process.env,
  gitnexusCmd: ['gitnexus'],
}));

class FakeStream extends EventEmitter {
  write = vi.fn();
  setEncoding = vi.fn();
}

/**
 * Helper to create a fake gitnexus mcp process that handles initialize + tools/call.
 */
function createFakeProc(options: {
  toolResults?: Record<string, string>;
  errorOnTool?: string;
  delay?: number;
}) {
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

  const pendingCalls = new Map<number, string>();

  stdin.write.mockImplementation((payload: string) => {
    const msg = JSON.parse(payload.trim());

    if (msg.method === 'initialize') {
      const respond = () => {
        stdout.emit('data', JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { capabilities: {} },
        }) + '\n');
      };
      if (options.delay) setTimeout(respond, options.delay);
      else queueMicrotask(respond);
    } else if (msg.method === 'tools/call') {
      const toolName = msg.params.name;
      pendingCalls.set(msg.id, toolName);

      const respond = () => {
        if (options.errorOnTool === toolName) {
          stdout.emit('data', JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              isError: true,
              content: [{ type: 'text', text: `Error: ${toolName} failed` }],
            },
          }) + '\n');
        } else {
          const text = options?.toolResults?.[toolName] ?? `result for ${toolName}`;
          stdout.emit('data', JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text }],
            },
          }) + '\n');
        }
      };
      if (options.delay) setTimeout(respond, options.delay);
      else queueMicrotask(respond);
    }
    return true;
  });

  return { proc, pendingCalls };
}

describe('StdioMcpClient', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('handles concurrent callTool invocations', async () => {
    const { proc } = createFakeProc({
      toolResults: {
        query: 'query-result',
        context: 'context-result',
      },
    });
    spawnMock.mockReturnValue(proc);

    const { StdioMcpClient } = await import('../src/mcp-client-stdio');
    const client = new StdioMcpClient();

    // Fire two calls concurrently
    const [result1, result2] = await Promise.all([
      client.callTool('query', { query: 'test' }, '/repo'),
      client.callTool('context', { name: 'foo' }, '/repo'),
    ]);

    expect(result1).toContain('query-result');
    expect(result2).toContain('context-result');
    client.stop();
  });

  it('reconnects after stop()', async () => {
    const { proc: proc1 } = createFakeProc({ toolResults: { query: 'first' } });
    const { proc: proc2 } = createFakeProc({ toolResults: { query: 'second' } });

    spawnMock.mockReturnValueOnce(proc1);
    spawnMock.mockReturnValueOnce(proc2);

    const { StdioMcpClient } = await import('../src/mcp-client-stdio');
    const client = new StdioMcpClient();

    // First call — uses first process
    const result1 = await client.callTool('query', { query: 'test' }, '/repo');
    expect(result1).toContain('first');
    expect(spawnMock).toHaveBeenCalledTimes(1);

    // Stop the client
    client.stop();
    expect(proc1.kill).toHaveBeenCalledWith('SIGTERM');

    // Second call — should spawn a new process
    const result2 = await client.callTool('query', { query: 'test' }, '/repo');
    expect(result2).toContain('second');
    expect(spawnMock).toHaveBeenCalledTimes(2);

    client.stop();
  });

  it('rejects pending calls when process exits', async () => {
    const { proc } = createFakeProc({ delay: 1000 }); // Long delay
    spawnMock.mockReturnValue(proc);

    const { StdioMcpClient } = await import('../src/mcp-client-stdio');
    const client = new StdioMcpClient();

    // Start initialization (will be pending due to delay)
    const callPromise = client.callTool('query', { query: 'test' }, '/repo');

    // Immediately kill the process
    setTimeout(() => {
      proc.emit('close');
    }, 10);

    await expect(callPromise).rejects.toThrow();
    client.stop();
  });

  it('throws when spawn fails', async () => {
    spawnMock.mockImplementation(() => {
      const emitter = new EventEmitter();
      queueMicrotask(() => emitter.emit('error', new Error('spawn ENOENT')));
      return emitter;
    });

    const { StdioMcpClient } = await import('../src/mcp-client-stdio');
    const client = new StdioMcpClient();

    await expect(client.callTool('query', {}, '/repo')).rejects.toThrow();
    client.stop();
  });

  it('probeLocalBinary returns true for successful --version', async () => {
    const { StdioMcpClient } = await import('../src/mcp-client-stdio');

    const proc = new EventEmitter() as EventEmitter & { kill: () => void };
    proc.kill = vi.fn();
    spawnMock.mockReturnValue(proc);

    // Simulate successful --version
    const promise = StdioMcpClient.probeLocalBinary();
    queueMicrotask(() => proc.emit('close', 0));

    const result = await promise;
    expect(result).toBe(true);
  });

  it('probeLocalBinary returns false for failed --version', async () => {
    const { StdioMcpClient } = await import('../src/mcp-client-stdio');

    const proc = new EventEmitter() as EventEmitter & { kill: () => void };
    proc.kill = vi.fn();
    spawnMock.mockReturnValue(proc);

    const promise = StdioMcpClient.probeLocalBinary();
    queueMicrotask(() => proc.emit('close', 1));

    const result = await promise;
    expect(result).toBe(false);
  });

  it('probeLocalBinary returns false on spawn error', async () => {
    const { StdioMcpClient } = await import('../src/mcp-client-stdio');

    const proc = new EventEmitter() as EventEmitter & { kill: () => void };
    proc.kill = vi.fn();
    spawnMock.mockReturnValue(proc);

    const promise = StdioMcpClient.probeLocalBinary();
    queueMicrotask(() => proc.emit('error', new Error('not found')));

    const result = await promise;
    expect(result).toBe(false);
  });
});
