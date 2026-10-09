#!/usr/bin/env bash
# Installs the ECK operator and the ELK stack (Elasticsearch, Kibana, Filebeat)
# into the current Kubernetes cluster, in their own namespaces.
#
# Usage:
#   ./install.sh
#
# Optional env vars:
#   ECK_VERSION  ECK operator chart version (default: 3.5.0)
#   NAMESPACE    namespace for the stack (default: elk; the manifests in this
#                directory hardcode `elk`, so only change it if you edit them too)
set -euo pipefail

ECK_VERSION="${ECK_VERSION:-3.5.0}"
NAMESPACE="${NAMESPACE:-elk}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! kubectl config current-context >/dev/null 2>&1; then
  echo "No kubectl context set. Start a cluster (e.g. 'minikube start') or select a context first." >&2
  exit 1
fi

# 1. ECK operator (CRDs + controller) in its own namespace.
helm repo add elastic https://helm.elastic.co >/dev/null 2>&1 || true
helm repo update elastic
helm upgrade --install elastic-operator elastic/eck-operator \
  --namespace elastic-system --create-namespace \
  --version "$ECK_VERSION" \
  --wait --timeout 5m

# 2. Elasticsearch, Kibana and Filebeat custom resources.
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$SCRIPT_DIR/elasticsearch.yaml"
kubectl apply -f "$SCRIPT_DIR/kibana.yaml"
kubectl apply -f "$SCRIPT_DIR/filebeat.yaml"

# Polls a resource's .status.health until it is green (max 20 minutes).
wait_green() {
  local kind="$1" name="$2" deadline=$((SECONDS + 1200))
  until kubectl -n "$NAMESPACE" get "$kind" "$name" -o jsonpath='{.status.health}' 2>/dev/null | grep -q green; do
    if (( SECONDS > deadline )); then
      echo "Timed out waiting for $kind/$name to become green." >&2
      kubectl -n "$NAMESPACE" get pods >&2 || true
      exit 1
    fi
    sleep 10
  done
}

echo "Waiting for Elasticsearch to become green (first start pulls ~1GB of images)..."
wait_green elasticsearch elasticsearch
echo "Waiting for Kibana..."
wait_green kibana kibana

# 3. Import the Kibana data view and dashboards with an in-cluster Job.
kubectl -n "$NAMESPACE" create configmap kibana-saved-objects \
  --from-file=saved-objects.ndjson="$SCRIPT_DIR/kibana/saved-objects.ndjson" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NAMESPACE" delete job kibana-import --ignore-not-found
kubectl apply -f "$SCRIPT_DIR/kibana-import-job.yaml"
kubectl -n "$NAMESPACE" wait --for=condition=complete job/kibana-import --timeout=5m

cat <<EOF

ELK stack installed in namespace '$NAMESPACE'.

Get the 'elastic' user password:
  kubectl -n $NAMESPACE get secret elasticsearch-es-elastic-user -o jsonpath='{.data.elastic}' | base64 -d; echo

Open Kibana at http://localhost:5601 (user: elastic):
  kubectl -n $NAMESPACE port-forward svc/kibana-kb-http 5601:5601

Check the stack:
  kubectl -n $NAMESPACE get elasticsearch,kibana,beat,pods
EOF
