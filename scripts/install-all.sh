#!/usr/bin/env bash
# Install cli-proxy-adapter for both supported host families:
#   - senpi / pi-agent variants (TS extension: index.ts)
#   - grokomo / GrokBuild CLI variants (cliproxy-api-provider plugin)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GROK_PLUGIN_SRC="$ROOT/plugins/grok/cliproxy-api-provider"

echo "[install] senpi/pi-agent extension from $ROOT"
PI_FOUND=false
for PI_CLI in senpi pi; do
  if ! command -v "$PI_CLI" >/dev/null 2>&1; then
    continue
  fi
  PI_FOUND=true
  if ! "$PI_CLI" install "$ROOT"; then
    if [ "$PI_CLI" = "senpi" ]; then
      PI_HOME="$HOME/.senpi"
    else
      PI_HOME="$HOME/.pi"
    fi
    echo "[install] $PI_CLI install failed; falling back to $PI_HOME symlink"
    mkdir -p "$PI_HOME/agent/extensions/cliproxy"
    ln -sfn "$ROOT/index.ts" "$PI_HOME/agent/extensions/cliproxy/index.ts"
  fi
done
if [ "$PI_FOUND" = false ]; then
  echo "[install] senpi/pi CLI not found; writing both extension fallbacks"
  for PI_HOME in "$HOME/.senpi" "$HOME/.pi"; do
    mkdir -p "$PI_HOME/agent/extensions/cliproxy"
    ln -sfn "$ROOT/index.ts" "$PI_HOME/agent/extensions/cliproxy/index.ts"
  done
fi

echo "[install] grokomo/GrokBuild plugin from $GROK_PLUGIN_SRC"
GROK_FOUND=false
for HOST_SPEC in "grokomo:$HOME/.grokomo" "grok:$HOME/.grok"; do
  GROK_CLI="${HOST_SPEC%%:*}"
  HOST_HOME="${HOST_SPEC#*:}"
  if ! command -v "$GROK_CLI" >/dev/null 2>&1; then
    continue
  fi
  GROK_FOUND=true
  if GROK_HOME="$HOST_HOME" "$GROK_CLI" plugin list 2>/dev/null | grep -q 'cliproxy-api-provider'; then
    GROK_HOME="$HOST_HOME" "$GROK_CLI" plugin uninstall cliproxy-api-provider 2>/dev/null || true
  fi
  if [ -e "$HOST_HOME/plugins/cliproxy-api-provider" ] && [ ! -L "$HOST_HOME/plugins/cliproxy-api-provider" ]; then
    ts=$(date +%Y%m%d%H%M%S)
    mv "$HOST_HOME/plugins/cliproxy-api-provider" "$HOST_HOME/plugins/cliproxy-api-provider.bak-$ts"
    echo "[install] backed up existing unmanaged $GROK_CLI plugin -> cliproxy-api-provider.bak-$ts"
  fi
  if ! GROK_HOME="$HOST_HOME" "$GROK_CLI" plugin install "$GROK_PLUGIN_SRC" --trust; then
    echo "[install] $GROK_CLI plugin install failed; symlink fallback"
    mkdir -p "$HOST_HOME/plugins"
    ln -sfn "$GROK_PLUGIN_SRC" "$HOST_HOME/plugins/cliproxy-api-provider"
  fi
  GROK_HOME="$HOST_HOME" "$GROK_CLI" plugin enable cliproxy-api-provider 2>/dev/null || true
  echo "[install] sync $GROK_CLI models from catalog"
  GROK_HOME="$HOST_HOME" node "$GROK_PLUGIN_SRC/scripts/sync-models.mjs" --force
done
if [ "$GROK_FOUND" = false ]; then
  echo "[install] grokomo/grok CLI not found; writing both plugin fallbacks"
  for HOST_HOME in "$HOME/.grokomo" "$HOME/.grok"; do
    mkdir -p "$HOST_HOME/plugins"
    ln -sfn "$GROK_PLUGIN_SRC" "$HOST_HOME/plugins/cliproxy-api-provider"
    GROK_HOME="$HOST_HOME" node "$GROK_PLUGIN_SRC/scripts/sync-models.mjs" --force
  done
fi

echo "[install] done"
echo "  senpi/pi-agent: senpi --list-models grok-4.6 --provider cliproxy"
echo "  grokomo/GrokBuild: open TUI and pick CLIProxy grok-4.6 (defaultModel=grok-4.6)"
