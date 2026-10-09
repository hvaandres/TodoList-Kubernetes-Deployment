# Todo List ELK/ECK Deployment Guide

This guide documents the ELK-related work introduced by commit
`2a7de894fa5d2b8f7bcb8a329abe0f376123a02a` (`Implementing the ELK Stack`).
It explains:

1. What changed in the JavaScript application.
2. How application logs move from the Todo app to Kibana.
3. How to build and publish the application image to Docker Hub.
4. How Helm deploys the image to Kubernetes.
5. How ECK installs Elasticsearch, Kibana, and Filebeat.
6. How to run the complete stack on Minikube.
7. How to verify, troubleshoot, and remove the deployment.

> **Important terminology:** this repository calls the setup “ELK,” but the
> committed implementation is Elasticsearch + Kibana + Filebeat managed by
> Elastic Cloud on Kubernetes (ECK). Logstash is not deployed. Filebeat ships
> the records directly to Elasticsearch. Adding Logstash would require an
> additional pipeline and Kubernetes workload that are not present here.

## 1. Resulting architecture

The completed data path is:

```text
Browser
  |
  | POST /telemetry/events
  v
Todo app container in the default namespace
  |
  | ECS JSON log lines on stdout
  v
Kubernetes container log files
  |
  | Filebeat DaemonSet tails /var/log/containers
  | Kubernetes autodiscover adds pod/namespace/container metadata
  v
Elasticsearch in the elk namespace
  |
  | Kibana reads filebeat-* indices
  v
Kibana "Todo App Logs" dashboard
```

The namespaces used by the repository are:

| Namespace | Contents |
| --- | --- |
| `default` | Todo application Deployment and Service |
| `elk` | Elasticsearch, Kibana, Filebeat, and the dashboard import Job |
| `elastic-system` | ECK operator and its CRDs/controller |
| `monitoring` | Prometheus and Grafana, if the metrics stack is installed |

The application continues to store Todo data in browser `localStorage`. The
ELK work adds operational logs; it does not add a Todo database or send Todo
text to Elasticsearch.

## 2. Files added or changed in commit `2a7de89`

The commit changed 13 files and added 651 lines:

| File | Purpose |
| --- | --- |
| `.dockerignore` | Prevents dependencies, build output, Git metadata, and deployment files from entering the Docker build context. |
| `server.js` | Adds structured ECS logging, log levels, HTTP access logs, telemetry logs, and graceful shutdown logs. |
| `src/observability.js` | Sends safe error details from the production browser to the telemetry endpoint. |
| `helm-chart/values.yaml` | Changes the default image tag from `latest` to `elk`. |
| `elk/elasticsearch.yaml` | Defines a single-node ECK Elasticsearch resource for Minikube. |
| `elk/kibana.yaml` | Defines the ECK Kibana resource. |
| `elk/filebeat.yaml` | Defines the Filebeat Beat resource, DaemonSet configuration, host log mounts, and RBAC. |
| `elk/kibana-import-job.yaml` | Imports saved Kibana objects from a ConfigMap. |
| `elk/kibana/saved-objects.ndjson` | Stores the Kibana data view, searches, visualizations, and dashboard. |
| `elk/install.sh` | Installs ECK, applies the stack resources, waits for health, and imports the dashboard. |
| `elk/README.md` | Documents the ELK resources, queries, access, and troubleshooting. |
| `SETUP.md` | Adds Docker Hub, Helm, Minikube, and ELK setup instructions. |
| `port-forward.sh` | Forwards the Todo app, Grafana, and Kibana ports together. |

The Elastic version is pinned to `9.4.4` in the Elasticsearch, Kibana, and
Filebeat manifests. The ECK operator chart defaults to `3.5.0` in
`elk/install.sh`.

## 3. JavaScript application changes: old versus new

### 3.1 Server logging before the ELK change

Before the commit, the Node production server only wrote a plain-text startup
line:

```js
server.listen(port, '0.0.0.0', () => {
  console.log(`Todo app listening on port ${port}`);
});
```

HTTP requests were counted for Prometheus, but they were not written as
individual log records. For example, the response wrapper only incremented the
in-memory counter:

```js
response.end = function end(...args) {
  increment(counters.httpRequests, `${request.method}|${route}|${response.statusCode || status}`);
  return finish.apply(this, args);
};
```

