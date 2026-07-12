#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace_launcher="$root_dir/../scripts/demo.sh"

if [[ -x "$workspace_launcher" ]]; then
  exec "$workspace_launcher"
fi

echo "Workspace launcher not found; starting the standalone agent only." >&2
echo "Configure reachable MERCHANT_BASE_URL and PAYMENT_HANDLER_MODULE_URL values in .env." >&2
exec "$root_dir/scripts/dev.sh"
