#!/usr/bin/env bash
# Installs (or upgrades) Grafana into the current Kubernetes cluster.
#
# Usage:
#   GRAFANA_ADMIN_PASSWORD='choose-a-password' ./install.sh
#
# Optional env vars: NAMESPACE (default: monitoring), RELEASE (default: grafana)
set -euo pipefail

NAMESPACE="${NAMESPACE:-monitoring}"
RELEASE="${RELEASE:-grafana}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! kubectl config current-context >/dev/null 2>&1; then
  echo "No kubectl context set. Start a cluster (e.g. 'minikube start') or select a context first." >&2
  exit 1
fi

# Generate a password if none was supplied (only used when the secret doesn't exist yet).
if ! kubectl -n "$NAMESPACE" get secret grafana-admin >/dev/null 2>&1; then
  GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-$(openssl rand -base64 18)}"
  kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n "$NAMESPACE" create secret generic grafana-admin \
    --from-literal=admin-user=admin \
    --from-literal=admin-password="$GRAFANA_ADMIN_PASSWORD"
fi

helm repo add grafana-community https://grafana-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update grafana-community

helm upgrade --install "$RELEASE" grafana-community/grafana \
  --namespace "$NAMESPACE" --create-namespace \
  -f "$SCRIPT_DIR/values.yaml" \
  --wait

for dashboard in "$SCRIPT_DIR"/dashboards/*.json; do
  kubectl -n "$NAMESPACE" create configmap "grafana-dashboard-$(basename "$dashboard" .json)" \
    --from-file="$(basename "$dashboard")=$dashboard" \
    --dry-run=client -o yaml |
    kubectl label --local -f - grafana_dashboard=1 -o yaml |
    kubectl apply -f -
done

cat <<EOF

Grafana installed in namespace '$NAMESPACE'.

Get the admin password:
  kubectl -n $NAMESPACE get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d; echo

Open Grafana at http://localhost:3001:
  kubectl -n $NAMESPACE port-forward svc/$RELEASE 3001:80
EOF