Telemetry events were also counted without producing a searchable application
log. A frontend error only incremented a counter:

```js
if (event.type === 'frontend_error') {
  counters.frontendErrors += 1;
}
```

This was sufficient for Prometheus metrics, but it did not provide event
details, request status, request duration, error text, or Kubernetes-enriched
records in Kibana.

### 3.2 Structured ECS logging after the ELK change

The new `log` helper in `server.js` writes exactly one JSON object per line to
stdout:

```js
const logLevels = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel =
  logLevels[String(process.env.LOG_LEVEL || 'info').toLowerCase()]
  || logLevels.info;

const log = (level, message, fields = {}) => {
  if (logLevels[level] < configuredLevel) {
    return;
  }
  process.stdout.write(`${JSON.stringify({
    '@timestamp': new Date().toISOString(),
    'log.level': level,
    message,
    'ecs.version': '8.11.0',
    'service.name': 'todo-list',
    ...fields,
  })}\n`);
};
```

This format is deliberately compatible with Filebeat’s NDJSON parser:

```json
{
  "@timestamp": "2026-10-09T17:24:59.680Z",
  "log.level": "info",
  "message": "todo_created",
  "ecs.version": "8.11.0",
  "service.name": "todo-list",
  "event.dataset": "todo-list.app",
  "event.action": "todo_created"
}
```

The fields use Elastic Common Schema names where appropriate:

| Field | Meaning |
| --- | --- |
| `@timestamp` | UTC time when the record was created |
| `log.level` | `debug`, `info`, `warn`, or `error` |
| `service.name` | Stable service identifier: `todo-list` |
| `ecs.version` | ECS version associated with the record |
| `event.dataset` | Logical stream, such as `todo-list.app` or `todo-list.access` |
| `event.action` | Operation represented by the event |
| `http.request.method` | HTTP method |
| `http.response.status_code` | Final response status |
| `url.path` | Requested path, truncated to 200 characters |
| `event.duration` | Request duration in nanoseconds |
| `error.message` | Browser error message, when one is reported |

Custom application fields are kept under the `todo.*` namespace. The code
intentionally does not log Todo text or Todo IDs.

### 3.3 HTTP access logging

The response wrapper now measures request duration, increments the existing
metric, chooses a severity, and emits an access record:

```js
const startedAt = process.hrtime.bigint();

response.end = function end(...args) {
  const finalStatus = response.statusCode || status;
  increment(counters.httpRequests, `${request.method}|${route}|${finalStatus}`);

  const level = finalStatus >= 500 ? 'error'
    : finalStatus >= 400 ? 'warn'
      : (route === '/healthz' || route === '/metrics') ? 'debug' : 'info';

  log(level, `${request.method} ${route} ${finalStatus}`, {
    'event.dataset': 'todo-list.access',
    'event.action': 'http_request',
    'event.duration': Number(process.hrtime.bigint() - startedAt),
    'http.request.method': request.method,
    'http.response.status_code': finalStatus,
    'url.path': truncate(requestedRoute),
    'todo.route': route,
  });

  return finish.apply(this, args);
};
```

Health checks and Prometheus scrapes are logged at `debug` to avoid flooding
the normal `info` stream. Failed requests are promoted to `warn` or `error`.
Set `LOG_LEVEL=debug` on the Deployment when those probe and scrape records are
needed.

### 3.4 Telemetry and frontend errors

Before the commit, the browser helper accepted only an event type:

```js
export const reportEvent = type => {
  const payload = JSON.stringify({ type });
  // sendBeacon or fetch to /telemetry/events
};

const onError = () => reportEvent('frontend_error');
const onRejection = () => reportEvent('frontend_error');
```

The new helper accepts an optional details object:

```js
export const reportEvent = (type, details = {}) => {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const payload = JSON.stringify({ type, ...details });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      '/telemetry/events',
      new Blob([payload], { type: 'application/json' }),
    );
    return;
  }
  fetch('/telemetry/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});
};
```

Error handlers now send only message and source-location information:

```js
const onError = event => reportEvent('frontend_error', {
  message: event && event.message,
  source: event && event.filename,
  line: event && event.lineno,
});

const onRejection = event => reportEvent('frontend_error', {
  message: event && event.reason
    && (event.reason.message || String(event.reason)),
  source: 'unhandledrejection',
});
```

