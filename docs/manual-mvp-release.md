# Manual + CSV MVP release

**Release checkpoint:** PostgreSQL18 fresh-install guards, a four-image manifest,
reviewed infrastructure digests and exact image checks are implemented locally.
PostgreSQL18/Redis8 acceptance, actual four-image scans, host bootstrap, the
least-privilege dispatcher and production deployment remain pending.
Do not run bootstrap or production CD from this checkpoint.

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
The existing GitHub deployment key successfully completed read-only Actions run36313627415:
project directory writable, Docker access present, existing `.env` unreadable, no
noninteractive sudo and no enabled capital vhost. Docker access remains host-root
equivalent; this is an explicit operational limitation, not least-privilege proof.
A dedicated restricted SSH identity with a root-owned fixed release dispatcher can
reduce this capability without changing the stack or removing shared deploy rights.
Do not expose an arbitrary shell/script/upload through that dispatcher.

Least privilege remains an unfinished release security requirement. Its bounded
follow-up needs a new Capital-only account/key without Docker-group membership,
restricted SSH forced command and an exact sudo allowlist for one installed dispatcher.
The dispatcher and its runner, Compose, runtime configuration, state and parent
directories must be root-owned regular files, protected against symlink substitution.
It must accept only validated inventory/preflight/deploy requests, bind requested image
digests to successful trusted CI provenance, and use fixed application container,
volume, network, mount and capability settings. It must not evaluate a client command,
accept uploaded executable/configuration files or permit generic Docker/shell operations.
Adversarial command, path, metadata and state-race checks plus operator installation
are necessary before marking this requirement complete. Shared deployment rights stay
unchanged so unrelated hosted services are preserved.

## Pipeline and trusted promotion

Keep old upstream automatic CD disabled until replacement is reviewed. Publish through
an explicit GitHub remote, preserving the local repository's existing origin.
Set `DEPLOY_KNOWN_HOSTS` from the verified existing known-host entry, never connection
key discovery; set `DEPLOY_SSH_PORT=2211`. Reuse existing `DEPLOY_HOST`, `DEPLOY_USER`
and `DEPLOY_SSH_KEY`. For pre-main inventory only, root sets `MVP_PREFLIGHT_COMMIT` to
one reviewed published commit on `release/manual-mvp`; the workflow permits that exact
ref/commit and `mode=preflight`. Production promotion remains main-only.

CI exports the actual release images that passed real acceptance, their image IDs and
commit/run version-2 manifest. Reviewed linux/amd64 PostgreSQL18.6 and Redis8.10.2
platform digests are in `deploy/manual-mvp-infrastructure-pins.json`, separate from
the candidate manifest. CI pulls those digests before acceptance, scans all four
exact images and saves them in one candidate archive. Manual deploy selects a successful main-push CI run for the exact
current main commit, requires every named gate to have succeeded, validates the manifest,
loads and verifies the image IDs, and publishes those same outputs to existing GHCR.
No deployment rebuild or mutable latest promotion is used. Private server receipts record
registry digests, schema ledgers, backup path and verified health. Pinned Trivy v0.74.0 scans exact tested images for vulnerabilities and secrets;
unresolved high/critical findings block export. Complete finding identifiers and lower
severities remain in sanitized reports; raw secret matches/image environment details are
removed before upload. Fresh bootstrap checks the infrastructure arguments against
the reviewed pins. Existing releases compare candidate infrastructure image IDs to
the running PostgreSQL and Redis before downtime; fresh releases require the pinned
digest references. Actual four-image scan results and a real PostgreSQL18 backup-restore rehearsal
still require recorded evidence before production.

## Fresh server setup

A privileged operator runs the reviewed `scripts/manual-mvp-server-bootstrap.sh ACCOUNT POSTGRES_DIGEST REDIS_DIGEST`
from the reviewed checkout. It refuses existing application data, occupied3100/3101/3102,
and existing release secret files. It creates independent random MFA and backup keys,
strong owner-password input and a private `.env.release`. It preserves existing `.env`,
the inactive capital vhost, apex and other services. It tests Nginx before reloading;
failed configuration retains secrets for inspection and restores the prior target edge.
The public image arguments must be the scanned, accepted official repository digests
for PostgreSQL18.6 and Redis8.10.2. Fresh PostgreSQL18 mounts `/var/lib/postgresql`,
including its version-specific PGDATA directory. Existing PostgreSQL16 retains
`/var/lib/postgresql/data`; a major or mount mismatch refuses the release before downtime.
No in-place major upgrade of owner data or the PostgreSQL16 preview is authorized.
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

Every attempt keeps distinct UTC/PID receipt and prior selection snapshots under its
commit directory. Generated fresh installations persist a managed-environment marker so
later upgrades never read the preserved unknown original `.env`.

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

## Current isolated evidence (2026-09-27)

Actual PostgreSQL16.10 rehearsal migrated schema22 and seeded independent exact decimal,
JSON and bytea rows. Encrypted custom backup, disconnected tmpfs restore, direct source
schema/data comparison, unchanged source and real failed-dump propagation passed.
Initial attempts failed exact SQL equality because PostgreSQL reparses three CHECK
expressions into equivalent deparser forms. `normalize-release-snapshot.awk` maps only
those three exact reviewed complete lines; altered bounds/operands, all other DDL and
all COPY rows remain fingerprint-visible. It protects COPY/dollar-quoted contents and
never strips constraints. Evidence: `/private/tmp/capital-mvp-backup-rehearsal{,2,3}.log`.
This is synthetic restoration evidence; the real server backup still executes in release.

Actual Trivy0.74.0 scan of BE049c5e91 and FE28faa7ab found5critical/55high and2critical/35high
respectively, with no secret findings. The gate correctly blocks both artifacts. Backend
language findings belong to inherited global npm tooling, while OpenSSL/musl/zlib and
frontend image OS packages also need fixes. No finding is suppressed. Full sanitized
reports are `/private/tmp/capital-{backend,frontend}-image-security.json`; updated image
builds and rescans are still required. Dependency audit0 does not override image findings.
The scanner release tarball checksum was verified against the official release checksum.

Before setup, the privileged owner executes the independently tested read-only
`manual-mvp-data-assessment.sh`; it reports only flags, fails closed on unparsed/unknown
configuration or possible external/local database references and unexpected stored data,
and makes no database connection or filesystem change. Do not paste `.env` values.
Only a clear assessment permits the separately reviewed root bootstrap. Off-host key/
backup custody remains an operator action; server-local copies alone are insufficient.
