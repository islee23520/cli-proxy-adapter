# Changelog

## Unreleased - 2026-09-08

- Rename the pi provider id `cliproxy` to `cpa`; legacy `cliproxy`, `cliproxy-openai` and `cliproxy-gemini` entries unregister on load and refresh.
- Rename slash commands to `/cpa-status`, `/cpa-models`, `/cpa-refresh`; the `PI_IMAGE_GEN_PROVIDER` pin now resolves to `cpa`.

## v0.2.1 - 2026-09-04

- Register GPT-5.6 Luna, Sol, Terra, and fast variants with a 1,000,000-token total context budget for Senpi/pi hosts.
- Keep the 128,000-token output allowance, yielding an 872,000-token prompt budget on the Pro Codex route.
