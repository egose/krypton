#!/usr/bin/env bash
# Wait until Dex serves its OIDC discovery document.
# Usage: DEX_URL=http://localhost:5556/dex ./sandbox/scripts/wait-for-dex.sh
set -euo pipefail

DEX_URL="${DEX_URL:-http://localhost:5556/dex}"
TIMEOUT="${WAIT_TIMEOUT:-120}"

echo -n "Waiting for Dex at $DEX_URL "
deadline=$((SECONDS + TIMEOUT))
until curl -sf -m 3 "$DEX_URL/.well-known/openid-configuration" >/dev/null 2>&1; do
  if ((SECONDS >= deadline)); then
    echo; echo "Dex did not become ready within ${TIMEOUT}s" >&2
    exit 1
  fi
  echo -n .
  sleep 2
done
echo " ready"
