# Todo List Kubernetes Setup

This guide describes the current application, container, Kubernetes, Prometheus,
and Grafana setup from a clean checkout.

## 1. Application architecture

The application is a React Todo List. Todo data remains in the browser
`localStorage`; no Todo API or database was introduced.

The production container now runs a small Node.js server (`server.js`) that:

- Serves the compiled React application from `build/`.
- Exposes `GET /healthz` for Kubernetes health checks and manual checks.
- Exposes `GET /metrics` in Prometheus text format.
- Accepts browser telemetry at `POST /telemetry/events`.
- Counts HTTP requests, Todo actions, and frontend errors in memory.

The React application reports these events in production:

| Metric | Meaning |
| --- | --- |
| `todo_app_http_requests_total` | HTTP requests handled by the production server |
| `todo_app_todo_events_total{event="todo_created"}` | Todo created |
| `todo_app_todo_events_total{event="todo_updated"}` | Todo updated |
| `todo_app_todo_events_total{event="todo_completed"}` | Todo completed or reopened |
| `todo_app_todo_events_total{event="todo_deleted"}` | Todo deleted |
| `todo_app_todo_events_total{event="todo_cleared"}` | Completed Todos cleared |
| `todo_app_todo_events_total{event="todo_deleted_all"}` | All Todos deleted |
| `todo_app_frontend_errors_total` | Browser errors reported by the frontend |

Metrics are held in process memory and reset when the pod restarts. Telemetry
does not include Todo text or Todo IDs.

## 2. Prerequisites

Install and configure:

- Node.js and npm
- Docker
- `kubectl`
- Minikube or Kind
- Helm

Start Minikube and confirm the context:

```bash
minikube start
kubectl config current-context
```

The expected context is `minikube`.

## 3. Install JavaScript dependencies and test the application

From the repository root:

```bash
npm ci
npm run build:app
npm test
```

The build creates the React production files in `build/`.

For development, run the React development server:

```bash
npm start
```

The production server expects a compiled `build/` directory:

```bash
npm run start:prod
```

## 4. Build and test the Docker image

The Dockerfile uses two stages:

1. A Node.js build stage installs dependencies and runs `npm run build:app`.
2. A smaller Node.js runtime stage copies only `build/` and `server.js`, then
   starts `node server.js`.

Build the image:

```bash
docker build -t todo-app:observability .
```

Run it locally:

```bash
docker run --rm -p 3000:3000 todo-app:observability
```

Verify the application and metrics:

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/metrics
```

Create a telemetry event and confirm it appears in the metrics output:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"type":"todo_created"}' \
  http://localhost:3000/telemetry/events

curl http://localhost:3000/metrics
```

## 5. Publish the image to Docker Hub

Log in to Docker Hub if needed:

```bash
docker login
```

Tag and push the tested image:

```bash
docker tag todo-app:observability \
  docker.io/hvaandres1409/my-node-app:observability
docker push docker.io/hvaandres1409/my-node-app:observability
```

The published image used during this setup was:

```text
docker.io/hvaandres1409/my-node-app:observability
digest: sha256:4b357578661a5509224e81ac0c7826dd0678503efbf8663b8ae280145fadbf1d
```

Tags can change. For repeatable deployments, prefer deploying a digest or
publishing immutable version tags.

## 6. Deploy the image with Helm

The chart is in `helm-chart/`. Helm does not build Docker images; the image
must already exist locally in the cluster node or in a registry.

Validate the chart:

```bash
helm lint ./helm-chart
```

Deploy the Docker Hub image:

```bash
helm upgrade --install todo-app ./helm-chart \
  --set image.repository=docker.io/hvaandres1409/my-node-app \
  --set image.tag=observability \
  --set image.pullPolicy=IfNotPresent \
  --set service.type=NodePort \
  --wait
```

The Deployment adds these Prometheus pod annotations:

```yaml
prometheus.io/scrape: "true"
prometheus.io/path: /metrics
prometheus.io/port: "3000"
```

Check the rollout:

```bash
kubectl rollout status deployment/todo-app-todo-list
kubectl get pods -l app.kubernetes.io/instance=todo-app -o wide
kubectl get svc todo-app-todo-list
```

Verify that Minikube is using the registry image and not an older local image:

```bash
kubectl get pod -l app.kubernetes.io/instance=todo-app \
  -o jsonpath='{range .items[*]}{.metadata.name}{" image="}{.spec.containers[0].image}{" imageID="}{.status.containerStatuses[0].imageID}{"\n"}{end}'
```

The `imageID` should reference the Docker Hub repository and the published
digest.

To deploy a local image instead, load it into Minikube first:

```bash
docker build -t todo-app:local .
minikube image load todo-app:local
helm upgrade --install todo-app ./helm-chart \
  --set image.repository=todo-app \
  --set image.tag=local \
  --set image.pullPolicy=Never \
  --set service.type=NodePort \
  --wait
```

`imagePullPolicy: Never` causes `ErrImageNeverPull` unless the exact image tag
has been loaded into the Kubernetes node.

## 7. Install Prometheus

Create the monitoring namespace and install the Prometheus chart:

```bash
helm repo add prometheus-community \
  https://prometheus-community.github.io/helm-charts
helm repo update prometheus-community
helm upgrade --install prometheus prometheus-community/prometheus \
  --namespace monitoring \
  --create-namespace \
  --wait
```

