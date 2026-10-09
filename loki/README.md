# Loki and Alloy (log ingestion)

This directory holds the YAML and scripts for log ingestion. Loki stores the
logs, Grafana Alloy collects them from every pod, and Grafana (see `../grafana/`)
queries them.

```text
Todo app pod (JSON on stdout)
  -> Alloy (DaemonSet) tails pod logs
  -> Loki (namespace: logging)
  -> Grafana (namespace: monitoring) "Todo App Logs" dashboard
```

## Files

- `values.yaml`: Helm values for `grafana-community/loki`. Single binary,
  filesystem storage on a 5Gi PVC, no auth, 7 day retention. Sized for
  Minikube, not production.
- `alloy-values.yaml`: Helm values for `grafana/alloy`. Contains the Alloy
  pipeline: discover pods on the node, label them, parse the Todo app's JSON
  `level`, and push to Loki.
- `install.sh`: Installs or upgrades both releases in the `logging` namespace.

Loki and Alloy run in their own `logging` namespace, separate from
`monitoring` (Prometheus, Grafana) and `default` (the Todo app).

## Prerequisites

- A running Kubernetes cluster and selected `kubectl` context
- Helm and `kubectl`

## Install

```bash
./install.sh
kubectl -n logging get pods,svc,pvc
```

Then install or upgrade Grafana so it picks up the Loki datasource and the
logs dashboard:

```bash
cd ../grafana
./install.sh
```

## What gets collected

Alloy collects logs from every pod in the cluster and adds these labels:
`namespace`, `pod`, `container`, `app` and `instance`.

For the Todo app (`namespace="default"`, `app="todo-list"`) the log level is
also promoted to a `level` label. The app writes one JSON object per line:

```json
{"time":"2026-10-09T15:29:50.922Z","level":"info","msg":"todo_event","event":"todo_created"}
```

Todo text and IDs are never logged.

## Query logs

In Grafana, open **Explore**, pick the **Loki** datasource and try:

```logql
{namespace="default", app="todo-list"}
{namespace="default", app="todo-list", level="error"}
{namespace="default", app="todo-list"} | json | msg="todo_event"
sum by (event) (count_over_time({namespace="default", app="todo-list"} | json | msg="todo_event" [5m]))
```

Or query Loki directly:

```bash
kubectl -n logging port-forward svc/loki 3100:3100
curl -G http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode 'query={namespace="default", app="todo-list"}' \
  --data-urlencode 'limit=5'
```

## Troubleshooting

- Loki not ready: `kubectl -n logging logs statefulset/loki`
- No logs arriving: `kubectl -n logging logs daemonset/alloy`
- Empty Todo app dashboards: confirm the app image is the one that writes JSON
  logs (tag `logging` or newer) and that `kubectl logs deploy/todo-app-todo-list`
  shows JSON lines.

## Uninstall

```bash
helm -n logging uninstall alloy
helm -n logging uninstall loki
kubectl delete namespace logging
```

The Loki PVC is deleted with the namespace, so stored logs are lost.
