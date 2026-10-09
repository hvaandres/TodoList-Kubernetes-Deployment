#!/usr/bin/env bash
# Installs (or upgrades) Loki and the Alloy log collector into the current
# Kubernetes cluster, in their own namespace.
#
# Usage:
#   ./install.sh
#
# Optional env vars: NAMESPACE (default: logging)
#
# Note: alloy-values.yaml and Grafana's Loki datasource hardcode the Loki URL
# http://loki.logging.svc.cluster.local:3100. If you change NAMESPACE or the
# Loki release name, update both files too.
set -euo pipefail

NAMESPACE="${NAMESPACE:-logging}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! kubectl config current-context >/dev/null 2>&1; then
  echo "No kubectl context set. Start a cluster (e.g. 'minikube start') or select a context first." >&2
  exit 1
fi

helm repo add grafana-community https://grafana-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo add grafana https://grafana.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update grafana-community grafana

helm upgrade --install loki grafana-community/loki \
  --namespace "$NAMESPACE" --create-namespace \
  -f "$SCRIPT_DIR/values.yaml" \
  --wait --timeout 10m

helm upgrade --install alloy grafana/alloy \
  --namespace "$NAMESPACE" \
  -f "$SCRIPT_DIR/alloy-values.yaml" \
  --wait --timeout 5m

cat <<EOF

Loki and Alloy installed in namespace '$NAMESPACE'.

Next: (re)install Grafana so it gets the Loki datasource and the logs dashboard:
  (cd "$SCRIPT_DIR/../grafana" && ./install.sh)

Check Loki is ready:
  kubectl -n $NAMESPACE get pods
EOF
