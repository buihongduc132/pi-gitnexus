// @ts-nocheck
// 
// 
import { MAX_OUTPUT_CHARS } from "./gitnexus";
import type { McpClient } from "./mcp-client";

const PREFIX = "[GitNexus]\n";

export interface RemoteMcpClientConfig {
	serverUrl: string;
	timeout?: number;
}

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

/** Default timeout for a single MCP request (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * RemoteMcpClient — StreamableHTTP transport to a GitNexus MCP server.
 *
 * Uses native fetch() for all communication. Completes the MCP initialize
 * handshake on the first callTool() invocation and reuses the session.
 */
export class RemoteMcpClient implements McpClient {
	private serverUrl: string;
	private initialized = false;
	private stopped = false;
	private timeoutMs: number;
	private initPromise: Promise<void> | null = null;
	private sessionId: string | null = null;
	private nextId = 1;

	/**
	 * @param configOrUrl - Either a config object `{ serverUrl, timeout? }` or a plain URL string.
	 */
	constructor(configOrUrl: RemoteMcpClientConfig | string) {
		if (typeof configOrUrl === "string") {
			this.serverUrl = configOrUrl.replace(/\/+$/, "");
			this.timeoutMs = DEFAULT_TIMEOUT_MS;
		} else {
			this.serverUrl = (configOrUrl.serverUrl ?? "").replace(/\/+$/, "");
			this.timeoutMs = configOrUrl.timeout ?? DEFAULT_TIMEOUT_MS;
		}
	}

	/** Returns the configured server URL. */
	getServerUrl(): string {
		return this.serverUrl;
	}

	/** Returns whether the MCP initialize handshake has been completed. */
	isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * POST a JSON-RPC message and return the parsed response.
	 * Throws on network errors, timeouts, or MCP-level errors.
	 */
	private async rpcSend(
		method: string,
		params?: Record<string, unknown>,
	): Promise<JsonRpcResponse> {
		if (this.stopped)
			throw new Error("[GitNexus] Remote MCP client is stopped.");

		const body = {
			jsonrpc: "2.0" as const,
			id: this.nextId++,
			method,
			...(params !== undefined ? { params } : {}),
		};

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);

		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			};
			if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

			const res = await Promise.race([
				fetch(this.serverUrl, {
					method: "POST",
					headers,
					body: JSON.stringify(body),
					signal: controller.signal,
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => {
						controller.abort();
						reject(
							new Error(
								`[GitNexus] Remote MCP request timed out after ${this.timeoutMs}ms`,
							),
						);
					}, this.timeoutMs),
				),
			]);

			if (!res.ok) {
				// Session expired (server restart, session evicted) → clear state so next call re-initializes
				if (res.status === 404 && this.sessionId) {
					this.initialized = false;
					this.sessionId = null;
					this.initPromise = null;
				}
				throw new Error(`[GitNexus] HTTP ${res.status}`);
			}

			// Capture session ID for StreamableHTTP session stickiness
			const sid = res.headers.get("mcp-session-id");
			if (sid) this.sessionId = sid;

			let data: JsonRpcResponse;
			try {
				data = (await res.json()) as JsonRpcResponse;
			} catch {
				throw new Error("[GitNexus] Malformed JSON response from remote MCP.");
			}

			if (data.error) {
				throw new Error(
					`[GitNexus] ${data.error.message || `MCP error ${data.error.code}`}`,
				);
			}

			return data;
		} catch (err) {
			if (err instanceof Error && err.message.includes("timed out")) throw err;
			if (err instanceof Error && err.message.startsWith("[GitNexus]"))
				throw err;
			throw new Error(
				`[GitNexus] ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Complete MCP initialize handshake (idempotent for concurrent callers).
	 * Only runs once per client lifetime until stop() is called.
	 */
	private ensureInitialized(): Promise<void> {
		if (this.initialized) return Promise.resolve();
		if (this.stopped)
			return Promise.reject(
				new Error("[GitNexus] Remote MCP client is stopped."),
			);

		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			try {
				await this.rpcSend("initialize", {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "pi-gitnexus", version: "0.1.0" },
				});

				// Send initialized notification (fire-and-forget)
				try {
					await fetch(this.serverUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							jsonrpc: "2.0",
							method: "notifications/initialized",
						}),
					});
				} catch {
					/* best-effort */
				}

				this.initialized = true;
			} catch (err) {
				this.initPromise = null;
				throw new Error(
					`[GitNexus] Remote MCP initialization failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		})();

		return this.initPromise;
	}

	/**
	 * Execute a tools/call request and extract the text response.
	 */
	private async executeToolCall(
		name: string,
		args: Record<string, unknown>,
	): Promise<string> {
		const response = await this.rpcSend("tools/call", {
			name,
			arguments: args,
		});

		const result = response.result as McpToolResult | undefined;

		if (!result?.content) {
			throw new Error(
				"[GitNexus] No response content returned from remote MCP.",
			);
		}

		const text = result.content
			.filter((c) => c.type === "text" && c.text)
			.map((c) => c.text!)
			.join("\n");

		if (result.isError) {
			throw new Error(
				`[GitNexus] ${text || "Remote MCP reported an error with no text payload."}`,
			);
		}

		if (!text) {
			throw new Error("[GitNexus] Remote MCP returned an empty response.");
		}

		// Truncate including the prefix so total stays within MAX_OUTPUT_CHARS
		const available = MAX_OUTPUT_CHARS - PREFIX.length;
		return PREFIX + text.slice(0, Math.max(0, available));
	}

	/**
	 * Call an MCP tool by name and return its formatted text response.
	 * Handles 404 session recovery with single transparent retry.
	 */
	async callTool(
		name: string,
		args: Record<string, unknown>,
		_cwd?: string,
	): Promise<string> {
		await this.ensureInitialized();

		if (this.stopped)
			throw new Error("[GitNexus] Remote MCP client is stopped.");

		try {
			return await this.executeToolCall(name, args);
		} catch (err) {
			// Transparent recovery: if the MCP session was evicted (404),
			// clear state, re-initialize, and retry exactly once.
			if (
				err instanceof Error &&
				err.message.includes("HTTP 404")
			) {
				this.stop();
				await this.ensureInitialized();
				return this.executeToolCall(name, args);
			}
			throw err;
		}
	}

	/** Mark as stopped. Resets initialization state so next call re-initializes. */
	stop(): void {
		this.stopped = false; // Allow re-use after stop
		this.initialized = false;
		this.initPromise = null;
		this.sessionId = null;
	}

	/** No-op: remote HTTP connections don't have idle process management. */
	refreshIdleTimer(): void {
		// Remote connections are stateless HTTP — no idle timeout needed.
	}
}
