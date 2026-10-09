# ELK stack on Kubernetes (ECK)

This directory deploys Elasticsearch, Kibana and Filebeat with the official
Elastic Cloud on Kubernetes (ECK) operator. Everything is a Kubernetes
resource, so the operator handles certificates, passwords, upgrades and
health.

```text
Todo app pod (ECS JSON on stdout)
  -> Filebeat (DaemonSet, namespace elk) tails container logs
  -> Elasticsearch (namespace elk)
  -> Kibana "Todo App Logs" dashboard
```

The operator runs in `elastic-system`, the stack in `elk`, Prometheus and
Grafana in `monitoring`, and the Todo app in `default`.

## Files

- `install.sh`: Installs the ECK operator with Helm, applies the manifests,
  waits for green health, and imports the Kibana dashboards.
- `elasticsearch.yaml`: `Elasticsearch` resource. One node, 2Gi memory, 5Gi
  volume, security on.
- `kibana.yaml`: `Kibana` resource. Plain HTTP inside the cluster, 2Gi limit.
- `filebeat.yaml`: `Beat` resource (DaemonSet) plus its RBAC. Filebeat uses
  Kubernetes autodiscover, decodes the Todo app's JSON, and ships every other
  container's logs as plain lines.
- `kibana-import-job.yaml`: One-shot Job that imports `kibana/saved-objects.ndjson`
  from inside the cluster.
- `kibana/saved-objects.ndjson`: Data view, saved searches, visualizations
  and the **Todo App Logs** dashboard.

Stack version is pinned to `9.4.4` in the three manifests. Change all three
together when upgrading.

## Install

```bash
./install.sh
kubectl -n elk get elasticsearch,kibana,beat,pods
```

The first run pulls about 1GB of images, so allow several minutes.

## Open Kibana

```bash
kubectl -n elk port-forward svc/kibana-kb-http 5601:5601
kubectl -n elk get secret elasticsearch-es-elastic-user \
  -o jsonpath='{.data.elastic}' | base64 -d; echo
```

Open http://localhost:5601 and log in as `elastic` with that password, then
open **Dashboards -> Todo App Logs**. The repository's `port-forward.sh`
forwards Kibana together with the app and Grafana.

## What the app logs

The Todo app writes one Elastic Common Schema (ECS) JSON object per line:

```json
{"@timestamp":"2026-10-09T17:24:59.680Z","log.level":"info","message":"todo_created","service.name":"todo-list","event.dataset":"todo-list.app","event.action":"todo_created"}
```

HTTP requests are logged with `event.dataset: todo-list.access`,
`http.request.method`, `http.response.status_code`, `url.path`, and
`event.duration` in nanoseconds. Frontend errors use `error.message`. Todo text
and IDs are never logged. Set the `LOG_LEVEL` environment variable on the
Deployment to `debug` to also log `/healthz` and `/metrics` requests.

## Query logs

In Kibana **Discover**, pick the **Filebeat logs** data view and use KQL:

```text
service.name : "todo-list" and log.level : "error"
service.name : "todo-list" and event.action : "todo_created"
kubernetes.namespace : "kube-system"
```

Or query Elasticsearch directly:

```bash
kubectl -n elk port-forward svc/elasticsearch-es-http 9200:9200
PW=$(kubectl -n elk get secret elasticsearch-es-elastic-user -o jsonpath='{.data.elastic}' | base64 -d)
curl -sk -u "elastic:$PW" 'https://localhost:9200/filebeat-*/_count'
```

## Troubleshooting

- Pods pending or OOMKilled: Elasticsearch needs 2Gi and Kibana up to 2Gi. Give
  Minikube at least 6GB (`minikube start --memory=6144`).
- Filebeat errors: `kubectl -n elk logs daemonset/filebeat-beat-filebeat`
- Cluster `yellow`: a single node cannot hold replicas. Filebeat's index
  template sets 0 replicas. Kibana may also create internal indices with one
  replica; fix with
  `PUT <index>/_settings {"index":{"number_of_replicas":0}}`.
- Dashboard missing: re-run `./install.sh`, or check
  `kubectl -n elk logs job/kibana-import`.
- No Todo app fields: the app image must be tag `elk` or newer, and
  `kubectl logs deploy/todo-app-todo-list` must show JSON lines.

## Uninstall

```bash
kubectl delete -f filebeat.yaml -f kibana.yaml -f elasticsearch.yaml
kubectl delete namespace elk
helm -n elastic-system uninstall elastic-operator
kubectl delete namespace elastic-system
```

Deleting the namespace removes the Elasticsearch volume, so stored logs are
lost. Check for leftover ECK CRDs with `kubectl get crd | grep k8s.elastic.co`
and delete them if you no longer need them.
