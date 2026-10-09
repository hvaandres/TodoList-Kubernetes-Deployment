# Grafana and Prometheus

This directory installs Grafana into the `monitoring` namespace and provisions
the Prometheus datasource plus the repository's dashboards.

## Prerequisites

- A running Kubernetes cluster and selected `kubectl` context
- Helm and `kubectl`
- Prometheus installed in the `monitoring` namespace

## Install Prometheus

From any directory:

```bash
helm repo add prometheus-community \
  https://prometheus-community.github.io/helm-charts
helm repo update prometheus-community
helm upgrade --install prometheus prometheus-community/prometheus \
  --namespace monitoring \
  --create-namespace \
  --wait
```

Verify it:

```bash
kubectl -n monitoring get pods,svc
```

## Install Grafana and dashboards

From this directory:

```bash
GRAFANA_ADMIN_PASSWORD='choose-a-password' ./install.sh
```

The installer:

1. Creates the `grafana-admin` Secret if it does not exist.
2. Installs or upgrades the `grafana-community/grafana` Helm release.
3. Configures Prometheus as the default datasource.
4. Creates dashboard ConfigMaps labeled `grafana_dashboard=1`.
5. Lets the Grafana dashboard sidecar import and reload the dashboards.

The Grafana username is `admin`. Retrieve the generated or configured password:

```bash
kubectl -n monitoring get secret grafana-admin \
  -o jsonpath='{.data.admin-password}' | base64 -d
echo
```

Access Grafana:

```bash
kubectl -n monitoring port-forward svc/grafana 3001:80
```

Open http://localhost:3001.

## Included dashboards

- `dashboards/todo-app.json`
  - HTTP request rate
  - Todo action counters
  - Frontend errors
  - Todo app pod restarts
- `dashboards/kubernetes-overview.json`
  - Node CPU usage
  - Node memory usage
  - Running and failed pod counts

The dashboards expect the datasource named `Prometheus`. Prometheus must be
scraping the Todo app pod for the application panels to show data.

Check the scrape target:

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
```

Then open http://localhost:9090/targets and confirm the Todo app target is
`UP`.

Check dashboard provisioning:

```bash
kubectl -n monitoring get configmap -l grafana_dashboard=1
kubectl -n monitoring logs deployment/grafana -c grafana-sc-dashboard
```

## Uninstall

```bash
helm -n monitoring uninstall grafana
kubectl -n monitoring delete secret grafana-admin
```

Prometheus is a separate Helm release:

```bash
helm -n monitoring uninstall prometheus
```
