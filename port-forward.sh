#!/usr/bin/env bash
# Exposes the Todo app, Grafana and Kibana on localhost until you press Ctrl+C.
#
#   Todo app: http://localhost:3000
#   Grafana:  http://localhost:3001  (user: admin)
#   Kibana:   http://localhost:5601  (user: elastic)
#
# Usage: ./port-forward.sh
set -uo pipefail

APP_PORT="${APP_PORT:-3000}"
GRAFANA_PORT="${GRAFANA_PORT:-3001}"
KIBANA_PORT="${KIBANA_PORT:-5601}"

pids=()
cleanup() {
  kill "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

kubectl port-forward svc/todo-app-todo-list "${APP_PORT}:3000" &
pids+=($!)
kubectl -n monitoring port-forward svc/grafana "${GRAFANA_PORT}:80" &
pids+=($!)
kubectl -n elk port-forward svc/kibana-kb-http "${KIBANA_PORT}:5601" &
pids+=($!)

echo "Todo app: http://localhost:${APP_PORT}"
echo "Grafana:  http://localhost:${GRAFANA_PORT}"
echo "Kibana:   http://localhost:${KIBANA_PORT}"
echo "Press Ctrl+C to stop."

wait
