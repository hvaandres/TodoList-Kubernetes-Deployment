# Todo List Kubernetes Deployment

This repository contains a React Todo List application packaged as a
production Docker image and deployed to Kubernetes with Helm.

The application stores Todo data in browser `localStorage`. Its production
Node.js server also exposes health and Prometheus metrics endpoints, allowing
Prometheus and Grafana to monitor HTTP traffic, Todo actions, frontend errors,
and Kubernetes health.

## Quick start

```bash
minikube start
npm ci
docker build -t todo-app:observability .
docker tag todo-app:observability \
  docker.io/hvaandres1409/my-node-app:observability
docker push docker.io/hvaandres1409/my-node-app:observability

helm upgrade --install todo-app ./helm-chart \
  --set image.repository=docker.io/hvaandres1409/my-node-app \
  --set image.tag=observability \
  --set image.pullPolicy=IfNotPresent \
  --set service.type=NodePort \
  --wait
```

Check the deployment:

```bash
kubectl get pods
kubectl get deployment todo-app-todo-list
kubectl get svc todo-app-todo-list
```

For a complete setup, verification, troubleshooting, and cleanup procedure,
see [SETUP.md](SETUP.md).

## Application endpoints

When the application is reachable on port 3000:

```bash
curl http://localhost:3000/healthz
curl http://localhost:3000/metrics
```

The production server accepts browser telemetry at:

```text
POST /telemetry/events
```

Todo data remains local to the browser. Telemetry contains event types only; it
does not send Todo text or IDs.

## Observability

Install Prometheus:

```bash
helm repo add prometheus-community \
  https://prometheus-community.github.io/helm-charts
helm repo update prometheus-community
helm upgrade --install prometheus prometheus-community/prometheus \
  --namespace monitoring \
  --create-namespace \
  --wait
```

Install Grafana and the included dashboards:

```bash
cd grafana
GRAFANA_ADMIN_PASSWORD='choose-a-password' ./install.sh
kubectl -n monitoring port-forward svc/grafana 3001:80
```

Open http://localhost:3001 and log in as `admin`. The Grafana dashboards are:

- **Todo App**: HTTP requests, Todo actions, frontend errors, and pod restarts.
- **Kubernetes Overview**: node CPU, node memory, and pod status.

## Local image alternative

For a local-only Minikube deployment, the image must be loaded into Minikube:

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

If the image is not loaded into Minikube, `imagePullPolicy: Never` causes
`ErrImageNeverPull`.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | React application and frontend telemetry instrumentation |
| `server.js` | Production static server, health endpoint, telemetry endpoint, and metrics |
| `Dockerfile` | Multi-stage production image |
| `helm-chart/` | Todo app Deployment and Service |
| `grafana/` | Grafana values, installer, datasource, and dashboards |
| `SETUP.md` | Complete step-by-step installation and verification guide |

## Existing project reference

The original Create React App and Netlify Lambda reference material is retained
below for historical context. The Kubernetes deployment uses the production
server and Docker workflow described above.
