# cli-proxy-adapter

**This is [islee23520/cli-proxy-adapter](https://github.com/islee23520/cli-proxy-adapter)**
(renamed from `pi-proxy-models`) — a maintained fork of
[victormilk/pi-proxy-models](https://github.com/victormilk/pi-proxy-models).
Development for this line lives on this repo only.

Bridge that exposes [CLIProxyAPIPlus](https://github.com/router-for-me/CLIProxyAPIPlus)
models to **two CLI-tool host families** from one repo:

| Host | What you install | Artifact |
|------|------------------|----------|
| **Senpi / pi-agent variants** ([pi-coding-agent](https://github.com/badlogic/pi-mono)) | TypeScript extension | `index.ts` |
| **Grokomo / GrokBuild CLI variants** (rust `grok` plugin host) | Grok plugin | `plugins/grok/cliproxy-api-provider` |

Log in once inside CLIProxyAPIPlus (Claude Code, Gemini CLI, OpenAI Codex,
Copilot, Kiro, GLM, Kimi, …). Both hosts then consume those subscriptions
through CLIProxy’s unified OpenAI-compatible `/v1` surface.

Shared catalog SSOT: `~/.agents/references/model-catalog.json`  
(live model **ids** still come from CLIProxy `/v1/models`).

## Prerequisite: CLIProxyAPIPlus

Both install paths need a running proxy. See the
[CLIProxyAPIPlus README](https://github.com/router-for-me/CLIProxyAPIPlus)
for Docker / compose setup.

Quick check:

```bash
curl -s "$CLIPROXY_URL/v1/models" | jq '.data | length'
# or, if your proxy is local:
# curl -s http://127.0.0.1:8317/v1/models | jq '.data | length'
```

There is **no hardcoded default URL**. You must set the base URL via env or
config for each host (see below).

---

## Install for Senpi / pi-agent variants

Registers a single provider name: **`cliproxy`**
(`openai-completions` + `/v1`). Every discovered model appears under it
(e.g. `cliproxy/kimi-k3`, `cliproxy/grok-4.5`).

### 1. Install the extension

From this repo root:

```bash
# preferred
senpi install .

# legacy pi-agent CLI
pi install .

# fallback if `pi install` is unavailable
mkdir -p ~/.pi/agent/extensions/cliproxy
ln -sfn "$(pwd)/index.ts" ~/.pi/agent/extensions/cliproxy/index.ts
```

One-shot test without installing:

```bash
pi -e ./index.ts
```

### 2. Configure the proxy URL

First match wins:

1. `CLIPROXY_URL` / `CLIPROXY_API_KEY`
2. `~/.senpi/agent/cliproxy.json`
3. `~/.pi/agent/cliproxy.json` for legacy pi-agent CLIs

Env:

```bash
export CLIPROXY_URL=https://your-proxy.example.com
export CLIPROXY_API_KEY=your-key   # optional if proxy has empty api-keys
```

Or file (`~/.senpi/agent/cliproxy.json`):

```json
{
  "baseUrl": "https://your-proxy.example.com",
  "apiKey": "your-key"
}
```

Missing API key is tolerated (placeholder is sent). If the proxy’s
`api-keys:` list is non-empty, set a matching key.

### 3. Use it

```bash
senpi --list-models cliproxy
senpi --provider cliproxy --model kimi-k3
senpi --provider cliproxy --model grok-4.5
senpi --provider cliproxy --model glm-5.2
```

In a session: `Ctrl+P` / `/model`, then pick a `cliproxy/…` model.

| Slash command | Effect |
|---------------|--------|
| `/cliproxy-status` | Ping proxy, model count, auth info |
| `/cliproxy-models` | List models grouped by `owned_by` |
| `/cliproxy-refresh` | Re-fetch `/v1/models` and re-register |

Legacy provider names `cliproxy-openai` and `cliproxy-gemini` are unregistered
on load and on `/cliproxy-refresh`.

Each model carries a shared compat block so backends that reject OpenAI-only
fields (e.g. Kimi K3) still tokenize cleanly:
`supportsStore: false`, `supportsDeveloperRole: false`,
`maxTokensField: "max_tokens"`, plus reasoning-effort where supported.

---

## Install for Grokomo / GrokBuild CLI variants

Installs the **`cliproxy-api-provider`** plugin. It keeps
`~/.grok/config.toml` `[model.*]` tables in sync with the catalog + live
`/v1/models`, so context windows and reasoning effort work when
`[endpoints].models_base_url` points at CLIProxy.

### 1. Install the plugin

From this repo root:

```bash
grokomo plugin install ./plugins/grok/cliproxy-api-provider --trust
grokomo plugin enable cliproxy-api-provider

# generic rust GrokBuild host CLIs with the same plugin API also work
grok plugin install ./plugins/grok/cliproxy-api-provider --trust
grok plugin enable cliproxy-api-provider
```

Fallback if the CLI cannot install:

```bash
mkdir -p ~/.grok/plugins
ln -sfn "$(pwd)/plugins/grok/cliproxy-api-provider" \
  ~/.grok/plugins/cliproxy-api-provider
```

### 2. Enable in user config

`~/.grok/config.user.toml`:

```toml
[plugins]
enabled = ["lfg", "cliproxy-api-provider"]
```

### 3. Point Grok at CLIProxy

Either set env for the sync script:

```bash
export CLIPROXY_BASE_URL=https://your-proxy.example.com/v1
export XAI_API_KEY=your-key   # if the proxy requires it
```

or leave `baseUrl` unset and reuse an existing
`[endpoints].models_base_url` in `~/.grok/config.toml`, or set plugin
config (`~/.grok/plugin-data/cliproxy-api-provider/config.json` or the
plugin’s `config.json`):

```json
{
  "baseUrl": "https://your-proxy.example.com/v1",
  "defaultModel": "grok-4.5",
  "webSearch": "grok-4.20-multi-agent-0309",
  "defaultReasoningEffort": "high",
  "envKey": "XAI_API_KEY"
}
```

### 4. Sync models

```bash
node ./plugins/grok/cliproxy-api-provider/scripts/sync-models.mjs --force
```

After install, SessionStart also runs the sync. In a Grok session:
`/cliproxy-sync`.

Then open Grok and pick a CLIProxy model (default pin: `grok-4.5`).

Deeper layout / catalog editing: [PLUGINS.md](./PLUGINS.md) and
[plugins/grok/cliproxy-api-provider/README.md](./plugins/grok/cliproxy-api-provider/README.md).

---

## Install both (pi agent + Grok)

```bash
git clone https://github.com/islee23520/cli-proxy-adapter.git
cd cli-proxy-adapter
./scripts/install-all.sh
```

That script:

1. Installs the pi extension (`pi install .` or symlink fallback)
2. Installs/enables the Grok plugin (or symlink fallback)
3. Ensures `cliproxy-api-provider` is in `[plugins].enabled`
4. Runs `sync-models.mjs --force`

You still must set **pi** `CLIPROXY_URL` / `~/.pi/agent/cliproxy.json` and
**Grok** `CLIPROXY_BASE_URL` (or plugin / `models_base_url`) yourself.

---

## Behaviour notes

- **Metadata** (`contextWindow`, `maxTokens`, reasoning, image) comes from
  `MODEL_METADATA` / the catalog; costs are `0` (subscription, not token bill).
- **pi startup** — if the proxy is down at load, the extension still registers
  with a static fallback list (no noisy console warn before the host owns I/O).
  Use `/cliproxy-refresh` when the proxy is up.
- **Grok sync** — if the proxy is down, the hook skips and leaves config alone.
- Auth headers are host/SDK-specific; pi does not invent a global Bearer for
  every backend.

## Verifying all host CLIs

`bun test` covers the extension logic. `bun run verify:hosts` additionally
smoke-tests the real host CLIs on this machine — both families, original and
fork: `senpi`/`pi` (pi-agent) and `grokomo`/`grok` (GrokBuild). Every CLI found
on PATH is checked; missing CLIs are reported as SKIP, but a family with no CLI
at all fails. `bun run check` runs both.

## Troubleshooting

**Proxy unreachable (pi)**

```bash
curl -s "${CLIPROXY_URL:-http://127.0.0.1:8317}/v1/models" | jq '.data | length'
```

**`302` / `unauthorized`** — link the upstream account in the proxy `auths/`
dir, or use a key that matches the proxy’s `api-keys:` list.

**Models missing in pi** — `/cliproxy-refresh` or restart `pi`.

**Models wrong in Grok** — re-run:

```bash
node ~/.grok/plugins/cliproxy-api-provider/scripts/sync-models.mjs --force
```

**`baseUrl not set` (Grok sync)** — set `CLIPROXY_BASE_URL`, plugin
`config.json` `baseUrl`, or `[endpoints].models_base_url` in
`~/.grok/config.toml`.

## License

ISC (package); see upstream project for original licensing context.
