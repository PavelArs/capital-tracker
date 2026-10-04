## Why

Every release today needs eight manual steps: dispatch `promote`, download the
receipt, copy it to the server, approve it as root from a clean checkout, then
dispatch `inventory`, `preflight` and `deploy` with the same CI run id. The owner
asked (2026-10-04) for deployment after green main CI with one approval click
instead ("С кнопкой" on the deploy decision).

The first release attempt also stopped half-way on 2026-10-02 (run 37001810387):
migrations ran, the owner and MFA were provisioned, then the frontend container was
reported unhealthy and both applications were stopped. No installation mode can
continue from that state: `fresh` sees existing containers, `resume-fresh` requires
an empty cluster, and `existing` requires a previously activated release. The
production Compose health check still calls `http://localhost:80/` while the image's
own check and acceptance use `127.0.0.1`; inside a container whose `localhost`
resolves to `::1`, the IPv4-only Nginx listener refuses it (unverified on the host,
but it is the only difference between the passing and failing checks).

## What Changes

- `Deploy Manual MVP` also runs on `workflow_run` after a successful `CI` push run on
  main and performs a new `release` mode: provenance validation, promotion,
  preflight and deploy in one job. The job keeps `environment: production`, so the
  owner's required reviewer approves it with the GitHub "Approve and deploy" button.
- Manual dispatch keeps `inventory`, `promote`, `preflight` and `deploy` and gains
  `release` plus the `resume-activation` installation choice.
- The dispatcher accepts a version 2 `preflight`/`deploy` request that carries the
  promoted receipt itself. It applies every existing receipt check (identity,
  immutable application and infrastructure digests, installed server-file hashes).
  The environment approval replaces the root-installed receipt for this path;
  version 1 requests and owner-installed receipts keep working unchanged.
- A new explicit `resume-activation` installation completes the interrupted
  activation: it requires the provisioned owner and confirmed MFA from the earlier
  attempt and no activation metadata, then runs the normal backup, isolated restore,
  migration, application start, privacy smoke and activation without provisioning
  the owner again.
- An `existing` release without an activated release now names the recovery mode
  in its refusal instead of exiting silently.
- The production Compose frontend health check uses `127.0.0.1`.
- The installer gains `update`, which refreshes the dispatcher and reviewed server
  files from the checkout without touching the SSH key, account, sudo rule or
  receipts.

## Capabilities

### New Capabilities
- `release-approval`: approved automatic release after green main CI, request-carried
  receipts, interrupted-activation recovery, IPv4 frontend health and server-file
  update.

### Modified Capabilities
- `engineering-gates`: ENG-002 no longer forbids a CI-triggered entry; it requires
  the protected environment approval for it instead.

## Impact

Files: `.github/workflows/cd.yml`, `scripts/manual-mvp-dispatcher.py`,
`scripts/manual-mvp-release.sh`, `scripts/manual-mvp-dispatcher-install.sh`,
`scripts/manual-mvp-receipt.py` (accepts the new installation through the shared
validator), `docker-compose.yml`, release docs and their tests.

Data impact: none in source. On the server, `resume-activation` takes the same
encrypted backup and isolated restore before migrations as every release, never
recreates PostgreSQL or Redis and never provisions the owner. A failed attempt stops
the applications and preserves the database, as today.

Security impact: a GitHub account able to approve the `production` environment (or
the environment secret itself) can now deploy any promoted
`ghcr.io/pavelars/capital-tracker-*` digest pair without a root step. Server files
(runner, Compose, pins) still come only from a root `install`/`update`, so a
compromised workflow still cannot change what runs as root on the host. Without a
required reviewer on `production`, the automatic path deploys without a click; the
owner must keep that protection rule.

Server rollout: once, as root, run `scripts/manual-mvp-dispatcher-install.sh update`
from a clean checkout of the merged commit, so the new dispatcher and Compose file
are installed; then dispatch `release` with `installation=resume-activation` once.

Depends on: active changes `release-manual-mvp` and `fix-interrupted-mvp-release`
(their runner, dispatcher and receipts). Non-goals: changing backup/restore,
migration, smoke or rollback behaviour, PostgreSQL/Redis replacement, removing the
owner-installed receipt path, and automatic rollback of an approved deploy.
