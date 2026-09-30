# Manual + CSV MVP release

**Release checkpoint:** PostgreSQL18 fresh-install guards, a four-image manifest,
reviewed infrastructure digests and exact image checks are implemented locally.
PostgreSQL18/Redis8 acceptance, actual four-image scans, host bootstrap, host
installation of the least-privilege dispatcher and production deployment remain pending.
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

### Restricted release dispatcher (MVP-007)

Implemented, not yet installed on the host. Actions no longer uses the shared
Docker-capable key. It reaches the server only as the Capital-only `capital-release`
principal, which is not in the docker group. Its root-owned `authorized_keys` entry is
`restrict,command="sudo -n /usr/local/libexec/capital-tracker/manual-mvp-dispatcher"`,
and `/etc/sudoers.d/capital-release` allows exactly that dispatcher with no arguments.
Shared deployment rights of other hosted services are unchanged.

The dispatcher reads one JSON request of at most 4096 bytes:
`{"version":1,"operation":"inventory|preflight|deploy","commit":"<40 hex>","runId":"<digits>"}`.
Unknown or duplicate fields, trailing data and command-line arguments are refused.
`inventory` runs the installed read-only inventory. `preflight`/`deploy` require the
owner-approved receipt `/etc/capital-tracker/release-receipts/<commit>-<runId>.json`;
image digests and installation mode come only from it. Before starting the runner it
checks that the installed runner, inventory, normalizer, Compose and pin files match the
receipt SHA256 values, that receipt PostgreSQL/Redis equal the reviewed pins and that
application images are `ghcr.io/pavelars/capital-tracker-{backend,frontend}` digests.
The receipt, installed files, their ancestors and the entire `/opt/capital-tracker` tree
(including `.env`, `.env.release`, `.backup-key`, `releases/` and `backups/`) must be
root-owned, free of symlinks and not group/world writable. The only exceptions are the
bootstrap-created `.mfa-key` and `operator/` subtree, which may belong to the container
user uid1000; they remain symlink-free and not group/world writable. Host uid1000 can
therefore read the MFA key; that is an existing bootstrap property, not added here. The runner starts with a
constructed environment and `DOCKER_CONFIG=/etc/capital-tracker/docker-config`, never
root's general registry login; that directory must not contain `cli-plugins`.
A deploy moves its receipt to `release-receipts/used/` before the runner starts, so
each approval authorizes exactly one deploy attempt; a retry needs a new `approve`.
Inventory now runs as root: it reports root's view, including `.env` setting names
(never values), not the capabilities of the restricted principal.

Release flow:

1. `mode=inventory` (pinned release commit or main) runs the read-only inventory.
2. `mode=promote` on main validates the successful CI run, pushes the identical tested
   images to GHCR and uploads the `manual-mvp-release-receipt` artifact; the job summary
   shows the same JSON for review.
3. The owner reviews the receipt and, as root on the server, runs
   `scripts/manual-mvp-dispatcher-install.sh approve RECEIPT` from a clean Git checkout
   of exactly that commit (after `install` below if server files changed). It validates
   and installs one private copy and warns when installed server files differ. Git's
   ownership check may require `git config --global --add safe.directory <checkout>`
   for root when the checkout belongs to another user.
4. `mode=preflight`, then `mode=deploy`, with the same `ci_run_id`.

One-time operator setup, as root from the reviewed checkout of the release commit:

```sh
scripts/manual-mvp-dispatcher-install.sh install /path/to/capital-release.pub
# Registry read access for private GHCR packages (read:packages token only):
install -d -o root -g root -m 0700 /etc/capital-tracker/docker-config
DOCKER_CONFIG=/etc/capital-tracker/docker-config docker login ghcr.io -u OWNER
# Then fix every path the install step reports under /opt/capital-tracker.
```

Private GHCR pull access remains an operator prerequisite: provision a protected
`read:packages` credential with access to the three Capital image packages, log in
interactively through the dedicated root Docker configuration, and never put it in
a receipt, workflow request, shell argument or log. The data-only dispatcher cannot
install credentials; it does not inherit an old CD token or root’s general login.
Verify package access privately before deployment. This source change does not claim
that the server already has that access.

Re-run `install` whenever a release changes a server file listed in the receipt;
otherwise the dispatcher refuses the mismatch. The install step reports existing
`AllowUsers`/`AllowGroups` rules and any runtime path that the dispatcher will refuse.
In GitHub, create environment `production` (recommended: required reviewer and main-only
deployment branch), add its secret `DEPLOY_DISPATCH_SSH_KEY` (new ED25519 private key)
and variable `DEPLOY_DISPATCH_USER=capital-release`. The key must be an environment
secret, not a repository secret, for the environment protection to matter. After
the restricted principal works, retire the obsolete repository-level
`DEPLOY_SSH_KEY` from this repository’s Actions access through an owner-coordinated
cutover. Its retained root-equivalent authority would bypass the new boundary.
Do not revoke shared host keys or change unrelated services’ deployment access;
least-privilege operational completion requires evidence of this credential cutover. A main-only
branch rule would also block `mode=inventory` from `release/manual-mvp`; allow that
branch or run inventory from main; keep `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS` and
`DEPLOY_SSH_PORT=2211`. `/opt/capital-tracker` was writable by the shared deploy user
on 2026-09-27; it must become root-owned before preflight/deploy.

