#!/usr/bin/env bash
# herdr-web development helper (macOS / Linux)
# Usage: scripts/dev.sh [setup|dev|test|build]   (default: dev)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-dev}"

setup() {
    echo "==> installing server deps"
    (cd "$ROOT" && npm install)
    echo "==> installing client deps"
    (cd "$ROOT/client" && npm install)
}

ensure_deps() {
    if [ ! -d "$ROOT/node_modules" ] || [ ! -d "$ROOT/client/node_modules" ]; then
        setup
    fi
}

run_dev() {
    ensure_deps
    echo "==> server on http://127.0.0.1:7936 + vite dev on http://127.0.0.1:5173 (ctrl+c stops both)"
    (cd "$ROOT" && node server.js) &
    SERVER_PID=$!
    trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
    (cd "$ROOT/client" && npm run dev)
}

run_test() {
    ensure_deps
    echo "==> server lib tests"
    (cd "$ROOT" && npm test)
    echo "==> client tests"
    (cd "$ROOT/client" && npm test)
}

run_build() {
    ensure_deps
    echo "==> building client into public/ (commit the result)"
    (cd "$ROOT/client" && npm run build)
}

case "$COMMAND" in
    setup) setup ;;
    dev) run_dev ;;
    test) run_test ;;
    build) run_build ;;
    *)
        echo "usage: scripts/dev.sh [setup|dev|test|build]" >&2
        exit 1
        ;;
esac
