#!/usr/bin/env bash
# Exposes the Todo app and Grafana on localhost until you press Ctrl+C.
#
#   Todo app: http://localhost:3000
#   Grafana:  http://localhost:3001  (user: admin)
#
# Usage: ./port-forward.sh
set -uo pipefail

APP_PORT="${APP_PORT:-3000}"
GRAFANA_PORT="${GRAFANA_PORT:-3001}"

pids=()
cleanup() {
  kill "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

kubectl port-forward svc/todo-app-todo-list "${APP_PORT}:3000" &
pids+=($!)
kubectl -n monitoring port-forward svc/grafana "${GRAFANA_PORT}:80" &
pids+=($!)

echo "Todo app: http://localhost:${APP_PORT}"
echo "Grafana:  http://localhost:${GRAFANA_PORT}"
echo "Press Ctrl+C to stop."

wait
