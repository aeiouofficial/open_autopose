#!/usr/bin/env bash
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null || { echo "Node.js 20.19 or newer is required. Get it from https://nodejs.org/" >&2; exit 1; }
if [[ ! -d node_modules ]]; then
  echo "The local REST gateway is an optional advanced feature that needs a one-time" >&2
  echo "dependency install with internet access:  npm install" >&2
  echo "The offline app itself does NOT need this - use Start_App instead." >&2
  exit 1
fi
export TP_RENDER_MODE="${TP_RENDER_MODE:-dryrun}"
exec npm run gateway -- --host 127.0.0.1 --port 8787
