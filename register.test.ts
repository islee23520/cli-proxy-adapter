import { describe, expect, mock, spyOn, test } from "bun:test";
import registerExtension, { planRegistration } from "./index.ts";

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
});
