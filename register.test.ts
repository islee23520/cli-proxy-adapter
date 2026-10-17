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

describe("planRegistration (single cpa provider)", () => {
	test("registers ChatGPT Web routes as Responses models and excludes injected image aliases", async () => {
		const previousUrl = process.env.CLIPROXY_URL;
		process.env.CLIPROXY_URL = "http://cliproxy.example";
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({
				data: [
					{ id: "cgw/high", owned_by: "openai" },
					{ id: "cgw/gpt-image-2", owned_by: "openai" },
					{ id: "gpt-5.6-sol", owned_by: "openai" },
				],
			}), { status: 200, headers: { "content-type": "application/json" } }),
		);
		const registerProvider = mock(() => undefined);
		const pi = {
			unregisterProvider: mock(() => undefined),
			registerProvider,
			registerCommand: mock(() => undefined),
			on: mock(() => undefined),
		};

		try {
			await Reflect.apply(registerExtension, undefined, [pi]);
			const registration = registerProvider.mock.calls[0]?.[1];
			const high = registration?.models.find((model: { id: string }) => model.id === "cgw/high");
			expect(high).toMatchObject({
				api: "openai-responses",
				reasoning: false,
				input: ["text", "image"],
				contextWindow: 90_000,
			});
			expect(registration?.models.some((model: { id: string }) => model.id === "cgw/gpt-image-2")).toBe(false);
			expect(registration?.models.find((model: { id: string }) => model.id === "gpt-5.6-sol")?.api).toBeUndefined();
		} finally {
			fetchSpy.mockRestore();
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});

	test("injects stable ChatGPT Web thread metadata and rotates the turn per user instruction", async () => {
		const previousUrl = process.env.CLIPROXY_URL;
		process.env.CLIPROXY_URL = "http://cliproxy.example";
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: "cgw/high", owned_by: "openai" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const handlers = new Map<string, (...args: unknown[]) => unknown>();
		const pi = {
			unregisterProvider: mock(() => undefined),
			registerProvider: mock(() => undefined),
			registerCommand: mock(() => undefined),
			on: mock((name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler)),
		};

		try {
			await Reflect.apply(registerExtension, undefined, [pi]);
			const start = handlers.get("before_agent_start");
			const request = handlers.get("before_provider_request");
			expect(start).toBeDefined();
			expect(request).toBeDefined();
			const context = { cwd: "C:\\repo", model: { provider: "cpa", id: "cgw/high" } };
			start?.({ prompt: "first" }, context);
			const payload = {
				model: "cgw/high",
				input: [
					{ type: "message", role: "user", content: [{ type: "input_text", text: "first" }] },
				],
			};
			const first = request?.({ payload, model: context.model }, context) as Record<string, unknown>;
			const repeated = request?.({ payload, model: context.model }, context) as Record<string, unknown>;
			const firstMetadata = JSON.parse((first.client_metadata as Record<string, string>)["x-codex-turn-metadata"]);
			const repeatedMetadata = JSON.parse((repeated.client_metadata as Record<string, string>)["x-codex-turn-metadata"]);
			expect(first.prompt_cache_key).toBe(firstMetadata.thread_id);
			expect(firstMetadata).toMatchObject({ request_kind: "turn", sandbox: "read-only", workspaces: { "C:\\repo": {} } });
			expect(repeatedMetadata.thread_id).toBe(firstMetadata.thread_id);
			expect(repeatedMetadata.turn_id).toBe(firstMetadata.turn_id);
			expect(((first.input as Array<Record<string, unknown>>)[0]?.internal_chat_message_metadata_passthrough as Record<string, string>).turn_id)
				.toBe(firstMetadata.turn_id);

			start?.({ prompt: "second" }, context);
			const second = request?.({ payload, model: context.model }, context) as Record<string, unknown>;
			const secondMetadata = JSON.parse((second.client_metadata as Record<string, string>)["x-codex-turn-metadata"]);
			expect(secondMetadata.thread_id).toBe(firstMetadata.thread_id);
			expect(secondMetadata.turn_id).not.toBe(firstMetadata.turn_id);
			expect(request?.(
				{ payload, model: { provider: "cpa", id: "gpt-5.6-sol" } },
				{ ...context, model: { provider: "cpa", id: "gpt-5.6-sol" } },
			)).toBe(payload);
		} finally {
			fetchSpy.mockRestore();
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});

	test("synthesizes Luna Fast as a priority alias of base Luna when the proxy does not expose Fast", async () => {
		const previousUrl = process.env.CLIPROXY_URL;
		process.env.CLIPROXY_URL = "http://cliproxy.example";
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: "gpt-5.6-luna", owned_by: "openai" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const registerProvider = mock(() => undefined);
		const pi = {
			unregisterProvider: mock(() => undefined),
			registerProvider,
			registerCommand: mock(() => undefined),
			on: mock(() => undefined),
		};

		try {
			await Reflect.apply(registerExtension, undefined, [pi]);
			const registration = registerProvider.mock.calls[0]?.[1];
			const fast = registration?.models.filter((model: { id: string }) => model.id === "gpt-5.6-luna-fast");
			expect(fast).toHaveLength(1);
			expect(fast?.[0]).toMatchObject({
				id: "gpt-5.6-luna-fast",
				upstreamModelId: "gpt-5.6-luna",
				serviceTier: "priority",
				extraBody: { service_tier: "priority" },
			});
		} finally {
			fetchSpy.mockRestore();
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});

	test("keeps one native Luna Fast route when the proxy already exposes it", async () => {
		const previousUrl = process.env.CLIPROXY_URL;
		process.env.CLIPROXY_URL = "http://cliproxy.example";
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({
				data: [
					{ id: "gpt-5.6-luna", owned_by: "openai" },
					{ id: "gpt-5.6-luna-fast", owned_by: "openai" },
				],
			}), { status: 200, headers: { "content-type": "application/json" } }),
		);
		const registerProvider = mock(() => undefined);
		const pi = {
			unregisterProvider: mock(() => undefined),
			registerProvider,
			registerCommand: mock(() => undefined),
			on: mock(() => undefined),
		};

		try {
			await Reflect.apply(registerExtension, undefined, [pi]);
			const registration = registerProvider.mock.calls[0]?.[1];
			const fast = registration?.models.filter((model: { id: string }) => model.id === "gpt-5.6-luna-fast");
			expect(fast).toHaveLength(1);
			expect(fast?.[0]?.upstreamModelId).toBeUndefined();
			expect(fast?.[0]?.serviceTier).toBeUndefined();
		} finally {
			fetchSpy.mockRestore();
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});

	test("GPT fast allowlist can expose all, none, or only selected models", () => {
		const rawModels = [
			{ id: "gpt-5.6-sol-fast" }, { id: "gpt-5.4-mini-fast" }, { id: "gpt-6-astra-fast" },
			{ id: "gpt-5.6-luna-fast" }, { id: "gpt-5.6-terra-fast" }, { id: "gpt-6-luna" },
			{ id: "grok-3-mini-fast" },
		];
		expect(planRegistration(rawModels).modelIds).toEqual([...rawModels.map((m) => m.id), "gpt-6-luna-fast"]);
		expect(planRegistration(rawModels, []).modelIds).toEqual(["gpt-6-luna", "grok-3-mini-fast"]);
		expect(planRegistration(rawModels, ["gpt-5.6-luna-fast", "gpt-5.6-terra-fast", "gpt-6-luna-fast"]).modelIds)
			.toEqual(["gpt-5.6-luna-fast", "gpt-5.6-terra-fast", "gpt-6-luna", "grok-3-mini-fast", "gpt-6-luna-fast"]);
	});

	test("registers GPT-6 Luna Fast and routes it to Luna with priority tier", async () => {
		const previousUrl = process.env.CLIPROXY_URL;
		process.env.CLIPROXY_URL = "http://cliproxy.example";
		const previousHome = process.env.HOME;
		const home = await mkdtemp(join(tmpdir(), "cliproxy-fast-policy-"));
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [
			{ id: "gpt-6-luna", owned_by: "openai" }, { id: "gpt-5.6-sol-fast", owned_by: "openai" },
		] }), { status: 200, headers: { "content-type": "application/json" } }));
		const registerProvider = mock(() => undefined);
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const pi = {
			unregisterProvider: mock(() => undefined), registerProvider,
			registerCommand: mock(() => undefined),
			on: mock((name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler)),
		};
		try {
			process.env.HOME = home;
			await mkdir(join(home, ".omo"), { recursive: true });
			await writeFile(join(home, ".omo", "cliproxy.json"), JSON.stringify({ gptFastModels: ["gpt-6-luna-fast"] }));
			await Reflect.apply(registerExtension, undefined, [pi]);
			const models = registerProvider.mock.calls[0]?.[1]?.models;
			expect(models.map((model: { id: string }) => model.id)).toEqual(["gpt-6-luna", "gpt-6-luna-fast"]);
			expect(models[1]).toMatchObject({ reasoning: true, input: ["text", "image"], contextWindow: 1_050_000 });
			const payload = { model: "gpt-6-luna-fast", tools: [{ type: "function", function: { name: "ping", parameters: {} } }] };
			expect(handlers.get("before_provider_request")?.({ payload, model: { provider: "cpa", id: "gpt-6-luna-fast" } }, {}))
				.toEqual({ model: "gpt-6-luna", service_tier: "priority", tools: [{ type: "function", function: { name: "ping", parameters: { type: "object" } } }] });
		} finally {
			fetchSpy.mockRestore();
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			await rm(home, { recursive: true, force: true });
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});

	test("puts every model under cliproxy with openai-completions + /v1", () => {
		const plan = planRegistration([
			{ id: "claude-sonnet-4-5", owned_by: "anthropic" },
			{ id: "gemini-2.5-pro", owned_by: "google" },
			{ id: "kimi-k3", owned_by: "moonshot" },
			{ id: "grok-4.5", owned_by: "xai" },
		]);

		expect(plan.providerName).toBe("cpa");
		expect(plan.api).toBe("openai-completions");
		expect(plan.baseSuffix).toBe("/v1");
		expect(plan.modelIds).toEqual([
			"claude-sonnet-4-5",
			"gemini-2.5-pro",
			"kimi-k3",
			"grok-4.5",
		]);
		expect(plan.legacyProviders).toEqual(["cliproxy-openai", "cliproxy-gemini", "cliproxy"]);
		expect(plan.compat).toEqual({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			maxTokensField: "max_tokens",
		});
	});

	test("empty model list still targets cliproxy and legacy unregisters", () => {
		const plan = planRegistration([]);
		expect(plan.providerName).toBe("cpa");
		expect(plan.modelIds).toEqual([]);
		expect(plan.legacyProviders).toContain("cliproxy-gemini");
		expect(plan.legacyProviders).toContain("cliproxy-openai");
		expect(plan.legacyProviders).toContain("cliproxy");
	});

	test("preserves Fable ids returned by the proxy alongside other models", () => {
		const plan = planRegistration([
			{ id: "claude-opus-5", owned_by: "anthropic" },
			{ id: "claude-fable-5", owned_by: "anthropic" },
			{ id: "claude-fable-5-1", owned_by: "anthropic" },
			{ id: "anthropic/claude-fable-5", owned_by: "anthropic" },
			{ id: "gpt-5.6-sol", owned_by: "openai" },
		]);

		expect(plan.modelIds).toEqual([
			"claude-opus-5",
			"claude-fable-5",
			"claude-fable-5-1",
			"anthropic/claude-fable-5",
			"gpt-5.6-sol",
		]);
	});

	test("proxy failure during extension load does not write before Senpi owns the output surface", async () => {
		const previousUrl = process.env.CLIPROXY_URL;
		const previousHome = process.env.HOME;
		const home = await mkdtemp(join(tmpdir(), "cliproxy-fallback-"));
		process.env.CLIPROXY_URL = "http://127.0.0.1:1";
		process.env.HOME = home;
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
			const registration = registerProvider.mock.calls[0]?.[1];
			expect(registration?.models.map((model: { id: string }) => model.id)).toContain("gpt-6-luna-fast");
			expect(registration?.models.map((model: { id: string }) => model.id)).toContain("gpt-5.6-sol-fast");
			expect(on).toHaveBeenCalledWith("session_start", expect.any(Function));
		} finally {
			fetchSpy.mockRestore();
			warnSpy.mockRestore();
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			await rm(home, { recursive: true, force: true });
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});

	test("loads OMO config before Senpi and legacy pi config", async () => {
		const previousHome = process.env.HOME;
		const previousUrl = process.env.CLIPROXY_URL;
		const previousKey = process.env.CLIPROXY_API_KEY;
		const home = await mkdtemp(join(tmpdir(), "cliproxy-omo-first-"));
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: "grok-4.7", owned_by: "xai" }] }), {
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
			await mkdir(join(home, ".omo"), { recursive: true });
			await mkdir(join(home, ".senpi", "agent"), { recursive: true });
			await mkdir(join(home, ".pi", "agent"), { recursive: true });
			await writeFile(join(home, ".omo", "cliproxy.json"), JSON.stringify({ baseUrl: "http://omo.example", apiKey: "stale-omo-key" }));
			await writeFile(join(home, ".senpi", "agent", "cliproxy.json"), JSON.stringify({ baseUrl: "http://senpi.example", apiKey: "stale-senpi-key" }));
			await writeFile(join(home, ".pi", "agent", "cliproxy.json"), JSON.stringify({ baseUrl: "http://pi.example", apiKey: "stale-pi-key" }));
			await writeFile(join(home, ".omo", "auth.json"), JSON.stringify({ cpa: { type: "api_key", key: "auth-key" } }));

			await Reflect.apply(registerExtension, undefined, [pi]);

			expect(fetchSpy).toHaveBeenCalledWith(
				"http://omo.example/v1/models",
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: "Bearer auth-key" }),
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
			await writeFile(join(home, ".senpi", "agent", "cliproxy.json"), JSON.stringify({ baseUrl: "http://senpi.example" }));
			await writeFile(join(home, ".pi", "agent", "cliproxy.json"), JSON.stringify({ baseUrl: "http://pi.example" }));
			await mkdir(join(home, ".omo"), { recursive: true });
			await writeFile(join(home, ".omo", "auth.json"), JSON.stringify({ cpa: { type: "api_key", key: "senpi-key" } }));

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

	test("loads CPA key from OMO auth.json instead of cliproxy.json", async () => {
		const previousHome = process.env.HOME;
		const previousUrl = process.env.CLIPROXY_URL;
		const previousKey = process.env.CLIPROXY_API_KEY;
		const previousImageProvider = process.env.PI_IMAGE_GEN_PROVIDER;
		const home = await mkdtemp(join(tmpdir(), "cliproxy-omo-"));
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: "gpt-6-astra", owned_by: "openai" }] }), {
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
			delete process.env.PI_IMAGE_GEN_PROVIDER;
			process.env.HOME = home;
			await mkdir(join(home, ".omo"), { recursive: true });
			await writeFile(
				join(home, ".omo", "cliproxy.json"),
				JSON.stringify({ baseUrl: "http://omo.example", apiKey: "stale-key" }),
			);
			await writeFile(join(home, ".omo", "auth.json"), JSON.stringify({ cpa: { type: "api_key", key: "omo-key" } }));

			await Reflect.apply(registerExtension, undefined, [pi]);

			expect(fetchSpy).toHaveBeenCalledWith(
				"http://omo.example/v1/models",
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: "Bearer omo-key" }),
				}),
			);
			expect(process.env.PI_IMAGE_GEN_PROVIDER).toBe("cpa");
		} finally {
			fetchSpy.mockRestore();
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
			if (previousKey === undefined) delete process.env.CLIPROXY_API_KEY;
			else process.env.CLIPROXY_API_KEY = previousKey;
			if (previousImageProvider === undefined) delete process.env.PI_IMAGE_GEN_PROVIDER;
			else process.env.PI_IMAGE_GEN_PROVIDER = previousImageProvider;
			await rm(home, { recursive: true, force: true });
		}
	});

	test("uses the access token of an oauth auth.json cpa entry", async () => {
		const previousHome = process.env.HOME;
		const previousUrl = process.env.CLIPROXY_URL;
		const previousKey = process.env.CLIPROXY_API_KEY;
		const home = await mkdtemp(join(tmpdir(), "cliproxy-oauth-"));
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: "gpt-6-luna", owned_by: "openai" }] }), {
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
			await mkdir(join(home, ".omo"), { recursive: true });
			await writeFile(join(home, ".omo", "cliproxy.json"), JSON.stringify({ baseUrl: "http://omo.example" }));
			await writeFile(
				join(home, ".omo", "auth.json"),
				JSON.stringify({ cpa: { type: "oauth", access: "oauth-token", refresh: "refresh-token", expires: 1790000000000 } }),
			);

			await Reflect.apply(registerExtension, undefined, [pi]);

			expect(fetchSpy).toHaveBeenCalledWith(
				"http://omo.example/v1/models",
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: "Bearer oauth-token" }),
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
			expect(handler?.({ payload }, { model: { provider: "cpa", id: "gpt-5.6-sol" } })).toEqual({
				tools: [{ type: "function", function: { name: "ping", parameters: { type: "object" } } }],
			});
			expect(handler?.({ payload }, { model: { provider: "cpa", id: "kimi-k3" } })).toEqual({
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
			const sessionModel = { provider: "cpa", id: "grok-4.5" };

			// A subagent dispatching to kimi-k3 from a grok-4.5 session must still
			// get the Moonshot flattening, which ctx.model alone would skip.
			expect(handler?.({ payload, model: { provider: "cpa", id: "kimi-k3" } }, { model: sessionModel })).toEqual({
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
				handler?.({ payload, model: { provider: "anthropic", id: "claude-opus-4-6" } }, { model: { provider: "cpa", id: "kimi-k3" } }),
			).toBeUndefined();

			// Hosts that do not populate event.model still fall back to ctx.model.
			expect(handler?.({ payload }, { model: { provider: "cpa", id: "kimi-k3" } })).toBeDefined();
		} finally {
			fetchSpy.mockRestore();
			if (previousUrl === undefined) delete process.env.CLIPROXY_URL;
			else process.env.CLIPROXY_URL = previousUrl;
		}
	});
});
