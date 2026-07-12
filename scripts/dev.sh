#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$root_dir/.env" ]]; then
  set -a
  source "$root_dir/.env"
  set +a
fi

cleanup() {
  kill "$service_pid" "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

uv run --project "$root_dir/service" \
  uvicorn ucp_shopping_agent.main:app \
  --app-dir "$root_dir/service/src" --reload --host 127.0.0.1 --port 8000 &
service_pid=$!

npm --prefix "$root_dir/web" run dev &
web_pid=$!

# Portable to macOS Bash 3.2 (which has no `wait -n`).
wait "$service_pid"
