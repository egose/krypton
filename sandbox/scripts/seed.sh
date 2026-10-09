#!/usr/bin/env bash
# Apply sandbox fixtures to the kind cluster (idempotent).
# Usage: ./sandbox/scripts/seed.sh [kubecontext]   (default kind-krypton-sandbox)
set -euo pipefail

CONTEXT="${1:-${KIND_CONTEXT:-kind-krypton-sandbox}}"
FIXTURES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../kind/fixtures" && pwd)"

command -v kubectl >/dev/null || { echo "kubectl not found in PATH" >&2; exit 1; }
kubectl config get-contexts "$CONTEXT" >/dev/null 2>&1 \
  || { echo "kubecontext '$CONTEXT' not found — run 'make kind-up' first" >&2; exit 1; }

kubectl --context "$CONTEXT" apply -f "$FIXTURES_DIR"

echo
echo "Seeded fixtures on context '$CONTEXT':"
kubectl --context "$CONTEXT" get secrets,deployments -n krypton-test
kubectl --context "$CONTEXT" get secrets -n frontend-ns
