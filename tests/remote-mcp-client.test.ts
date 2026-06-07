// @ts-nocheck
// 
// 
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock global fetch
const mockFetch = vi.fn<typeof globalThis.fetch>();

vi.stubGlobal("fetch", mockFetch);

// Import the module under test — will fail until src/remote-mcp-client.ts exists
import { RemoteMcpClient } from "../src/remote-mcp-client";

/** Create a mock Response with proper headers (for StreamableHTTP Mcp-Session-Id support) */
function mockResponse(opts: {
	ok: boolean;
	json?: unknown;
	text?: string;
	status?: number;
	sessionId?: string;
}) {
	const headers = new Headers();
	if (opts.sessionId) headers.set("mcp-session-id", opts.sessionId);
	return {
		ok: opts.ok,
		status: opts.status ?? (opts.ok ? 200 : 400),
		headers,
		json: async () => opts.json,
		text: async () => opts.text ?? "",
	} as Response;
}

describe("RemoteMcpClient", () => {
	let client: RemoteMcpClient;

	beforeEach(() => {
		mockFetch.mockReset();
		client = new RemoteMcpClient({
			serverUrl: "http://localhost:4747/api/mcp",
		});
	});

	// --- Constructor ---

	it("accepts serverUrl in config", () => {
		const c = new RemoteMcpClient({ serverUrl: "http://example.com/mcp" });
		expect(c).toBeDefined();
	});

	// --- StreamableHTTP POST ---

	it("sends POST request to serverUrl", async () => {
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: "ok" }] },
				},
			});
		});

		await client.callTool("query", { query: "test" }, "/repo");

		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:4747/api/mcp",
			expect.objectContaining({ method: "POST" }),
		);
	});

	// --- JSON-RPC 2.0 message format ---

	it("sends valid JSON-RPC 2.0 messages (jsonrpc, id, method, params)", async () => {
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: "result-text" }] },
				},
			});
		});

		await client.callTool("query", { query: "test" }, "/repo");

		const calls = mockFetch.mock.calls;
		const toolCall = calls.find(([, init]) => {
			const body = JSON.parse(init?.body as string);
			return body.method === "tools/call";
		});

		expect(toolCall).toBeDefined();
		const body = JSON.parse(toolCall![1]?.body as string);
		expect(body.jsonrpc).toBe("2.0");
		expect(body.id).toBeDefined();
		expect(body.method).toBe("tools/call");
		expect(body.params).toEqual({
			name: "query",
			arguments: { query: "test" },
		});
	});

	// --- MCP initialize handshake ---

	it("performs MCP initialize handshake before tools/call", async () => {
		const receivedMethods: string[] = [];

		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			receivedMethods.push(body.method);
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: "data" }] },
				},
			});
		});

		await client.callTool("query", { query: "test" }, "/repo");

		expect(receivedMethods).toContain("initialize");
		expect(receivedMethods).toContain("notifications/initialized");
		expect(receivedMethods).toContain("tools/call");
		expect(receivedMethods.indexOf("initialize")).toBeLessThan(
			receivedMethods.indexOf("tools/call"),
		);
	});

	// --- callTool: sends tools/call request ---

	it("callTool sends tools/call request and parses response", async () => {
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: "query-result-data" }] },
				},
			});
		});

		const result = await client.callTool("query", { query: "auth" }, "/repo");
		expect(result).toContain("query-result-data");
	});

	// --- callTool: extracts text content from McpToolResult ---

	it("callTool extracts text content from McpToolResult", async () => {
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: {
						content: [
							{ type: "text", text: "first-line" },
							{ type: "text", text: "second-line" },
							{ type: "image", data: "ignored" },
						],
					},
				},
			});
		});

		const result = await client.callTool("query", { query: "test" }, "/repo");
		expect(result).toContain("first-line");
		expect(result).toContain("second-line");
		expect(result).not.toContain("ignored");
	});

	// --- callTool: handles isError responses ---

	it("callTool throws on isError responses", async () => {
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: {
						isError: true,
						content: [{ type: "text", text: "tool execution failed" }],
					},
				},
			});
		});

		await expect(
			client.callTool("query", { query: "bad" }, "/repo"),
		).rejects.toThrow("tool execution failed");
	});

	// --- callTool: truncates output to MAX_OUTPUT_CHARS (8192) ---

	it("callTool truncates output to MAX_OUTPUT_CHARS (8192)", async () => {
		const longText = "x".repeat(10000);

		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: longText }] },
				},
			});
		});

		const result = await client.callTool("query", { query: "big" }, "/repo");
		expect(result.length).toBeLessThanOrEqual(8192);
	});

	// --- callTool: throws on network failure ---

	it("callTool throws on network failure", async () => {
		mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

		await expect(
			client.callTool("query", { query: "test" }, "/repo"),
		).rejects.toThrow();

		// reset for a second attempt where initialize succeeds but tool call fails
		mockFetch.mockReset();
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			throw new TypeError("network error");
		});

		await expect(
			client.callTool("query", { query: "test" }, "/repo"),
		).rejects.toThrow();
	});

	// --- callTool: throws on timeout ---

	it("callTool throws on timeout", async () => {
		mockFetch.mockImplementation(async () => {
			await new Promise(() => {});
			throw new Error("unreachable");
		});

		const timeoutClient = new RemoteMcpClient({
			serverUrl: "http://localhost:4747/api/mcp",
			timeout: 100,
		});

		await expect(
			timeoutClient.callTool("query", { query: "test" }, "/repo"),
		).rejects.toThrow();

		timeoutClient.stop();
	}, 5000);

	// --- stop(): cleanup ---

	it("stop() cleans up resources", () => {
		expect(() => client.stop()).not.toThrow();
	});

	// --- Reuses connection across calls (no re-initialize) ---

	it("reuses connection across calls (no re-initialize)", async () => {
		let initCount = 0;

		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				initCount++;
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: `result-${initCount}` }] },
				},
			});
		});

		await client.callTool("query", { query: "first" }, "/repo");
		await client.callTool("query", { query: "second" }, "/repo");

		expect(initCount).toBe(1);
	});

	// --- Concurrent calls ---

	it("handles concurrent callTool invocations", async () => {
		let initCount = 0;
		let callCount = 0;

		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				initCount++;
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			callCount++;
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: {
						content: [{ type: "text", text: `concurrent-result-${callCount}` }],
					},
				},
			});
		});

		const [result1, result2, result3] = await Promise.all([
			client.callTool("query", { query: "a" }, "/repo"),
			client.callTool("query", { query: "b" }, "/repo"),
			client.callTool("query", { query: "c" }, "/repo"),
		]);

		expect(result1).toContain("concurrent-result");
		expect(result2).toContain("concurrent-result");
		expect(result3).toContain("concurrent-result");
		expect(initCount).toBe(1);
		expect(callCount).toBe(3);
	});

	// --- Reconnection after stop ---

	it("re-initializes after stop()", async () => {
		let initCount = 0;

		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				initCount++;
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-123",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-123",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: "after-stop" }] },
				},
			});
		});

		await client.callTool("query", { query: "test" }, "/repo");
		expect(initCount).toBe(1);

		client.stop();
		expect(client.isInitialized()).toBe(false);

		const result = await client.callTool("query", { query: "test" }, "/repo");
		expect(result).toContain("after-stop");
		expect(initCount).toBe(2);
	});

	// --- Initialize failure ---

	it("throws when initialize returns an error", async () => {
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-123",
					json: {
						jsonrpc: "2.0",
						id: body.id,
						error: { code: -1, message: "Server too busy" },
					},
				});
			}
			return mockResponse({
				ok: true,
				status: 204,
				sessionId: "test-session-123",
			});
		});

		await expect(
			client.callTool("query", { query: "test" }, "/repo"),
		).rejects.toThrow("Remote MCP initialization failed");
	});

	// --- HTTP error status ---

	it("throws on non-OK HTTP status", async () => {
		mockFetch.mockImplementation(
			async () =>
				({ ok: false, status: 503, headers: new Headers() }) as Response,
		);

		await expect(
			client.callTool("query", { query: "test" }, "/repo"),
		).rejects.toThrow("HTTP 503");
	});

	// --- Malformed JSON response ---

	it("throws on malformed JSON response", async () => {
		mockFetch.mockImplementation(
			async () =>
				({
					ok: true,
					headers: new Headers(),
					json: async () => {
						throw new Error("invalid json");
					},
				}) as Response,
		);

		await expect(
			client.callTool("query", { query: "test" }, "/repo"),
		).rejects.toThrow("Malformed JSON");
	});

	// --- getServerUrl ---

	it("getServerUrl returns configured URL", () => {
		const c = new RemoteMcpClient({ serverUrl: "http://example.com/mcp" });
		expect(c.getServerUrl()).toBe("http://example.com/mcp");
	});

	// --- isInitialized ---

	it("isInitialized returns false before first call", () => {
		const c = new RemoteMcpClient({
			serverUrl: "http://localhost:4747/api/mcp",
		});
		expect(c.isInitialized()).toBe(false);
	});

	// --- Constructor with string ---

	it("accepts serverUrl as plain string", () => {
		const c = new RemoteMcpClient("http://example.com/mcp");
		expect(c.getServerUrl()).toBe("http://example.com/mcp");
	});

	// --- Custom timeout ---

	it("accepts custom timeout in options", () => {
		const c = new RemoteMcpClient({
			serverUrl: "http://localhost:4747",
			timeout: 5000,
		});
		expect(c.getServerUrl()).toBe("http://localhost:4747");
	});

	// --- StreamableHTTP headers ---

	it("sends Accept header for StreamableHTTP", async () => {
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			const headers = init?.headers as Record<string, string>;
			// First call should have Accept header
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "test-session-456",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "test-session-456",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "test-session-456",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: "ok" }] },
				},
			});
		});

		await client.callTool("query", { query: "test" }, "/repo");

		// Check the first call (initialize) has the correct Accept header
		const firstCall = mockFetch.mock.calls[0];
		const firstHeaders = firstCall[1]?.headers as Record<string, string>;
		expect(firstHeaders).toBeDefined();
		expect(firstHeaders["Accept"]).toContain("application/json");
		expect(firstHeaders["Accept"]).toContain("text/event-stream");
	});

	// --- Mcp-Session-Id session stickiness ---

	it("sends Mcp-Session-Id header after initialize", async () => {
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			const headers = init?.headers as Record<string, string>;

			if (body.method === "initialize") {
				// Initialize should NOT have session ID
				expect(headers["Mcp-Session-Id"]).toBeUndefined();
				return mockResponse({
					ok: true,
					sessionId: "unique-session-abc",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "unique-session-abc",
				});
			}

			// tools/call SHOULD have session ID
			expect(headers["Mcp-Session-Id"]).toBe("unique-session-abc");
			return mockResponse({
				ok: true,
				sessionId: "unique-session-abc",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: "session-ok" }] },
				},
			});
		});

		const result = await client.callTool("query", { query: "test" }, "/repo");
		expect(result).toContain("session-ok");
	});

	// --- stop() clears session ID ---

	// ─── RED: 404 clears session but does NOT retry (caller sees error) ───

	it("RED: on HTTP 404 clears session state but does NOT retry — caller sees the error", async () => {
		let callCount = 0;
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			callCount++;
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "stale-session-id",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "stale-session-id",
				});
			}
			// Simulate server restart: session evicted → 404
			callCount++;
			return {
				ok: false,
				status: 404,
				headers: new Headers(),
				text: async () => "session not found",
			} as Response;
		});

		// First call succeeds (initializes)
		const result1 = await client.callTool("query", { query: "test" }, "/repo");
		expect(result1).toBeDefined();
		expect(client.isInitialized()).toBe(true);

		// Second call gets 404 → throws (NO transparent retry)
		await expect(
			client.callTool("query", { query: "test" }, "/repo"),
		).rejects.toThrow("HTTP 404");

		// Session state was cleared so next call re-initializes
		expect(client.isInitialized()).toBe(false);

		// BUG: The caller saw an error even though recovery is possible.
		// The code clears session on 404 but does NOT retry the failed request.
		// Next call would succeed, but the caller already received an error.
	});

	// ─── RED: 404 recovery should be transparent (single retry) — currently MISSING ───

	it("RED: should retry once on 404 for transparent recovery but currently does NOT", async () => {
		let fetchCount = 0;
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			fetchCount++;
			if (body.method === "initialize") {
				return mockResponse({
					ok: true,
					sessionId: "session-1",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "session-1",
				});
			}
			if (body.method === "tools/call") {
				// First tools/call: 404 (stale session)
				if (fetchCount <= 4) {
					return {
						ok: false,
						status: 404,
						headers: new Headers(),
						text: async () => "session not found",
					} as Response;
				}
				// After re-init: success
				return mockResponse({
					ok: true,
					sessionId: "session-2",
					json: {
						jsonrpc: "2.0",
						id: body.id,
						result: { content: [{ type: "text", text: "recovered" }] },
					},
				});
			}
			return mockResponse({ ok: true, json: {} });
		});

		// Initialize succeeds
		await client.callTool("query", { query: "init" }, "/repo");
		expect(client.isInitialized()).toBe(true);

		// tools/call returns 404 → currently throws, caller sees error
		// EXPECTED BEHAVIOR: should retry once after re-init and succeed
		await expect(
			client.callTool("query", { query: "test" }, "/repo"),
		).rejects.toThrow("HTTP 404");

		// BUG: callTool should have retried once after clearing session.
		// Instead, it cleared session and threw — leaving recovery to the caller.
	});

	// ─── RED: 404 guard prevents infinite loops ───

	it("RED: 404 guard prevents infinite loop when session is null", async () => {
		// Force client into a state where sessionId is null but initialized is true
		// (simulating the state after a 404 cleared the session)
		client.stop(); // sets initialized=false, sessionId=null

		let fetchCount = 0;
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			fetchCount++;
			if (body.method === "initialize") {
				// Initialize succeeds but with a 404 on the response
				return {
					ok: false,
					status: 404,
					headers: new Headers(),
					text: async () => "MCP endpoint not found",
				} as Response;
			}
			return mockResponse({ ok: true, json: {} });
		});

		// When sessionId is null, the 404 guard should NOT clear anything
		// (it checks `if (res.status === 404 && this.sessionId)`)
		await expect(
			client.callTool("query", { query: "test" }, "/repo"),
		).rejects.toThrow("HTTP 404");

		// Should NOT have entered an infinite loop — only 1 fetch for initialize
		// If the guard didn't check this.sessionId, it could loop forever
		expect(fetchCount).toBe(1);
	});

	it("stop() clears session ID for fresh re-initialize", async () => {
		let initCount = 0;
		mockFetch.mockImplementation(async (_url, init) => {
			const body = JSON.parse(init?.body as string);
			const headers = init?.headers as Record<string, string>;
			if (body.method === "initialize") {
				initCount++;
				// After stop, session ID should be absent
				expect(headers["Mcp-Session-Id"]).toBeUndefined();
				return mockResponse({
					ok: true,
					sessionId: "fresh-session",
					json: { jsonrpc: "2.0", id: body.id, result: { capabilities: {} } },
				});
			}
			if (body.method === "notifications/initialized") {
				return mockResponse({
					ok: true,
					status: 204,
					sessionId: "fresh-session",
				});
			}
			return mockResponse({
				ok: true,
				sessionId: "fresh-session",
				json: {
					jsonrpc: "2.0",
					id: body.id,
					result: { content: [{ type: "text", text: "fresh" }] },
				},
			});
		});

		await client.callTool("query", { query: "a" }, "/repo");
		client.stop();
		await client.callTool("query", { query: "b" }, "/repo");
		expect(initCount).toBe(2);
	});
});