On the server, these details become an ECS-compatible error record:

```js
log('error', 'frontend_error', {
  'event.dataset': 'todo-list.app',
  'event.action': 'frontend_error',
  'error.message': truncate(event.message),
  'todo.error_source': truncate(event.source),
  'todo.error_line': Number(event.line) || undefined,
});
```

Todo lifecycle events such as `todo_created`, `todo_updated`,
`todo_completed`, `todo_deleted`, `todo_cleared`, and `todo_deleted_all` are
validated, counted, and logged. Unsupported event types and invalid JSON
produce `warn` records and a `400` response.

### 3.5 Graceful shutdown

The new server also logs termination and closes the HTTP server before exiting:

```js
const shutdown = signal => {
  log('info', `Todo app stopping (${signal})`, {
    'event.dataset': 'todo-list.app',
    'event.action': 'server_stopping',
  });
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

This makes Kubernetes pod termination visible in the log stream and gives
active requests an opportunity to finish.

## 4. Build the application image

The existing `Dockerfile` is a two-stage build:

1. `node:22-slim` installs dependencies and runs `npm run build:app`.
2. A clean `node:22-slim` runtime contains only `build/` and `server.js`.

The `.dockerignore` added by the ELK commit excludes `node_modules`, `build`,
`.git`, CI files, Helm/Grafana/ELK source directories, Markdown files, and
temporary npm/macOS files. This keeps the build context smaller and prevents
deployment-only files from being copied into the runtime image.

From the repository root:

```bash
npm ci
npm run build:app
npm test
docker build -t todo-app:elk .
```

Test the image before publishing:

```bash
docker run --rm --name todo-app-test -p 3000:3000 todo-app:elk
```

In a second terminal:

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/metrics
curl -X POST \
  -H 'Content-Type: application/json' \
  -d '{"type":"todo_created"}' \
  http://localhost:3000/telemetry/events
```

The container terminal should show JSON log lines for the server start,
requests, and `todo_created`. Stop the temporary container with `Ctrl+C`.

## 5. Publish the image to Docker Hub

Replace `hvaandres1409` if using a different Docker Hub account.

### 5.1 Log in

Use a Docker Hub access token rather than storing a password in shell history:

```bash
docker login
```

### 5.2 Tag and push a single-platform image

```bash
docker tag todo-app:elk \
  docker.io/hvaandres1409/my-node-app:elk
docker push docker.io/hvaandres1409/my-node-app:elk
```

The repository’s Helm default is already configured for this image:

```yaml
image:
  repository: docker.io/hvaandres1409/my-node-app
  pullPolicy: IfNotPresent
  tag: "elk"
```

### 5.3 Recommended multi-platform push

The setup instructions use Buildx so that the same tag can run on both
`linux/amd64` and `linux/arm64` Minikube environments:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t docker.io/hvaandres1409/my-node-app:elk \
  --push .
```

Because `--push` publishes directly, a separate `docker push` is not needed
for this command. Confirm the published image:

```bash
docker buildx imagetools inspect \
  docker.io/hvaandres1409/my-node-app:elk
```

For production repeatability, publish immutable tags such as `elk-20261009`
or deploy by digest. A mutable tag can point to a different image later.

## 6. Deploy the Todo image with Helm

Helm packages the Todo application’s Kubernetes Deployment and Service. Helm
does not build or push images; the image must already be available in Docker
Hub or loaded into the Minikube node.

### 6.1 Validate the chart

```bash
helm lint ./helm-chart
helm template todo-app ./helm-chart \
  --set image.repository=docker.io/hvaandres1409/my-node-app \
  --set image.tag=elk
```

The chart renders:

- One Deployment, controlled by `replicaCount`.
- A container named after the chart.
- The configured image repository, tag, and pull policy.
- Port `3000`.
- Prometheus annotations:

  ```yaml
  prometheus.io/scrape: "true"
  prometheus.io/path: /metrics
  prometheus.io/port: "3000"
  ```

- A Service using the configured `service.type`.

### 6.2 Install or upgrade the application

```bash
helm upgrade --install todo-app ./helm-chart \
  --set image.repository=docker.io/hvaandres1409/my-node-app \
  --set image.tag=elk \
  --set image.pullPolicy=Always \
  --set service.type=NodePort \
  --wait
