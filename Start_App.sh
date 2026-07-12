#!/usr/bin/env bash
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null || { echo "Node.js 20.19 or newer is required. Get it from https://nodejs.org/" >&2; exit 1; }
echo "Open AutoPose - starting the offline app (prebuilt, no install needed)."
echo "First run of pose/depth downloads the AI models once (needs internet), then works offline."
URL="http://127.0.0.1:4173/?offline=1"
( sleep 1; if command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 || true; elif command -v open >/dev/null; then open "$URL" >/dev/null 2>&1 || true; fi ) &
exec node scripts/serve-dist.mjs
