#!/usr/bin/env bash
# Browser checks use explicit local fixtures. No request can reach the business API.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build --workspace @trustguard/web
cd apps/web
export TRUSTGUARD_WEB_URL=http://127.0.0.1:3187
export TRUSTGUARD_API_BASE_URL=https://127.0.0.1:1/api/v1
node ../../node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3187 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for attempt in {1..50}; do
  kill -0 "$server"
  if curl -fsS "$TRUSTGUARD_WEB_URL/identity" -o /dev/null 2>/dev/null; then break; fi
  sleep 0.3
done
kill -0 "$server"
../../node_modules/.bin/playwright test tests/v21.spec.ts --output="$(mktemp -d)" --reporter=line