```

`Always` is useful while reusing the mutable `elk` tag. Use an immutable tag or
digest with `IfNotPresent` for repeatable deployments.

Check the rollout:

```bash
kubectl rollout status deployment/todo-app-todo-list
kubectl get pods -l app.kubernetes.io/instance=todo-app -o wide
kubectl get svc todo-app-todo-list
```

Check which image and digest the pod actually started:

```bash
kubectl get pod -l app.kubernetes.io/instance=todo-app \
  -o jsonpath='{range .items[*]}{.metadata.name}{" image="}{.spec.containers[0].image}{" imageID="}{.status.containerStatuses[0].imageID}{"\n"}{end}'
```

The `imageID` should correspond to the Docker Hub image that was published.

## 7. Start Minikube with enough resources

The single-node ELK configuration requests substantial memory:

- Elasticsearch: 2 GiB limit and 5 GiB persistent volume.
- Kibana: 1 GiB request and 2 GiB limit.
- Filebeat: up to 400 MiB.
- Todo app, Kubernetes system pods, and optional monitoring components.

Start Minikube with at least 6 GiB of memory:

```bash
minikube start --memory=6144 --cpus=4
kubectl config use-context minikube
kubectl config current-context
```

If Minikube is already running with less memory, recreate or resize it using
the Minikube version’s supported procedure. Confirm the node is ready:

```bash
kubectl get nodes
kubectl describe node minikube | grep -A5 -E 'Allocatable|Conditions'
```

## 8. Install ECK and the ELK resources

The installer in `elk/install.sh` performs the following sequence:

1. Verifies that a Kubernetes context exists.
2. Adds and updates the Elastic Helm repository.
3. Installs or upgrades `elastic-operator` in `elastic-system`.
4. Creates the `elk` namespace.
5. Applies Elasticsearch, Kibana, and Filebeat custom resources.
6. Waits up to 20 minutes for Elasticsearch health `green`.
7. Waits for Kibana health `green`.
8. Creates the `kibana-saved-objects` ConfigMap.
9. Runs the in-cluster dashboard import Job.

Run it from the repository root:

```bash
chmod +x elk/install.sh
./elk/install.sh
```

Inspect the resulting resources:

```bash
kubectl -n elastic-system get pods
kubectl -n elk get elasticsearch,kibana,beat,pods
kubectl -n elk get pvc,svc,secret
```

### 8.1 Elasticsearch resource

`elk/elasticsearch.yaml` defines:

- ECK API kind `Elasticsearch`.
- Version `9.4.4`.
- One node, suitable for Minikube.
- `node.store.allow_mmap: false`, avoiding a Minikube
  `vm.max_map_count` requirement.
- Java heap `-Xms1g -Xmx1g`.
- 2 GiB memory limit.
- A 5 GiB `ReadWriteOnce` persistent volume.
- ECK-managed security and the generated `elastic` user password.

The generated password is stored in:

```text
elk/elasticsearch-es-elastic-user
```

Retrieve it with:

```bash
kubectl -n elk get secret elasticsearch-es-elastic-user \
  -o jsonpath='{.data.elastic}' | base64 -d
echo
```

### 8.2 Kibana resource

`elk/kibana.yaml` defines one Kibana pod connected to the Elasticsearch
resource through `elasticsearchRef`. Kibana HTTP TLS is disabled only for the
Kibana service so local `kubectl port-forward` access does not produce browser
certificate warnings. Elasticsearch security and TLS remain enabled.

### 8.3 Filebeat resource and direct ingestion

`elk/filebeat.yaml` defines an ECK `Beat` resource whose type is `filebeat`.
ECK runs it as a DaemonSet, so one Filebeat pod runs on each Kubernetes node.
On Minikube there is normally one node.

Filebeat:

- Mounts `/var/log/containers` and `/var/log/pods` read-only.
- Uses Kubernetes autodiscover to find container log files.
- Uses the `NODE_NAME` field to scope discovery to its node.
- Enriches events with namespace, pod, container, and node metadata.
- Decodes only the Todo app’s JSON logs as NDJSON.
- Ships all other container logs as plain lines.
- Sets index replicas to `0`, which is required for a single-node cluster.

The Todo app condition is:

```yaml
kubernetes.namespace: default
kubernetes.container.name: todo-list
```

For those records, the `container` parser removes the Kubernetes log wrapper
and the `ndjson` parser expands dotted keys such as `event.action` into
structured Elasticsearch fields.

Filebeat also has a ClusterRole and ClusterRoleBinding allowing it to watch the
Kubernetes objects needed for autodiscover:

- Namespaces, pods, and nodes.
- ReplicaSets.
- Jobs.

## 9. Import the Kibana dashboard

The dashboard objects are stored in
`elk/kibana/saved-objects.ndjson`. They include:

- The `filebeat-*` data view named **Filebeat logs**.
- Saved searches for Todo app logs and frontend errors.
- Metrics for total logs, errors, warnings, and Todo events.
- Log volume by level and namespace.
- HTTP status counts.
- Request latency percentiles.
- The **Todo App Logs** dashboard.

The installer converts the NDJSON file into a ConfigMap:

```bash
kubectl -n elk create configmap kibana-saved-objects \
  --from-file=saved-objects.ndjson=elk/kibana/saved-objects.ndjson \
  --dry-run=client -o yaml | kubectl apply -f -
