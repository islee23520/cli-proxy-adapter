# Changelog

## Unreleased - 2026-09-08

- Align GPT-5.6 Luna, Sol, Terra, and fast variants with OpenAI's official 1,050,000-token context window and 128,000-token output limit across pi and Grok-family hosts.
- Remove the adapter's 850,000-token context-window ceiling so model metadata and configured overrides are registered unchanged.
- Rename the pi provider id `cliproxy` to `cpa`; legacy `cliproxy`, `cliproxy-openai` and `cliproxy-gemini` entries unregister on load and refresh.
- Rename slash commands to `/cpa-status`, `/cpa-models`, `/cpa-refresh`; the `PI_IMAGE_GEN_PROVIDER` pin now resolves to `cpa`.

## v0.2.1 - 2026-09-04

- Register GPT-5.6 Luna, Sol, Terra, and fast variants with a 1,000,000-token total context budget for Senpi/pi hosts.
- Keep the 128,000-token output allowance, yielding an 872,000-token prompt budget on the Pro Codex route.
