import spawn from 'cross-spawn';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { gitnexusCmd, spawnEnv, validateMcpMode } from './gitnexus';
import type { McpClient } from './mcp-client';

export interface McpClientFactoryConfig {
  mode?: 'auto' | 'local' | 'remote';
  serverUrl?: string;
}

/** Default remote MCP server URL. */
const DEFAULT_SERVER_URL = 'http://100.114.135.99:4747/api/mcp';

const CONFIG_PATH = `${homedir()}/.pi/pi-gitnexus.json`;

export class McpClientFactory {
  /**
   * Create an MCP client based on the given configuration.
   * For mode='auto', this is async (probes local binary first).
   */
  static async createClient(config: McpClientFactoryConfig): Promise<McpClient> {
    const mode = config.mode ?? 'auto';
    const serverUrl = config.serverUrl || DEFAULT_SERVER_URL;

    if (mode === 'local') {
      const mod = await import('./mcp-client');
      return construct(mod.StdioMcpClient as any) as McpClient;
    }

    if (mode === 'remote') {
      const mod = await import('./remote-mcp-client');
      return construct(mod.RemoteMcpClient as any, { serverUrl }) as McpClient;
    }

    // mode === 'auto': probe local binary first
    const localWorks = await probeLocalBinary();
    if (localWorks) {
      const mod = await import('./mcp-client');
      return construct(mod.StdioMcpClient as any) as McpClient;
    }

    const mod = await import('./remote-mcp-client');
    return construct(mod.RemoteMcpClient as any, { serverUrl }) as McpClient;
  }

  /**
   * Load config from ~/.pi/pi-gitnexus.json with env var overrides.
   */
  static loadConfig(): { mode: 'auto' | 'local' | 'remote'; serverUrl?: string } {
    let raw: Record<string, unknown> = {};
    try {
      if (existsSync(CONFIG_PATH)) {
        raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
      }
    } catch {
      // ignore read errors
    }

    const envMode = process.env.GITNEXUS_MODE ? validateMcpMode(process.env.GITNEXUS_MODE) : undefined;
    const envUrl = process.env.GITNEXUS_SERVER_URL || undefined;

    return {
      mode: envMode ?? validateMcpMode(raw.mode),
      serverUrl: envUrl ?? (typeof raw.serverUrl === 'string' && raw.serverUrl.trim() ? raw.serverUrl.trim() : DEFAULT_SERVER_URL),
    };
  }
}

/**
 * Construct an instance from a class or mock function.
 * Works with both real ES classes and vi.fn() mocks.
 */
function construct(Ctor: any, ...args: any[]): any {
  // For vi.fn() mocks, calling without new returns the mock value.
  // For real classes, we need new. Try both.
  try {
    return new Ctor(...args);
  } catch {
    return Ctor(...args);
  }
}

function probeLocalBinary(): Promise<boolean> {
  return new Promise((resolve_) => {
    const [bin, ...baseArgs] = gitnexusCmd;
    const proc = spawn(bin, [...baseArgs, '--version'], {
      stdio: 'ignore',
      env: spawnEnv,
    });
    proc.on('close', (code: number | null) => resolve_(code === 0));
    proc.on('error', () => resolve_(false));
  });
}
