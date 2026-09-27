# Manual + CSV MVP release

Supported first release: manually entered accounts/operations, CSV import and rollback,
manual USD prices and existing accounting previews. Automatic network synchronization
and AI remain deferred. Background collection and optional display FX are disabled.
This is not completion of the full target brief.

## Verified target facts and unresolved access

Read-only inspection on 2026-09-27 verified `agm`, SSH port2211, and trusted ED25519
fingerprint `SHA256:KsIoiJpnYR1x29u2mdomeqq4PYAOem22YaJAKjL62KU`.
`capital.pavelars.ru` resolves to that host and has a valid Let's Encrypt certificate.
Its inactive Nginx configuration currently serves static HTTP; HTTPS `/health` returns404.
No Capital Tracker containers, named/project application volumes or networks were found.
The unknown `/opt/capital-tracker/.env` is root-owned0600 and is preserved. Port3000
belongs to another service; the dedicated application uses loopback3100/3101 only.
The existing `pavelars` login lacks passwordless sudo. `deploy` rejects the same SSH key.
GitHub's existing dedicated deployment key may differ; the reviewed read-only Actions
inventory establishes its permissions without exposing secret values.

## Pipeline and trusted promotion

Keep old upstream automatic CD disabled until replacement is reviewed. Publish through
an explicit GitHub remote, preserving the local repository's existing origin.
Set `DEPLOY_KNOWN_HOSTS` from the verified existing known-host entry, never connection
key discovery; set `DEPLOY_SSH_PORT=2211`. Reuse existing `DEPLOY_HOST`, `DEPLOY_USER`
and `DEPLOY_SSH_KEY`. For pre-main inventory only, root sets `MVP_PREFLIGHT_COMMIT` to
one reviewed published commit on `release/manual-mvp`; the workflow permits that exact
ref/commit and `mode=preflight`. Production promotion remains main-only.

CI exports the actual release images that passed real acceptance, their image IDs and
commit/run manifest. Manual deploy selects a successful main-push CI run for the exact
current main commit, requires every named gate to have succeeded, validates the manifest,
loads and verifies the image IDs, and publishes those same outputs to existing GHCR.
No deployment rebuild or mutable latest promotion is used. Private server receipts record
registry digests, schema ledgers, backup path and verified health. Image scanning and a
real isolated backup-restore rehearsal still require recorded evidence before production.

## Fresh server setup

A privileged operator runs the reviewed `scripts/manual-mvp-server-bootstrap.sh ACCOUNT`
from the reviewed checkout. It refuses existing application data, occupied3100/3101/3102,
and existing release secret files. It creates independent random MFA and backup keys,
strong owner-password input and a private `.env.release`. It preserves existing `.env`,
the inactive capital vhost, apex and other services. It tests Nginx before reloading;
failed configuration retains secrets for inspection and restores the prior target edge.
The owner login name is privately configured `OWNER_EMAIL` in `.env.release`; the default
is `owner@capital.pavelars.ru`, which is only the application login identifier.

Dispatch reviewed CD with `installation=fresh`, `mode=deploy` and the successful CI run.
Fresh mode proves absence again; unexplained volumes prevent installation. It creates
only its dedicated database/cache, observes the actual host-to-container socket peer using
a loopback-only temporary probe, then sets exact proxy trust. It backs up the fresh DB,
verifies isolated restoration, runs explicit migrations, and provisions/ confirms MFA
through the real production CLIs. Password, enrollment URI and recovery codes remain
only in protected server files. A failed fresh install preserves its created DB and stops
applications; do not reset/remove it to force another fresh attempt.

## Existing deployment and recovery

Existing mode requires the current application containers, ledger and exact volume
identity. Pending destructive historical migrations stop before owner-data mutation.
The server lock protects deployment concurrency. A maintenance stop prevents owner
application writes during encrypted backup, isolated restore/fingerprint and migration.
The PostgreSQL service and durable volume are never brought down/replaced. Background
collection stays disabled. Do not permit another DB writer during that maintenance window.

Backups use `pg_dump -Fc` piped directly into OpenSSL AES256-CBC with PBKDF2/200000
iterations; no plaintext dump is persisted. A SHA256 checksum records encrypted bytes.
Decryption streams into a network-disconnected PostgreSQL container with tmpfs storage;
normalized logical schema/data dumps must match before migration. The encryption key
is separate from the backup directory and independently generated from the MFA key.
Copy both keys into access-controlled encrypted operator storage through a trusted
channel; losing the MFA key breaks factor decryption, losing the backup key prevents DB
recovery. Do not upload keys, enrollment, recovery codes or real dumps as CI artifacts.

On a failed existing upgrade, both prior images and preserved Compose configuration
return only if the migration ledger is unchanged, followed by readiness/privacy checks.
Otherwise applications stop and owner data remains preserved for operator recovery.
Image rollback never reverses migrations. There is no automatic old-DB restoration.

For manual restore, first preserve current DB/new writes, verify the selected encrypted
backup checksum, and restore into a NEW isolated PostgreSQL instance using the same
major version. Compare schema/data and confirm the intended data-loss boundary before
any separately authorized switch. Never pipe recovery into the active owner database.
Keep prior images and backup generations; these scripts perform no image/volume pruning.

## Operator access and restart

Retrieve `.owner-password.json`, `operator/enrollment.json` and `operator/recovery.json`
through a trusted encrypted channel into private owner storage; enroll the URI in the
owner authenticator and retain recovery codes offline. These files are never printed by
Actions. Verify password + TOTP login and a read-only manual screen against the deployed
HTTPS origin; routine production smoke uses no reusable factors.

Restart the installed existing project with its recorded project name and every private
environment file, including `.env.images`:

```sh
cd /opt/capital-tracker
docker compose -p capital-tracker --env-file .env.release --env-file .env.images up -d --no-deps --wait backend frontend
```

For older installations also include their original `.env` before `.env.release`, and use
the observed project name, never a guessed volume project. Runtime credentials remain
private. Hosted CI, privileged setup, owner login and actual deployment must be recorded
as completed evidence before calling this release delivered.
