// ── JSON-RPC / MCP types ──────────────────────────────────────────────────────

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id?: number;
	result?: unknown;
	error?: { code: number; message: string };
}

interface McpContent {
	type: string;
	text?: string;
	isError?: boolean;
}

interface McpToolResult {
	content: McpContent[];
	isError?: boolean;
}

// ── McpClient interface ───────────────────────────────────────────────────────

/**
 * Abstraction over MCP transport mechanisms (stdio, remote HTTP).
 * Implementations must be safe for concurrent `callTool()` invocations.
 */
export interface McpClient {
	/** Call a named MCP tool with the given arguments, scoped to `cwd`. Returns formatted text. */
	callTool(
		name: string,
		args: Record<string, unknown>,
		cwd: string,
	): Promise<string>;
	/** Terminate any open connections / processes. Idempotent. */
	stop(): void;
}

// ── Error helper ──────────────────────────────────────────────────────────────

/** Create a consistently-prefixed error from an unknown value. */
export function createMcpError(
	error: unknown,
	fallback = "GitNexus MCP request failed.",
): Error {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: fallback;
	return new Error(`[GitNexus] ${message || fallback}`);
}

// ── Re-exports (lazy — avoids circular dependency) ─────────────────────────────
export { StdioMcpClient } from "./mcp-client-stdio";

// ── AutoMcpClient ─────────────────────────────────────────────────────────────

import type { McpMode } from "./gitnexus";
import { RemoteMcpClient } from "./remote-mcp-client";

/**
 * Auto-detecting MCP client that probes the local binary on first use.
 * Falls back to remote HTTP if the local binary fails.
 * Once selected, the chosen transport is cached for the session.
 */
export class AutoMcpClient implements McpClient {
	private delegate: McpClient | null = null;
	private probePromise: Promise<McpClient> | null = null;

	/**
	 * Probe the local gitnexus binary. Returns true if it responds to --version.
	 */
	static async probeLocalBinary(): Promise<boolean> {
		const { StdioMcpClient } = await import("./mcp-client-stdio");
		return StdioMcpClient.probeLocalBinary();
	}

	/** Resolve the transport. Probes local binary once, then caches the result. */
	private async resolveClient(): Promise<McpClient> {
		if (this.delegate) return this.delegate;
		if (this.probePromise) return this.probePromise;

		this.probePromise = (async () => {
			const { McpClientFactory } = await import("./mcp-client-factory");
			const { serverUrl } = McpClientFactory.loadConfig();

			const localWorks = await AutoMcpClient.probeLocalBinary();
			const client = localWorks
				? await McpClientFactory.createClient({ mode: "local" })
				: new RemoteMcpClient({ serverUrl: serverUrl! });
			this.delegate = client;
			return client;
		})();

		return this.probePromise;
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		cwd: string,
	): Promise<string> {
		const client = await this.resolveClient();
		return client.callTool(name, args, cwd);
	}

	stop(): void {
		if (this.delegate) {
			this.delegate.stop();
			this.delegate = null;
		}
		this.probePromise = null;
	}
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an McpClient based on the configured mode.
 *
 * @param mode     - Transport mode from config.
 * @param serverUrl - Remote server URL (required for 'remote', optional for 'auto').
 */
export function createMcpClient(mode: McpMode, serverUrl: string): McpClient {
	switch (mode) {
		case "remote":
			return new RemoteMcpClient({ serverUrl });
		case "auto":
			return new AutoMcpClient();
		default:
			// Return a lazy proxy that defers StdioMcpClient instantiation.
			// This avoids circular dependency: mcp-client-stdio imports from this module,
			// so we can't eagerly import it here.
			return createLazyStdioClient();
	}
}

/**
 * Create a lazy proxy McpClient that defers StdioMcpClient instantiation
 * until the first method call. Avoids circular dependency issues.
 */
function createLazyStdioClient(): McpClient {
	let _instance: McpClient | null = null;
	let _pending: Promise<McpClient> | null = null;

	const getInstance = async (): Promise<McpClient> => {
		if (_instance) return _instance;
		if (_pending) return _pending;
		_pending = import("./mcp-client-stdio").then((mod) => {
			_instance = new mod.StdioMcpClient();
			return _instance;
		});
		return _pending;
	};

	return new Proxy({} as McpClient, {
		get(_, prop) {
			if (prop === "stop") {
				return () => {
					_instance?.stop();
				};
			}
			if (prop === "callTool") {
				return (name: string, args: Record<string, unknown>, cwd: string) =>
					getInstance().then((c) => c.callTool(name, args, cwd));
			}
			return undefined;
		},
	});
}

// ── Singleton (config-aware, lazy) ─────────────────────────────────────────────

/**
 * Singleton MCP client. Reads config on first use and selects transport:
 * - mode=remote → RemoteMcpClient
 * - mode=auto → AutoMcpClient (probe local, fallback remote)
 * - mode=local (or missing) → StdioMcpClient
 */
export const mcpClient: McpClient = new Proxy({} as McpClient, {
	get(_, prop) {
		if (prop === "stop") {
			return () => {
				_singletonInstance?.stop();
			};
		}
		if (prop === "callTool") {
			return (name: string, args: Record<string, unknown>, cwd: string) =>
				getSingletonClient().then((c) => c.callTool(name, args, cwd));
		}
		return undefined;
	},
});

let _singletonInstance: McpClient | null = null;
let _singletonPending: Promise<McpClient> | null = null;

function getSingletonClient(): Promise<McpClient> {
	if (_singletonInstance) return Promise.resolve(_singletonInstance);
	if (_singletonPending) return _singletonPending;
	_singletonPending = import("./mcp-client-factory").then((mod) => {
		const { mode, serverUrl } = mod.McpClientFactory.loadConfig();
		_singletonInstance = createMcpClient(mode, serverUrl ?? "");
		return _singletonInstance;
	});
	return _singletonPending;
}
