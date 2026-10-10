# Observability for an existing Grafana

Ready-made pieces for a Grafana, Prometheus and Loki you already run. Nothing here is part of
the release-managed `docker-compose.yml`, so deploys are unaffected.

| File | Goes into |
| --- | --- |
| `prometheus-scrape.yml` | `scrape_configs:` of your Prometheus |
| `capital-tracker.rules.yml` | `rule_files:` of your Prometheus |
| `alloy-logs.alloy` | your Grafana Alloy configuration (logs to Loki) |
| `loki/` | a ready Loki and Alloy Compose project, if you have neither |
| `grafana/capital-tracker-dashboard.json` | Grafana → Dashboards → Import |

## Setup

1. **Network.** The backend serves `/metrics` on port 9464. Compose publishes it on the
   server's loopback only (`127.0.0.1:9464`, `METRICS_HOST_PORT` changes the host port), and the
   public proxy forwards only `/api/`, so it is not reachable from outside. A Prometheus in
   host network mode scrapes `127.0.0.1:9464`. A Prometheus on a Docker network can instead join
   the application's network (`docker network connect <project>_capital-tracker-network <container>`,
   see `docker network ls`; `external: true` in its compose file keeps it across re-creation)
   and scrape `capital_tracker_backend:9464`. The published port needs the server update step
   once; see the pull request that added it.
2. **Metrics.** Add the job from `prometheus-scrape.yml`, add the rules file, reload Prometheus.
   Check Status → Targets shows `capital-tracker-backend` as UP.
3. **Logs.** Either merge `alloy-logs.alloy` into your own Alloy config (point `forward_to` at your
   `loki.write` component), or, if you run no Loki, start the stack in `loki/`:
   `docker compose -f deploy/observability/loki/docker-compose.yml up -d`. It is a separate
   Compose project with pinned images and 30 days of retention. Loki is published on the
   server's loopback only (`127.0.0.1:3100`), so add a Loki data source in Grafana with URL
   `http://127.0.0.1:3100`. That URL fits a Grafana in host network mode; a Grafana on a Docker
   network cannot reach the host's loopback, so give it the stack's network instead.
4. **Dashboard.** Import `grafana/capital-tracker-dashboard.json` and pick your Prometheus and
   Loki data sources when asked. Routing the alerts (mail, Telegram) is done in your
   Alertmanager or Grafana contact points.

## Using it

- Every API response carries `X-Request-Id`; paste it into the dashboard's **Request id** box to
  see that request's log lines, or query Loki with
  `{container="capital_tracker_backend"} | json | req_id="<id>"`.
- Wallet and price health come from the same `sync_sources` rows the app's Sync status screen
  shows, so a red panel here matches a red source there.
- A wallet whose network source is down for good (for example Zcash while no source is
  configured) keeps `CapitalTrackerWalletSyncFailing` firing; silence it in Alertmanager or
  change its `expr` to `ct_wallets{state="failed", network!="zcash"}`.

## Privacy

Metric labels hold only network names, source names, routes and status codes, never addresses,
account names or amounts. Log lines hold request metadata, not request bodies; passwords, keys
and cookies are redacted before logging. Keep `/metrics` and Loki on internal networks.
