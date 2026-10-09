# Grafana and Loki Implementation

This document describes how the `loki` branch extends the Todo application
with centralized logs in Loki and visualization in Grafana. It is based on
the repository history and the implementation currently present in the
working tree.

## 1. Git history and scope

The branch was created from the existing Prometheus/Grafana monitoring work:

| Commit | Change |
| --- | --- |
| `3774aa9` | Added the production Node server, Prometheus metrics, Grafana, dashboards, and browser telemetry. |
| `dfdd7d4` | Added the Loki-backed Grafana dashboard, the Loki datasource, and dashboard documentation. |

At the time this document was written, `dfdd7d4` was `HEAD`. The following
Loki integration files were also present as working-tree changes and are
included in this walkthrough:

- `loki/values.yaml`
- `loki/alloy-values.yaml`
- `loki/install.sh`
- `loki/README.md`
- Structured logging changes in `server.js`
- Additional browser error details in `src/observability.js`
- The `logging` image tag in `helm-chart/values.yaml`
- Installation and verification instructions in `SETUP.md`
- `.dockerignore` and `port-forward.sh`

The implementation therefore consists of two connected parts:

```text
Application JSON logs
  -> Kubernetes container stdout
  -> Grafana Alloy DaemonSet
  -> Loki in the logging namespace
  -> Grafana Loki datasource
  -> Todo App Logs dashboard
```

Prometheus remains responsible for numeric application metrics. Loki stores
and queries log lines.

## 2. Starting point: metrics without centralized logs

The previous monitoring implementation already exposed Prometheus metrics from
the Node server. The server counted requests, Todo events, and frontend errors,
but it only wrote a plain startup message:

```javascript
// Before: server.js
server.listen(port, '0.0.0.0', () => {
  console.log(`Todo app listening on port ${port}`);
});
```

The telemetry endpoint updated counters but did not create structured log
events:

```javascript
// Before: server.js
if (event.type === 'frontend_error') {
  counters.frontendErrors += 1;
} else if (typeof event.type === 'string' &&
           /^(todo_(created|updated|completed|deleted|cleared|deleted_all))$/
             .test(event.type)) {
  increment(counters.todoEvents, event.type);
}
```

Grafana was configured with Prometheus only:

```yaml
# Before: grafana/values.yaml
datasources:
  datasources.yaml:
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://prometheus-server.monitoring.svc.cluster.local
        isDefault: true
```

This was enough to answer questions such as “how many requests occurred?”,
but not questions such as “what did the application log for this request?” or
“which frontend error messages occurred?”

## 3. Step one: emit structured JSON logs from the application

### 3.1 Add level filtering and a JSON logger

The server now writes one JSON object per line to stdout. Kubernetes already
captures container stdout, so no file-based logging setup is required.

```javascript
// After: server.js
const logLevels = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel =
  logLevels[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ||
  logLevels.info;

const log = (level, msg, fields = {}) => {
  if (logLevels[level] < configuredLevel) {
    return;
  }

  process.stdout.write(`${JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    ...fields,
  })}\n`);
};
```

The `LOG_LEVEL` environment variable supports `debug`, `info`, `warn`, and
`error`. The default is `info`. Health checks and Prometheus scrapes are
logged at `debug` to avoid filling the normal application stream with probe
traffic.

### 3.2 Log completed HTTP requests

The server wraps `response.end()` so every completed request is logged with
its method, normalized route, status code, and duration:

```javascript
// After: server.js
const startedAt = process.hrtime.bigint();
const requestedRoute = request.url.split('?')[0];
const route = ['/healthz', '/metrics', '/telemetry/events'].includes(requestedRoute)
  ? requestedRoute
  : '/';

const finish = response.end;
response.end = function end(...args) {
  const finalStatus = response.statusCode || status;
  increment(counters.httpRequests,
    `${request.method}|${route}|${finalStatus}`);

  const level = finalStatus >= 500 ? 'error'
    : finalStatus >= 400 ? 'warn'
      : (route === '/healthz' || route === '/metrics') ? 'debug' : 'info';

  log(level, 'http_request', {
    method: request.method,
    route,
    status: finalStatus,
    duration_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
  });

  return finish.apply(this, args);
};
```

Example output:

```json
{"time":"2026-10-09T15:29:50.922Z","level":"info","msg":"http_request","method":"GET","route":"/","status":200,"duration_ms":2.31}
```

### 3.3 Log application events without sensitive Todo data

Todo events are logged by name only. The Todo text and Todo IDs are not sent
by the browser and are not written by the server:

```javascript
// After: server.js
if (event.type === 'frontend_error') {
  counters.frontendErrors += 1;
  log('error', 'frontend_error', {
    message: truncate(event.message),
    source: truncate(event.source),
    line: Number(event.line) || undefined,
  });
} else if (typeof event.type === 'string' &&
           /^(todo_(created|updated|completed|deleted|cleared|deleted_all))$/
             .test(event.type)) {
  increment(counters.todoEvents, event.type);
  log('info', 'todo_event', { event: event.type });
} else {
  status = 400;
  log('warn', 'unsupported_telemetry_event', {
    type: truncate(event.type, 50),
  });
  sendJson(response, status, { error: 'Unsupported telemetry event' });
  return;
}
```

