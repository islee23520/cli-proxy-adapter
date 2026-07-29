import { describe, expect, mock, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerExtension, { normalizeKimiToolParameterTypes, normalizeToolParameterTypes, planRegistration } from "./index.ts";

describe("normalizeToolParameterTypes", () => {
	test("adds a root object type without changing valid tool schemas", () => {
		const payload = {
			tools: [
				{ type: "function", function: { name: "missing", parameters: { properties: {} } } },
				{ type: "function", function: { name: "absent" } },
				{ type: "function", function: { name: "wrong", parameters: { type: "string" } } },
				{ type: "function", function: { name: "valid", parameters: { type: "object", properties: { value: { type: "string" } } } } },
			],
		};

		expect(normalizeToolParameterTypes(payload)).toEqual({
			tools: [
				{ type: "function", function: { name: "missing", parameters: { type: "object", properties: {} } } },
				{ type: "function", function: { name: "absent", parameters: { type: "object", properties: {} } } },
				{ type: "function", function: { name: "wrong", parameters: { type: "object" } } },
				{ type: "function", function: { name: "valid", parameters: { type: "object", properties: { value: { type: "string" } } } } },
			],
		});
	});

	test("returns non-request payloads unchanged", () => {
		const payload = { messages: [] };
		expect(normalizeToolParameterTypes(payload)).toBe(payload);
		expect(normalizeToolParameterTypes(null)).toBeNull();
	});
});

describe("normalizeKimiToolParameterTypes", () => {
	test("flattens root object unions into one Moonshot-compatible object schema", () => {
		const payload = {
			tools: [{
				type: "function",
				function: {
					name: "monitor",
					parameters: {
						anyOf: [
							{
								type: "object",
								properties: { action: { const: "create" }, command: { type: "string" } },
								required: ["action", "command"],
							},
							{
								type: "object",
								properties: { action: { const: "rearm" }, bash_id: { type: "string" } },
								required: ["action", "bash_id"],
							},
						],
					},
				},
			}],
		};

		expect(normalizeKimiToolParameterTypes(payload)).toEqual({
			tools: [{
				type: "function",
				function: {
					name: "monitor",
					parameters: {
						type: "object",
						properties: {
							action: { type: "string", enum: ["create", "rearm"] },
							command: { type: "string" },
							bash_id: { type: "string" },
						},
						required: ["action"],
					},
				},
			}],
		});
	});
});

describe("planRegistration (single cliproxy provider)", () => {
	test("puts every model under cliproxy with openai-completions + /v1", () => {
		const plan = planRegistration([
			{ id: "claude-sonnet-4-5", owned_by: "anthropic" },
			{ id: "gemini-2.5-pro", owned_by: "google" },
			{ id: "kimi-k3", owned_by: "moonshot" },
			{ id: "grok-4.5", owned_by: "xai" },
		]);

		expect(plan.providerName).toBe("cliproxy");
		expect(plan.api).toBe("openai-completions");
		expect(plan.baseSuffix).toBe("/v1");
		expect(plan.modelIds).toEqual([
			"claude-sonnet-4-5",
			"gemini-2.5-pro",
			"kimi-k3",
			"grok-4.5",
		]);
		expect(plan.legacyProviders).toEqual(["cliproxy-openai", "cliproxy-gemini"]);
		expect(plan.compat).toEqual({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			maxTokensField: "max_tokens",
		});
	});

	test("empty model list still targets cliproxy and legacy unregisters", () => {
		const plan = planRegistration([]);
		expect(plan.providerName).toBe("cliproxy");
		expect(plan.modelIds).toEqual([]);
		expect(plan.legacyProviders).toContain("cliproxy-gemini");
		expect(plan.legacyProviders).toContain("cliproxy-openai");
	});

	test("proxy failure during extension load does not write before Senpi owns the output surface", async () => {
		const previousUrl = process.env.CLIPROXY_URL;
		process.env.CLIPROXY_URL = "http://127.0.0.1:1";
		const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("proxy offline"));
		const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
		const registerProvider = mock(() => undefined);
		const on = mock(() => undefined);
		const pi = {
			unregisterProvider: mock(() => undefined),
			registerProvider,
			registerCommand: mock(() => undefined),
			on,
		};

		try {
			await Reflect.apply(registerExtension, undefined, [pi]);

			expect(warnSpy).not.toHaveBeenCalled();
			expect(registerProvider).toHaveBeenCalledTimes(1);
			expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
		} finally {
			fetchSpy.mockRestore();
			warnSpy.mockRestore();
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});

	test("loads Senpi config before legacy pi config", async () => {
		const previousHome = process.env.HOME;
		const previousUrl = process.env.CLIPROXY_URL;
		const previousKey = process.env.CLIPROXY_API_KEY;
		const home = await mkdtemp(join(tmpdir(), "cliproxy-senpi-"));
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: "grok-4.5", owned_by: "xai" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const pi = {
			unregisterProvider: mock(() => undefined),
			registerProvider: mock(() => undefined),
			registerCommand: mock(() => undefined),
			on: mock(() => undefined),
		};

		try {
			delete process.env.CLIPROXY_URL;
			delete process.env.CLIPROXY_API_KEY;
			process.env.HOME = home;
			await mkdir(join(home, ".senpi", "agent"), { recursive: true });
			await mkdir(join(home, ".pi", "agent"), { recursive: true });
			await writeFile(join(home, ".senpi", "agent", "cliproxy.json"), JSON.stringify({ baseUrl: "http://senpi.example", apiKey: "senpi-key" }));
			await writeFile(join(home, ".pi", "agent", "cliproxy.json"), JSON.stringify({ baseUrl: "http://pi.example", apiKey: "pi-key" }));

			await Reflect.apply(registerExtension, undefined, [pi]);

			expect(fetchSpy).toHaveBeenCalledWith(
				"http://senpi.example/v1/models",
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: "Bearer senpi-key" }),
				}),
			);
		} finally {
			fetchSpy.mockRestore();
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
			if (previousKey === undefined) delete process.env.CLIPROXY_API_KEY;
			else process.env.CLIPROXY_API_KEY = previousKey;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("normalizes GPT tool payloads through the provider request hook only", async () => {
		const previousUrl = process.env.CLIPROXY_URL;
		process.env.CLIPROXY_URL = "http://cliproxy.example";
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: "gpt-5.6-sol", owned_by: "openai" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const pi = {
			unregisterProvider: mock(() => undefined),
			registerProvider: mock(() => undefined),
			registerCommand: mock(() => undefined),
			on: mock((name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler)),
		};

		try {
			await Reflect.apply(registerExtension, undefined, [pi]);
			const handler = handlers.get("before_provider_request");
			expect(handler).toBeDefined();
			const payload = { tools: [{ type: "function", function: { name: "ping", parameters: {} } }] };
			expect(handler?.({ payload }, { model: { provider: "cliproxy", id: "gpt-5.6-sol" } })).toEqual({
				tools: [{ type: "function", function: { name: "ping", parameters: { type: "object" } } }],
			});
			expect(handler?.({ payload }, { model: { provider: "cliproxy", id: "kimi-k3" } })).toEqual({
				tools: [{ type: "function", function: { name: "ping", parameters: { type: "object" } } }],
			});
			expect(handler?.({ payload }, { model: { provider: "openai", id: "gpt-5.6-sol" } })).toBeUndefined();
		} finally {
			fetchSpy.mockRestore();
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});

	test("request hook follows event.model, not the session model", async () => {
		const previousUrl = process.env.CLIPROXY_URL;
		process.env.CLIPROXY_URL = "http://cliproxy.example";
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: "kimi-k3", owned_by: "moonshot" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const pi = {
			unregisterProvider: mock(() => undefined),
			registerProvider: mock(() => undefined),
			registerCommand: mock(() => undefined),
			on: mock((name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler)),
		};

		try {
			await Reflect.apply(registerExtension, undefined, [pi]);
			const handler = handlers.get("before_provider_request");
			const payload = {
				tools: [{
					type: "function",
					function: {
						name: "monitor",
						parameters: {
							anyOf: [
								{ type: "object", properties: { action: { const: "create" } }, required: ["action"] },
								{ type: "object", properties: { action: { const: "rearm" } }, required: ["action"] },
							],
						},
					},
				}],
			};
			const sessionModel = { provider: "cliproxy", id: "grok-4.5" };

			// A subagent dispatching to kimi-k3 from a grok-4.5 session must still
			// get the Moonshot flattening, which ctx.model alone would skip.
			expect(handler?.({ payload, model: { provider: "cliproxy", id: "kimi-k3" } }, { model: sessionModel })).toEqual({
				tools: [{
					type: "function",
					function: {
						name: "monitor",
						parameters: {
							type: "object",
							properties: { action: { type: "string", enum: ["create", "rearm"] } },
							required: ["action"],
						},
					},
				}],
			});

			// The reverse: a non-cliproxy request from a cliproxy session is left alone.
			expect(
				handler?.({ payload, model: { provider: "anthropic", id: "claude-opus-4-6" } }, { model: { provider: "cliproxy", id: "kimi-k3" } }),
			).toBeUndefined();

			// Hosts that do not populate event.model still fall back to ctx.model.
			expect(handler?.({ payload }, { model: { provider: "cliproxy", id: "kimi-k3" } })).toBeDefined();
		} finally {
			fetchSpy.mockRestore();
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});
});