This installs Prometheus, Alertmanager, node exporter, kube-state-metrics, and
Pushgateway.

Check the monitoring components:

```bash
kubectl -n monitoring get pods,svc
```

Prometheus discovers pods with the `prometheus.io/scrape: "true"` annotation.
Verify the Todo app target:

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
```

Open http://localhost:9090/targets and confirm the Todo app target is `UP`.
The target URL should end with `/metrics`.

You can also query the event metric:

```bash
curl --get \
  --data-urlencode 'query=todo_app_todo_events_total' \
  http://localhost:9090/api/v1/query
```

## 8. Install Grafana

The Grafana files are in `grafana/`. The installer:

- Creates the `monitoring` namespace if needed.
- Creates the `grafana-admin` Secret with username `admin`.
- Installs or upgrades the Grafana Helm release.
- Configures Prometheus as the default datasource.
- Creates ConfigMaps for the repository dashboards.
- Lets the Grafana dashboard sidecar load those ConfigMaps.

Install or upgrade Grafana:

```bash
cd grafana
GRAFANA_ADMIN_PASSWORD='choose-a-password' ./install.sh
```

If `GRAFANA_ADMIN_PASSWORD` is omitted, the installer generates a password and
stores it in the `grafana-admin` Secret. Retrieve it with:

```bash
kubectl -n monitoring get secret grafana-admin \
  -o jsonpath='{.data.admin-password}' | base64 -d
echo
```

Access Grafana:

```bash
kubectl -n monitoring port-forward svc/grafana 3001:80
```

Open http://localhost:3001 and log in with:

```text
username: admin
```

The installed dashboards are:

- **Todo App**: HTTP requests, Todo actions, frontend errors, and pod restarts.
- **Kubernetes Overview**: node CPU, node memory, and pod status.

If the dashboard list is empty, check that the dashboard ConfigMaps exist:

```bash
kubectl -n monitoring get configmap -l grafana_dashboard=1
kubectl -n monitoring logs deployment/grafana -c grafana-sc-dashboard
```

After making dashboard changes, update the ConfigMaps and wait for the
dashboard sidecar to reload them.

## 8.1 Add log ingestion with the ELK stack (ECK)

The production server writes one Elastic Common Schema (ECS) JSON log line
per event to stdout: requests, Todo events and frontend errors. Todo text and
IDs are never logged. The `LOG_LEVEL` environment variable (`debug`, `info`,
`warn`, `error`; default `info`) controls verbosity. `/healthz` and `/metrics`
requests are logged at `debug` only.

Elasticsearch, Kibana and Filebeat are deployed with the Elastic Cloud on
Kubernetes (ECK) operator, so they are Kubernetes resources. The operator runs
in `elastic-system` and the stack in `elk`. The files are in `elk/` (see
`elk/README.md`):

```bash
./elk/install.sh
kubectl -n elk get elasticsearch,kibana,beat,pods
```

The flow is:

```text
Todo app pod (ECS JSON) -> Filebeat (DaemonSet) -> Elasticsearch -> Kibana
```

Build and publish the image that emits the logs, then deploy it (the chart
default tag is `elk`):

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t docker.io/hvaandres1409/my-node-app:elk --push .
helm upgrade --install todo-app ./helm-chart \
  --set service.type=NodePort \
  --set image.pullPolicy=Always \
  --wait
```

Open Kibana and log in as `elastic`:

```bash
kubectl -n elk port-forward svc/kibana-kb-http 5601:5601
kubectl -n elk get secret elasticsearch-es-elastic-user \
  -o jsonpath='{.data.elastic}' | base64 -d; echo
```

Open http://localhost:5601, then **Dashboards -> Todo App Logs**. It shows log
volume by level, Todo events, HTTP status codes, request latency, frontend
errors, log volume per namespace, and a searchable log stream. In **Discover**
use the **Filebeat logs** data view with KQL such as:

```text
service.name : "todo-list" and log.level : "error"
```

`./port-forward.sh` forwards the app (3000), Grafana (3001) and Kibana (5601)
together.

## 9. End-to-end verification

Use these checks after deployment:

```bash
kubectl get pods -A
kubectl get deployment todo-app-todo-list
kubectl -n monitoring get pods
kubectl -n monitoring get svc
```

Open the application and create a Todo. Then verify:

1. The browser sends a `todo_created` telemetry event.
2. The application `/metrics` endpoint reports
   `todo_app_todo_events_total`.
3. Prometheus shows the Todo app target as `UP`.
4. Prometheus returns the metric from its query API.
5. Grafana's **Todo App** dashboard displays the event.

Prometheus scrapes periodically, so new activity may take up to the configured
scrape interval to appear in Grafana.

## 10. Uninstall

Remove the application:

```bash
helm uninstall todo-app
```

Remove Grafana and its Secret:

```bash
helm -n monitoring uninstall grafana
kubectl -n monitoring delete secret grafana-admin
```

Remove the ELK stack and the ECK operator (this also deletes the stored logs):

```bash
kubectl delete -f elk/filebeat.yaml -f elk/kibana.yaml -f elk/elasticsearch.yaml
kubectl delete namespace elk
helm -n elastic-system uninstall elastic-operator
kubectl delete namespace elastic-system
```

Remove Prometheus:

```bash
helm -n monitoring uninstall prometheus
```

Delete the monitoring namespace only if no other workloads use it:

```bash
kubectl delete namespace monitoring
```