```

It then runs `elk/kibana-import-job.yaml`. The Job:

1. Reads the generated `elastic` password from the Kubernetes Secret.
2. Mounts the saved objects ConfigMap at `/objects`.
3. Sends the file to Kibana’s saved-object import API.
4. Requires `"success": true`.
5. Retries on failure and expires after one hour.

If the dashboard is missing, rerun the installer or inspect the Job:

```bash
kubectl -n elk get job kibana-import
kubectl -n elk logs job/kibana-import
```

## 10. Open the application and Kibana

Forward the Todo app:

```bash
kubectl port-forward svc/todo-app-todo-list 3000:3000
```

Forward Kibana:

```bash
kubectl -n elk port-forward svc/kibana-kb-http 5601:5601
```

Then open:

- Todo app: <http://localhost:3000>
- Kibana: <http://localhost:5601>

Log in to Kibana as `elastic` using the password from the Secret. Open
**Dashboards -> Todo App Logs**.

The repository also provides one script for all three local interfaces:

```bash
./port-forward.sh
```

It forwards:

| Local URL | Kubernetes Service |
| --- | --- |
| `http://localhost:3000` | Todo app |
| `http://localhost:3001` | Grafana in `monitoring` |
| `http://localhost:5601` | Kibana in `elk` |

Press `Ctrl+C` to stop all forwards.

## 11. Generate and query logs

Create or modify a Todo in the browser. The browser reports an event in
production, the Node server logs it, and Filebeat ships the resulting line.

Inspect the raw application output first:

```bash
kubectl logs deployment/todo-app-todo-list --tail=50
```

Expected records resemble:

```json
{"@timestamp":"2026-10-09T17:24:59.680Z","log.level":"info","message":"todo_created","ecs.version":"8.11.0","service.name":"todo-list","event.dataset":"todo-list.app","event.action":"todo_created"}
```

In Kibana Discover, select **Filebeat logs** and try these KQL queries:

```text
service.name : "todo-list" and log.level : "error"
service.name : "todo-list" and event.action : "todo_created"
service.name : "todo-list" and event.dataset : "todo-list.access"
kubernetes.namespace : "kube-system"
```

Elasticsearch can also be queried through a port-forward:

```bash
kubectl -n elk port-forward svc/elasticsearch-es-http 9200:9200
PW=$(kubectl -n elk get secret elasticsearch-es-elastic-user \
  -o jsonpath='{.data.elastic}' | base64 -d)
curl -sk -u "elastic:$PW" \
  'https://localhost:9200/filebeat-*/_count'
```

## 12. Alternative: load an image directly into Minikube

Pushing to Docker Hub is the normal workflow used by the commit. For a local
development loop, the image can be loaded into Minikube instead:

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

`imagePullPolicy: Never` tells Kubernetes not to contact Docker Hub. The exact
image name and tag must already exist inside Minikube; otherwise the pod enters
`ErrImageNeverPull`.

Another local option is to build directly inside Minikube’s Docker daemon:

```bash
eval "$(minikube docker-env)"
docker build -t todo-app:local .
helm upgrade --install todo-app ./helm-chart \
  --set image.repository=todo-app \
  --set image.tag=local \
  --set image.pullPolicy=IfNotPresent \
  --set service.type=NodePort \
  --wait
```