Evidence: `pnpm test:security` (Python request/receipt/file/runtime/entry-point cases)
and ENG-002 gates. Not yet evidenced: installation on the real host, sshd/sudo behaviour
there, and an actual Actions inventory/deploy through the dispatcher.

## Pipeline and trusted promotion

Keep old upstream automatic CD disabled until replacement is reviewed. Publish through
an explicit GitHub remote, preserving the local repository's existing origin.
Set `DEPLOY_KNOWN_HOSTS` from the verified existing known-host entry, never connection
key discovery; set `DEPLOY_SSH_PORT=2211`. Reuse existing `DEPLOY_HOST`; the release no longer
uses `DEPLOY_USER`/`DEPLOY_SSH_KEY` (see MVP-007 above). For pre-main inventory only, root sets `MVP_PREFLIGHT_COMMIT` to
one reviewed published commit on `release/manual-mvp`; the workflow permits that exact
ref/commit and `mode=inventory`. Production promotion remains main-only.

CI exports the actual release images that passed real acceptance, their image IDs and
commit/run schema-v3 manifest. Reviewed PostgreSQL Dockerfile hash and official
18.6 Alpine3.24 base digest, plus the official Redis8.10.2 platform digest, are in `deploy/manual-mvp-infrastructure-pins.json`, separate from
the candidate manifest. CI verifies the Dockerfile hash, builds the derived PostgreSQL image with the exact
commit revision label through acceptance, pulls the Redis digest, scans all four
exact images and saves them in one candidate archive. Manual deploy selects a successful main-push CI run for the exact
current main commit, requires every named gate to have succeeded, validates the manifest,
loads and verifies the image IDs, and publishes those same outputs to existing GHCR.
No deployment rebuild or mutable latest promotion is used. Private server receipts record
registry digests, schema ledgers, backup path and verified health. Pinned Trivy v0.74.0 scans exact tested images for vulnerabilities and secrets;
unresolved high/critical findings block export. Complete finding identifiers and lower
severities remain in sanitized reports; raw secret matches/image environment details are
removed before upload. Fresh bootstrap checks PostgreSQL’s actual promoted GHCR digest against a root-reviewed
fresh receipt; its official base digest is only a source input. Redis stays official and
must match the reviewed pin. Existing releases compare candidate infrastructure image IDs to
the running PostgreSQL and Redis before downtime; fresh releases require the pinned
digest references. Actual four-image scan results and a real PostgreSQL18 backup-restore rehearsal
still require recorded evidence before production.

## Fresh server setup

A privileged operator runs the reviewed `scripts/manual-mvp-server-bootstrap.sh ACCOUNT POSTGRES_DIGEST REDIS_DIGEST /root/capital-release/COMMIT-RUN.json`
from the reviewed checkout. It refuses existing application data, occupied3100/3101/3102,
and existing release secret files. It creates independent random MFA and backup keys,
strong owner-password input and a private `.env.release`. It preserves existing `.env`,
the inactive capital vhost, apex and other services. It tests Nginx before reloading;
failed configuration retains secrets for inspection and restores the prior target edge.
First promote the successful exact candidate with `installation=fresh`. Privately
review its receipt and place it under `/root/capital-release/` with root ownership,
mode0600 and root-owned, non-writable, non-symlink ancestors. This is reviewed bootstrap
metadata, not the final single-use deployment approval. Both digest arguments must
match this strict receipt: PostgreSQL uses `ghcr.io/pavelars/capital-tracker-postgres@sha256:…`,
Redis uses the reviewed official `redis@sha256:…`. Receipt identity and every reviewed
server source hash must match before bootstrap changes any server file. Fresh PostgreSQL18 mounts `/var/lib/postgresql`,
including its version-specific PGDATA directory. Existing PostgreSQL16 retains
`/var/lib/postgresql/data`; a major or mount mismatch refuses the release before downtime.
No in-place major upgrade of owner data or the PostgreSQL16 preview is authorized.
The owner login name is privately configured `OWNER_EMAIL` in `.env.release`; the default
is `owner@capital.pavelars.ru`, which is only the application login identifier.

After bootstrap, install the root-owned dispatcher/server files, then approve the
same receipt through the installer’s `approve` operation. Dispatch `mode=deploy` with
the same commit/CI run. This order avoids requiring the runtime directory before
bootstrap; bootstrap metadata alone does not authorize a dispatcher deployment.
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