The resulting log line is intentionally low-cardinality and safe to use in
dashboards:

```json
{"time":"2026-10-09T15:29:50.922Z","level":"info","msg":"todo_event","event":"todo_created"}
```

Invalid payloads and unsupported event types are also logged at `warn`, which
makes rejected telemetry visible without turning it into an application
crash.

### 3.4 Include useful browser error context

Previously, every browser error was reported with only its event type:

```javascript
// Before: src/observability.js
const onError = () => reportEvent('frontend_error');
const onRejection = () => reportEvent('frontend_error');
```

The updated code includes bounded error context while still excluding Todo
content:

```javascript
// After: src/observability.js
const onError = event => reportEvent('frontend_error', {
  message: event && event.message,
  source: event && event.filename,
  line: event && event.lineno,
});

const onRejection = event => reportEvent('frontend_error', {
  message: event && event.reason &&
    (event.reason.message || String(event.reason)),
  source: 'unhandledrejection',
});
```

The server truncates message and source fields before writing them to logs.
Telemetry remains disabled outside production, so local development does not
send these events.

## 4. Step two: package and deploy the logging image

The multi-stage Docker image builds the React application and runs the
production Node server. The runtime image sets `NODE_ENV=production`, which
enables browser telemetry and structured server logging:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:app

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/build ./build
COPY server.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
```

The Helm default image tag was changed from the general `latest` tag to the
logging image:

```yaml
# Before: helm-chart/values.yaml
image:
  repository: docker.io/hvaandres1409/my-node-app
  pullPolicy: IfNotPresent
  tag: "latest"
```

```yaml
# After: helm-chart/values.yaml
image:
  repository: docker.io/hvaandres1409/my-node-app
  pullPolicy: IfNotPresent
  tag: "logging"
```

Build and publish the image for the cluster architecture before deploying:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t docker.io/hvaandres1409/my-node-app:logging --push .

helm upgrade --install todo-app ./helm-chart \
  --set service.type=NodePort \
  --set image.pullPolicy=Always \
  --wait
```

The Kubernetes deployment continues to expose `/metrics` for Prometheus. The
new log path uses the same pod stdout stream and does not require a second
application port.

## 5. Step three: install Loki as the log store

Loki is installed in a dedicated `logging` namespace, separate from the
application in `default` and Grafana/Prometheus in `monitoring`.

The branch uses a small single-binary deployment suitable for Minikube:

```yaml
# loki/values.yaml
deploymentMode: SingleBinary

loki:
  auth_enabled: false
  commonConfig:
    replication_factor: 1
  storage:
    type: filesystem
  limits_config:
    retention_period: 168h
    allow_structured_metadata: true
    volume_enabled: true
  compactor:
    retention_enabled: true
    delete_request_store: filesystem

singleBinary:
  replicas: 1
  persistence:
    enabled: true
    size: 5Gi
```

The configuration uses filesystem storage, one replica, and seven-day
retention. This is intentionally sized for local Kubernetes development, not
for a highly available production logging platform.

The remaining distributed Loki components, gateway, caches, MinIO, canary,
and tests are disabled:

```yaml
backend:
  replicas: 0
read:
  replicas: 0
write:
  replicas: 0
gateway:
  enabled: false
minio:
  enabled: false
```

## 6. Step four: collect Kubernetes logs with Grafana Alloy

Grafana Alloy replaces Promtail as the collector. It runs as a DaemonSet so
each node tails the logs for pods running on that node.

The Alloy pipeline performs four operations:

1. Discover pods through the Kubernetes API.
2. Restrict discovery to the current node.
3. Convert Kubernetes metadata into Loki labels.
4. Parse the Todo app's JSON `level` and push the stream to Loki.

The relevant configuration is:

```hcl
// loki/alloy-values.yaml
discovery.kubernetes "pods" {
  role = "pod"
  selectors {
    role = "pod"
    field = "spec.nodeName=" + coalesce(sys.env("NODE_NAME"), "")
  }
}

discovery.relabel "pods" {
  targets = discovery.kubernetes.pods.targets

  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    target_label  = "namespace"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_name"]
    target_label  = "pod"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_container_name"]
    target_label  = "container"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name"]
    target_label  = "app"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_instance"]
    target_label  = "instance"
  }
}
```

For Todo app streams, the JSON log level is promoted to a low-cardinality
label. Other fields remain in the log line and are parsed at query time:

```hcl
loki.process "pods" {
  stage.match {
    selector = "{namespace=\"default\", app=\"todo-list\"}"

    stage.json {
      expressions = { level = "level" }
    }
    stage.labels {
      values = { level = "" }
    }
  }

  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki.logging.svc.cluster.local:3100/loki/api/v1/push"
  }
}
```

Labels are deliberately limited to namespace, pod, container, app, instance,
and level. High-cardinality values such as error messages are not labels.

Install both releases with the repository script:

```bash
cd loki
./install.sh
kubectl -n logging get pods,svc,pvc
```

