# Changelog

## Unreleased - 2026-09-23

- CPA credentials now come from `CLIPROXY_API_KEY`, else the `cpa` entry in `~/.omo/auth.json`; `cliproxy.json` no longer supplies an API key (upstream `fix/cpa-auth-json-credential`).
- Synced upstream PR #2: `gptFastModels` allowlist in `cliproxy.json` and the `gpt-6-luna-fast` alias that routes to `gpt-6-luna` with `service_tier: "priority"`.

## Unreleased - 2026-09-22

- Register `grok-4.7` at the documented 500k context. Grok 4.3, 4.5, 4.6, and 4.7 expose only `low`/`medium`/`high` in the OMO picker; `xhigh` and `max` are not selectable.
- Set Grok 4.20 context windows to the documented 1M. Reasoning and multi-agent ids keep every OMO thinking level selectable and send no reasoning effort.
- Read `~/.omo/cliproxy.json` before `~/.senpi/agent/cliproxy.json` and `~/.pi/agent/cliproxy.json`.

## Unreleased - 2026-09-08

- Align GPT-5.6 Luna, Sol, Terra, and fast variants with OpenAI's official 1,050,000-token context window and 128,000-token output limit across pi and Grok-family hosts.
- Remove the adapter's 850,000-token context-window ceiling so model metadata and configured overrides are registered unchanged.
- Rename the pi provider id `cliproxy` to `cpa`; legacy `cliproxy`, `cliproxy-openai` and `cliproxy-gemini` entries unregister on load and refresh.
- Rename slash commands to `/cpa-status`, `/cpa-models`, `/cpa-refresh`; the `PI_IMAGE_GEN_PROVIDER` pin now resolves to `cpa`.

## v0.2.1 - 2026-09-04

- Register GPT-5.6 Luna, Sol, Terra, and fast variants with a 1,000,000-token total context budget for Senpi/pi hosts.
- Keep the 128,000-token output allowance, yielding an 872,000-token prompt budget on the Pro Codex route.
