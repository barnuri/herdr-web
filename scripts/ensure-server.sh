#!/usr/bin/env bash
# Idempotent supervisor for server.js.
#
# herdr spawns [[startup]] processes only when its own server boots, and never
# restarts one that dies. This script is wired to [[events]] hooks in
# herdr-plugin.toml, so a crashed web server heals on the next UI interaction.
# It runs on every pane focus, so it stays silent and does the cheapest
# possible liveness check: one HTTP request to the configured port.
set -uo pipefail

PLUGIN_ID="barnuri.herdr-web"
PLUGIN_DIR="${HERDR_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CONFIG_DIR="${HERDR_PLUGIN_CONFIG_DIR:-$HOME/.config/herdr/plugins/config/$PLUGIN_ID}"
# herdr 0.9.5 gives [[events]] hooks a different HERDR_PLUGIN_STATE_DIR
# (~/.local/state/herdr/plugins/<id>) than [[startup]] (~/.config/herdr/plugins/state/<id>).
# The server keeps its push subscriptions and certs there, so pin the startup one and
# ignore the hook's value. HERDR_WEB_STATE_DIR overrides it (tests).
STATE_DIR="${HERDR_WEB_STATE_DIR:-$HOME/.config/herdr/plugins/state/$PLUGIN_ID}"
STALE_LOCK_MINUTES=1
START_WAIT_SECONDS=10

LOCK_DIR="$STATE_DIR/ensure.lock"
SERVER_LOG="$STATE_DIR/server.log"
CONFIG_FILE="$CONFIG_DIR/config.json"

# Same precedence as lib/config.js: HERDR_WEB_PORT/HOST, then config.json, then the defaults.
json_value() {
  [ -f "$CONFIG_FILE" ] || return 0
  grep -o "\"$1\"[[:space:]]*:[[:space:]]*[^,}]*" "$CONFIG_FILE" 2>/dev/null | head -n 1 |
    sed -e 's/^[^:]*:[[:space:]]*//' -e 's/"//g' -e 's/[[:space:]]*$//'
}

PORT="${HERDR_WEB_PORT:-$(json_value port)}"
case "$PORT" in '' | *[!0-9]*) PORT=7936 ;; esac
HOST="${HERDR_WEB_HOST:-$(json_value host)}"
case "$HOST" in '' | 0.0.0.0 | '::' | '[::]') HOST=127.0.0.1 ;; esac

is_server_up() {
  curl -s -o /dev/null --max-time 2 "http://$HOST:$PORT/"
}

is_server_up && exit 0

command -v node >/dev/null 2>&1 || exit 0
[ -f "$PLUGIN_DIR/server.js" ] || exit 0

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# a lock left behind by a killed run would block healing forever
if [ -d "$LOCK_DIR" ] && [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin "+$STALE_LOCK_MINUTES" 2>/dev/null)" ]; then
  rmdir "$LOCK_DIR" 2>/dev/null
fi

# mkdir is atomic, so concurrent pane.focused hooks cannot both win the spawn
mkdir "$LOCK_DIR" 2>/dev/null || exit 0
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

# another hook may have started the server between our first check and the lock
is_server_up && exit 0

printf '%s herdr-web: not answering on %s:%s, starting server.js\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$HOST" "$PORT" >>"$SERVER_LOG"

# Same env and launch shape herdr uses for [[startup]] (relative `node server.js`
# from the plugin dir), so the restart recipe in CLAUDE.md still finds it.
(
  cd "$PLUGIN_DIR" || exit 0
  export HERDR_ENV=1
  export HERDR_PLUGIN_ID="$PLUGIN_ID"
  export HERDR_PLUGIN_ROOT="$PLUGIN_DIR"
  export HERDR_PLUGIN_CONFIG_DIR="$CONFIG_DIR"
  export HERDR_PLUGIN_STATE_DIR="$STATE_DIR"
  export HERDR_PLUGIN_EVENT=startup
  unset HERDR_PLUGIN_EVENT_JSON
  export HERDR_SOCKET_PATH="${HERDR_SOCKET_PATH:-$HOME/.config/herdr/herdr.sock}"
  if [ -z "${HERDR_BIN_PATH:-}" ]; then
    HERDR_BIN_PATH="$(command -v herdr 2>/dev/null || true)"
    [ -n "$HERDR_BIN_PATH" ] && export HERDR_BIN_PATH
  fi
  nohup node server.js </dev/null >>"$SERVER_LOG" 2>&1 &
  disown 2>/dev/null || true
)

# hold the lock until the new server answers, so the next focus does not spawn a twin
for _ in $(seq 1 $((START_WAIT_SECONDS * 4))); do
  is_server_up && exit 0
  sleep 0.25
done
exit 0