The script adds the Grafana chart repositories and runs:

```bash
helm upgrade --install loki grafana-community/loki \
  --namespace logging --create-namespace \
  -f loki/values.yaml --wait --timeout 10m

helm upgrade --install alloy grafana/alloy \
  --namespace logging \
  -f loki/alloy-values.yaml --wait --timeout 5m
```

## 7. Step five: connect Grafana to Loki

The latest commit, `dfdd7d4`, added a second provisioned datasource to the
existing Grafana values:

```yaml
# Before: only Prometheus
datasources:
  datasources.yaml:
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://prometheus-server.monitoring.svc.cluster.local
        isDefault: true
```

```yaml
# After: Prometheus plus Loki
datasources:
  datasources.yaml:
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://prometheus-server.monitoring.svc.cluster.local
        isDefault: true
      - name: Loki
        type: loki
        access: proxy
        url: http://loki.logging.svc.cluster.local:3100
```

The Grafana pod reaches Loki through the Kubernetes service DNS name. No
localhost address is used between these components.

Re-run the Grafana installer after Loki is installed:

```bash
cd grafana
./install.sh
```

The installer upgrades Grafana and creates dashboard ConfigMaps labeled
`grafana_dashboard=1`. Grafana's dashboard sidecar imports them automatically.

## 8. Step six: add the Todo App Logs dashboard

The latest commit added `grafana/dashboards/todo-app-logs.json`. It uses Loki
queries to provide:

- Total log lines, errors, warnings, and Todo events for the selected range.
- Log volume by level.
- Todo events grouped by event name.
- HTTP requests grouped by status.
- p95 request latency using `duration_ms`.
- Log volume across namespaces.
- A frontend error log panel.
- A searchable Todo application log stream with a level filter.

Representative dashboard queries are:

```logql
# Log volume by level
sum by (level) (
  count_over_time({namespace="default", app="todo-list"}[1m])
)

# Todo events from structured JSON
sum by (event) (
  count_over_time(
    {namespace="default", app="todo-list"}
      | json
      | msg="todo_event"
    [1m]
  )
)

# p95 request latency
quantile_over_time(
  0.95,
  {namespace="default", app="todo-list"}
    | json
    | msg="http_request"
    | __error__=""
    | unwrap duration_ms [5m]
) by (route)
```

The dashboard's main log stream uses the `level` variable:

```logql
{namespace="default", app="todo-list", level=~"$level"}
```

This keeps the dashboard interactive without requiring a separate dashboard
for each log level.

## 9. End-to-end installation order

Use this order so each dependency is available when the next component starts:

```bash
# 1. Install Prometheus and Grafana's existing monitoring stack.
cd grafana
./install.sh

# 2. Install Loki and the Alloy collector.
cd ../loki
./install.sh

# 3. Re-run Grafana to provision the Loki datasource and log dashboard.
cd ../grafana
./install.sh

# 4. Build and deploy the application image that emits JSON logs.
cd ..
docker buildx build --platform linux/amd64,linux/arm64 \
  -t docker.io/hvaandres1409/my-node-app:logging --push .
helm upgrade --install todo-app ./helm-chart \
  --set service.type=NodePort \
  --set image.pullPolicy=Always \
  --wait
```

The application may be deployed before Loki, but no historical logs can be
queried until Alloy and Loki are ready. Logs are collected from stdout after
the collector starts.

## 10. Verification

Check each layer independently:

```bash
# Application emits JSON
kubectl logs deploy/todo-app-todo-list --tail=20

# Loki and Alloy are healthy
kubectl -n logging get pods,svc,pvc
kubectl -n logging logs statefulset/loki
kubectl -n logging logs daemonset/alloy

# Grafana has the Loki datasource/dashboard
kubectl -n monitoring get configmap -l grafana_dashboard=1
kubectl -n monitoring logs deployment/grafana -c grafana-sc-dashboard
```

Open Grafana with:

```bash
kubectl -n monitoring port-forward svc/grafana 3001:80
```

Then use **Explore**, select the **Loki** datasource, and run:

```logql
{namespace="default", app="todo-list"}
{namespace="default", app="todo-list", level="error"}
{namespace="default", app="todo-list"} | json | msg="todo_event"
```

Loki can also be queried directly:

```bash
kubectl -n logging port-forward svc/loki 3100:3100
curl -G http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode 'query={namespace="default", app="todo-list"}' \
  --data-urlencode 'limit=5'
```

## 11. Operational limits and cleanup

This branch is a development-sized implementation:

- Loki is single replica with a 5 GiB filesystem-backed volume.
- Retention is seven days.
- Loki authentication is disabled for the internal cluster service.
- Logs are lost when the `logging` namespace and its PVC are deleted.
- Application log counters in Prometheus remain in memory and reset when the
  application pod restarts.

Remove the logging stack with:

```bash
helm -n logging uninstall alloy
helm -n logging uninstall loki
kubectl delete namespace logging
```

The key design decision is to keep metrics and logs complementary: Prometheus
provides efficient counters and alerting, while Loki preserves structured
event context and searchable request/application details.