Run `eval "$(minikube docker-env -u)"` afterward if the shell should return to
the host Docker daemon.

## 13. Verification checklist

Run the following checks in order:

```bash
kubectl get nodes
kubectl get pods -A
kubectl rollout status deployment/todo-app-todo-list
kubectl -n elastic-system get pods
kubectl -n elk get elasticsearch,kibana,beat,pods
kubectl -n elk get job kibana-import
```

Then verify:

1. The Todo app pod is `Running` and `Ready`.
2. The application image and image ID match the intended Docker Hub tag/digest.
3. Elasticsearch and Kibana report healthy through ECK.
4. A Filebeat pod is running on every Kubernetes node.
5. The dashboard import Job completed successfully.
6. `kubectl logs deployment/todo-app-todo-list` contains JSON records.
7. Kibana Discover shows a `filebeat-*` data view.
8. A browser Todo action appears as `event.action`.
9. A server error appears with `log.level: "error"`.

## 14. Troubleshooting

### Pods are Pending or OOMKilled

Minikube probably does not have enough memory. Use at least:

```bash
minikube start --memory=6144 --cpus=4
```

Then inspect:

```bash
kubectl -n elk describe pod <pod-name>
kubectl -n elk get events --sort-by=.lastTimestamp
```

### Elasticsearch remains yellow

The configuration has one node. Filebeat sets index replicas to zero, but
Kibana-created internal indices may still have replicas. Inspect indices and
set replicas to zero when appropriate:

```bash
kubectl -n elk port-forward svc/elasticsearch-es-http 9200:9200
PW=$(kubectl -n elk get secret elasticsearch-es-elastic-user \
  -o jsonpath='{.data.elastic}' | base64 -d)
curl -sk -u "elastic:$PW" \
  -X PUT 'https://localhost:9200/<index>/_settings' \
  -H 'Content-Type: application/json' \
  -d '{"index":{"number_of_replicas":0}}'
```

### No Todo fields appear in Kibana

Confirm all three conditions:

```bash
kubectl logs deployment/todo-app-todo-list --tail=50
kubectl -n elk logs daemonset/filebeat-beat-filebeat --tail=100
kubectl -n elk get beat filebeat -o yaml
```

The app must emit one valid JSON object per line, the container must be named
`todo-list`, and it must run in the `default` namespace. The image must be the
ELK-enabled image, not an older image using plain `console.log`.

### The image cannot be pulled

Check:

```bash
kubectl describe pod -l app.kubernetes.io/instance=todo-app
docker pull docker.io/hvaandres1409/my-node-app:elk
```

For a private Docker Hub repository, create an image pull Secret and configure
the chart Deployment to use it. For a local image, use `minikube image load`
and `imagePullPolicy=Never`.

### Kibana dashboard import fails

```bash
kubectl -n elk get pods,job,configmap
kubectl -n elk logs job/kibana-import
kubectl -n elk describe job kibana-import
```

The Job depends on the Kibana service, the generated Elasticsearch password,
and the `kibana-saved-objects` ConfigMap. Re-run:

```bash
./elk/install.sh
```

### Filebeat has permission or discovery errors

Check that the DaemonSet has the host log mounts and RBAC:

```bash
kubectl -n elk describe daemonset filebeat-beat-filebeat
kubectl get clusterrole filebeat -o yaml
kubectl get clusterrolebinding filebeat -o yaml
```

The committed manifest intentionally runs Filebeat as UID 0 because it reads
the node’s container log paths.

## 15. Cleanup

Remove the application Helm release:

```bash
helm uninstall todo-app
```

Remove the ELK resources and namespaces:

```bash
kubectl delete -f elk/filebeat.yaml
kubectl delete -f elk/kibana.yaml
kubectl delete -f elk/elasticsearch.yaml
kubectl delete namespace elk
helm -n elastic-system uninstall elastic-operator
kubectl delete namespace elastic-system
```

Deleting the `elk` namespace deletes the Elasticsearch volume claim and
therefore the stored logs. Before cleanup, export anything that must be kept.
The ECK CRDs may remain:

```bash
kubectl get crd | grep k8s.elastic.co
```

Delete those CRDs only when no other ECK-managed resources are using them.

