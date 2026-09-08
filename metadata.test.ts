import { describe, expect, test } from "bun:test";
import { resolveModelMetadata, toProviderModel } from "./index.ts";

describe("resolveModelMetadata (MODEL_METADATA SSoT)", () => {
	test("grok-4.5 matches xAI docs + catalog: reasoning, image, 500k", () => {
		const m = resolveModelMetadata("grok-4.5");
		expect(m.reasoning).toBe(true);
		expect(m.input).toEqual(["text", "image"]);
		expect(m.contextWindow).toBe(500_000);
		expect(m.maxTokens).toBe(500_000);
	});

	test("grok-4.6 matches xAI docs: reasoning, image, 500k", () => {
		const m = resolveModelMetadata("grok-4.6");
		expect(m.reasoning).toBe(true);
		expect(m.input).toEqual(["text", "image"]);
		expect(m.contextWindow).toBe(500_000);
		expect(m.maxTokens).toBe(500_000);
	});

	test("unknown id falls back to infer* without throwing", () => {
		const m = resolveModelMetadata("totally-unknown-model-xyz");
		expect(m.contextWindow).toBeGreaterThan(0);
		expect(m.maxTokens).toBeGreaterThan(0);
		expect(m.input.includes("text")).toBe(true);
	});

	test("grok-4.3 stays at 1M reasoning+image from table", () => {
		const m = resolveModelMetadata("grok-4.3");
		expect(m.reasoning).toBe(true);
		expect(m.input).toEqual(["text", "image"]);
		expect(m.contextWindow).toBe(1_000_000);
		expect(m.maxTokens).toBe(1_000_000);
	});

	test("glm-5.2: 1M context, reasoning, text-only from table", () => {
		const m = resolveModelMetadata("glm-5.2");
		expect(m.reasoning).toBe(true);
		expect(m.input).toEqual(["text"]);
		expect(m.contextWindow).toBe(1_000_000);
		expect(m.maxTokens).toBe(128_000);
	});

	test("z-ai/glm-5.2-ultrafast shares glm-5.2 1M specs", () => {
		const m = resolveModelMetadata("z-ai/glm-5.2-ultrafast");
		expect(m.reasoning).toBe(true);
		expect(m.input).toEqual(["text"]);
		expect(m.contextWindow).toBe(1_000_000);
		expect(m.maxTokens).toBe(128_000);
	});

	test("glm-5v-turbo multimodal 200k", () => {
		const m = resolveModelMetadata("glm-5v-turbo");
		expect(m.reasoning).toBe(true);
		expect(m.input).toEqual(["text", "image"]);
		expect(m.contextWindow).toBe(200_000);
		expect(m.maxTokens).toBe(131_072);
	});

	test("kimi-k3: 1M native context, reasoning, image", () => {
		const m = resolveModelMetadata("kimi-k3");
		expect(m.reasoning).toBe(true);
		expect(m.input).toEqual(["text", "image"]);
		expect(m.contextWindow).toBe(1_048_576);
		expect(m.maxTokens).toBe(131_072);
	});

	test("kimi-k3 carries moonshot tool schema flavor and max-effort thinkingLevelMap", () => {
		const model = toProviderModel(
			{ id: "kimi-k3", owned_by: "moonshot" },
			{ baseUrl: "http://x", apiKey: "k", contextOverrides: {}, maxTokensOverrides: {} },
		);
		expect(model.compat.toolSchemaFlavor).toBe("moonshot-mfjs");
		// Vendor vocab is low|high|max only — medium/xhigh must stay unsupported.
		expect(model.thinkingLevelMap).toEqual({
			off: null,
			minimal: null,
			low: "low",
			medium: null,
			high: "high",
			xhigh: null,
			max: "max",
		});
	});

	test("grok-4.5 maps session max/xhigh thinking to wire high", () => {
		const model = toProviderModel(
			{ id: "grok-4.5", owned_by: "xai" },
			{ baseUrl: "http://x", apiKey: "k", contextOverrides: {}, maxTokensOverrides: {} },
		);
		// xhigh is grok-4.6+; grok-4.5 treats xhigh as high.
		expect(model.thinkingLevelMap).toEqual({
			off: null,
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "high",
			max: "high",
		});
	});

	test("grok-4.6 maps session max thinking to wire xhigh", () => {
		const model = toProviderModel(
			{ id: "grok-4.6", owned_by: "xai" },
			{ baseUrl: "http://x", apiKey: "k", contextOverrides: {}, maxTokensOverrides: {} },
		);
		// Grok 4.6 has no `max` effort; Senpi defaultThinkingLevel=max must become xhigh.
		expect(model.thinkingLevelMap).toEqual({
			off: null,
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "xhigh",
		});
	});

	test("gpt-5.5 uses the observed 272K CLIProxy effective context", () => {
		const m = resolveModelMetadata("gpt-5.5");
		expect(m.contextWindow).toBe(272_000);
		expect(m.maxTokens).toBe(128_000);
	});

	test("gpt-6-astra follows the official 1.05M OpenAI context", () => {
		const m = resolveModelMetadata("gpt-6-astra");
		expect(m.reasoning).toBe(true);
		expect(m.input).toEqual(["text", "image"]);
		expect(m.contextWindow).toBe(1_050_000);
		expect(m.maxTokens).toBe(128_000);
	});

	test("gpt-5.6-sol uses the Codex subscription context limit", () => {
		const m = resolveModelMetadata("gpt-5.6-sol");
		expect(m.contextWindow).toBe(1_000_000);
		expect(m.maxTokens).toBe(128_000);
	});

	test("claude-opus-4-6-thinking follows the live antigravity 200K route", () => {
		const m = resolveModelMetadata("claude-opus-4-6-thinking");
		expect(m.contextWindow).toBe(200_000);
		expect(m.maxTokens).toBe(64_000);
	});

	test("claude-sonnet-4-6 follows the live 200K route", () => {
		const m = resolveModelMetadata("claude-sonnet-4-6");
		expect(m.contextWindow).toBe(200_000);
		expect(m.maxTokens).toBe(64_000);
	});

	test("gpt-5.4 uses the live 1.05M Codex route and fast inherits it", () => {
		expect(resolveModelMetadata("gpt-5.4").contextWindow).toBe(1_050_000);
		expect(resolveModelMetadata("gpt-5.4-fast").contextWindow).toBe(1_050_000);
	});

	test("grok-4.20-0309-reasoning uses the live 2M route", () => {
		const m = resolveModelMetadata("grok-4.20-0309-reasoning");
		expect(m.contextWindow).toBe(2_000_000);
		expect(m.maxTokens).toBe(65_536);
	});

	test("grok-4.20-multi-agent-0309 uses the live 2M route", () => {
		const m = resolveModelMetadata("grok-4.20-multi-agent-0309");
		expect(m.contextWindow).toBe(2_000_000);
		expect(m.maxTokens).toBe(65_536);
	});

	test("grok-4.20-0309-non-reasoning uses the live 2M route", () => {
		const m = resolveModelMetadata("grok-4.20-0309-non-reasoning");
		expect(m.contextWindow).toBe(2_000_000);
		expect(m.maxTokens).toBe(65_536);
	});

	test("grok-composer-2.5-fast follows the live 200K route", () => {
		const m = resolveModelMetadata("grok-composer-2.5-fast");
		expect(m.contextWindow).toBe(200_000);
		expect(m.maxTokens).toBe(32_768);
	});

	test("gpt-oss-120b-medium follows the live 114K route", () => {
		const m = resolveModelMetadata("gpt-oss-120b-medium");
		expect(m.contextWindow).toBe(114_000);
		expect(m.maxTokens).toBe(32_768);
	});

	test("dated 200K claude models get explicit entries, not the 1M fallback", () => {
		expect(resolveModelMetadata("claude-haiku-4-5-20251001")).toMatchObject({ contextWindow: 200_000, maxTokens: 64_000 });
		expect(resolveModelMetadata("claude-opus-4-1-20250805")).toMatchObject({ contextWindow: 200_000, maxTokens: 32_000 });
		expect(resolveModelMetadata("claude-opus-4-20250514")).toMatchObject({ contextWindow: 200_000, maxTokens: 32_000 });
		expect(resolveModelMetadata("claude-opus-4-5-20251101")).toMatchObject({ contextWindow: 200_000, maxTokens: 64_000 });
		expect(resolveModelMetadata("claude-sonnet-4-20250514")).toMatchObject({ contextWindow: 200_000, maxTokens: 64_000 });
		expect(resolveModelMetadata("claude-sonnet-4-5-20250929")).toMatchObject({ contextWindow: 200_000, maxTokens: 64_000 });
		expect(resolveModelMetadata("claude-3-5-haiku-20241022")).toMatchObject({ contextWindow: 128_000, maxTokens: 8_192 });
		expect(resolveModelMetadata("claude-3-7-sonnet-20250219")).toMatchObject({ contextWindow: 128_000, maxTokens: 8_192 });
	});

	test("gpt fast ids inherit their live base-model metadata and overrides", () => {
		const metadata = resolveModelMetadata("gpt-5.4-mini-fast");
		expect(metadata.contextWindow).toBe(400_000);
		expect(metadata.input).toEqual(["text", "image"]);
		const model = toProviderModel(
			{ id: "gpt-5.6-sol-fast", owned_by: "openai" },
			{
				baseUrl: "http://x",
				apiKey: "k",
				contextOverrides: { "gpt-5.6-sol": 360_000 },
				maxTokensOverrides: { "gpt-5.6-sol": 120_000 },
			},
		);
		expect(model.contextWindow).toBe(360_000);
		expect(model.maxTokens).toBe(120_000);
	});

});
