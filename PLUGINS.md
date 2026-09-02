# Dual host: Senpi/pi-agent + Grokomo/GrokBuild

This repo ships **one catalog SSOT** and **two runtimes**:

| Surface | Artifact | Install |
|---------|----------|---------|
| **Senpi / pi-agent variants** (TS coding-agent) | `index.ts` extension | `senpi install .` or `./scripts/install-all.sh` |
| **Grokomo / GrokBuild CLI variants** (rust `grok` plugin host) | `plugins/grok/cliproxy-api-provider` | `grokomo plugin install ./plugins/grok/cliproxy-api-provider` or `./scripts/install-all.sh` |

## Shared SSOT

- `~/.agents/references/model-catalog.json` — context windows, reasoning, modalities
  (also at `~/.grok/references/model-catalog.json` via symlink)
- Live model **ids** always come from CLIProxy `/v1/models`

## Senpi / pi-agent path

Registers a single `cliproxy` provider (openai-completions + `/v1`) via `registerProvider`,
using `MODEL_METADATA` mirrored from the catalog.

```bash
senpi install .
senpi --list-models grok-4.6 --provider cliproxy
senpi --provider cliproxy --model grok-4.6
senpi --provider cliproxy --model glm-5.2
senpi --provider cliproxy --model kimi-k3
```

Legacy CLIs that still expose `pi install` are supported by the same `index.ts` extension.

## Grokomo / GrokBuild path

Plugin writes managed `[model.*]` tables into `~/.grok/config.toml` from the catalog
so reasoning effort + context windows work when `[endpoints] models_base_url` points at CLIProxy.

```bash
grokomo plugin install ./plugins/grok/cliproxy-api-provider
# ensure enabled in ~/.grok/config.user.toml:
#   [plugins]
#   enabled = ["lfg", "cliproxy-api-provider"]
node ./plugins/grok/cliproxy-api-provider/scripts/sync-models.mjs --force
```

Generic `grok` CLIs that expose the same plugin commands are also supported.

Slash command inside Grokomo/GrokBuild: `/cliproxy-sync`

## One-shot

```bash
./scripts/install-all.sh
```
