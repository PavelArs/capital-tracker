#!/usr/bin/env bash
# Server release: no runtime secrets are sourced as shell code or logged.
set -Eeuo pipefail
umask 077
mode=${1:?Use preflight or deploy}
installation=${RELEASE_INSTALLATION:-existing}
[[ $installation == existing || $installation == fresh ]] || exit 2
commit=${2:?Required commit}
backend=${3:-}
frontend=${4:-}
[[ $mode == preflight || $mode == deploy ]] || exit 2
[[ $commit =~ ^[a-f0-9]{40}$ ]] || exit 2
root=${RELEASE_ROOT:-/opt/capital-tracker}
candidate=${RELEASE_COMPOSE_FILE:?Required candidate Compose file}
runtime=${RELEASE_RUNTIME_FILE:-$root/.env.release}
normalizer=$(cd "$(dirname "$0")" && pwd)/normalize-release-snapshot.awk
[[ -f $normalizer ]] || exit 1
cd "$root"
for tool in docker jq flock curl openssl sha256sum awk; do command -v "$tool" >/dev/null; done
[[ -f .env && -f $runtime && ! -L $runtime ]] || { echo 'Missing private release runtime configuration'; exit 1; }
# This lock serializes server operations independently of Actions concurrency.
exec 9>"$root/.release.lock"
flock -n 9 || { echo 'Another release holds the server lock'; exit 1; }
if [[ $installation == existing ]]; then
  [[ -f "$root/docker-compose.yml" ]] || exit 1
  db=$(docker inspect capital_tracker_db --format '{{.Id}}')
  project=$(docker inspect "$db" --format '{{index .Config.Labels "com.docker.compose.project"}}')
  actual_major=$(docker exec "$db" sh -c 'cat "$PGDATA/PG_VERSION"')
else
  project=capital-tracker
  # An orphan volume is owner data until positively reviewed. Never attach it implicitly.
  containers=$(docker ps -a --format '{{.Names}}')
  volumes=$(docker volume ls --format '{{.Name}}')
  [[ -z $(grep -E '^capital_tracker_(db|redis|backend|frontend)$' <<<"$containers" || true) ]] || { echo 'Fresh install refused: application containers already exist'; exit 1; }
  [[ -z $(grep -Ei 'capital|tracker' <<<"$volumes" || true) ]] || { echo 'Fresh install refused: unexplained application data volume'; exit 1; }
  labeled_volumes=$(docker volume ls -q --filter label=com.docker.compose.project=capital-tracker)
  [[ -z $labeled_volumes ]] || exit 1
fi
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ && $project != *e2e* && $project != *preview* ]] || exit 1
image_env=()
[[ ! -f "$root/.env.images" ]] || image_env=(--env-file "$root/.env.images")
base_env=(--env-file "$root/.env")
[[ $installation == existing && ! -f "$root/.release-managed-env" ]] || base_env=()
dc() { docker compose --project-directory "$root" -p "$project" "${base_env[@]}" --env-file "$runtime" "${image_env[@]}" -f "$candidate" "$@"; }
# Never print rendered configuration, which contains passwords.
config=$(dc config --format json)
expected_major=$(jq -er '.services.postgres.environment.CAPITAL_EXPECTED_MAJOR' <<<"$config")
candidate_target=$(jq -er '.services.postgres.volumes[] | select(.type=="volume" and .source=="postgres_data") | .target' <<<"$config")
[[ $expected_major == 16 || $expected_major == 18 ]] || { echo 'Unsupported PostgreSQL major'; exit 1; }
if [[ $expected_major == 18 ]]; then expected_target=/var/lib/postgresql; else expected_target=/var/lib/postgresql/data; fi
[[ $candidate_target == "$expected_target" ]] || { echo 'PostgreSQL volume layout mismatch'; exit 1; }
if [[ $installation == existing ]]; then
  [[ $actual_major == "$expected_major" ]] || { echo 'PostgreSQL major change refused; preserve existing data'; exit 1; }
  volume=$(docker inspect "$db" | jq -er --arg target "$candidate_target" '.[0].Mounts[] | select(.Destination==$target and .Type=="volume") | .Name')
else
  [[ $expected_major == 18 ]] || { echo 'Fresh installation requires PostgreSQL18'; exit 1; }
fi
origin=$(jq -er '.services.backend.environment.FRONTEND_URL' <<<"$config")
[[ $origin =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo 'Invalid HTTPS origin'; exit 1; }
key=$(jq -er '.services.backend.volumes[] | select(.target=="/run/secrets/ct-mfa-key") | .source' <<<"$config")
[[ -f $key && ! -L $key && $(stat -c %s "$key") == 32 ]] || { echo 'MFA key unavailable'; exit 1; }
[[ $(stat -c %a "$key") == 400 || $(stat -c %a "$key") == 600 ]] || exit 1
backup_key=${RELEASE_BACKUP_KEY_FILE:-$root/.backup-key}
[[ -f $backup_key && ! -L $backup_key && $(stat -c %s "$backup_key") -ge 32 ]] || { echo 'Private backup key unavailable'; exit 1; }
[[ $(stat -c %a "$backup_key") == 400 || $(stat -c %a "$backup_key") == 600 ]] || exit 1
[[ $backup_key != "$root/backups/"* ]] || exit 1
# Verify target project maps precisely to the existing durable volume.
[[ $installation == fresh || $(jq -er '.volumes.postgres_data.name' <<<"$config") == "$volume" ]] || { echo 'Database volume identity mismatch'; exit 1; }
[[ $(jq -er '.services.backend.environment.BACKGROUND_JOBS_ENABLED' <<<"$config") == false ]] || exit 1
jq -e --arg installation "$installation" '.services.backend.environment.TRUSTED_PROXY_IPS | fromjson | type=="array" and (length>0 or $installation=="fresh")' <<<"$config" >/dev/null
jq -e '.services.backend.environment.MFA_KEY_ID | length>0' <<<"$config" >/dev/null
# Anonymous checks never authenticate with owner factors or expose private response bodies.
smoke() {
  [[ $(curl --fail --silent --show-error --max-time 10 "$origin/health") == '{"status":"ok"}' ]] || return 1
  local route code
  for route in auth/me accounting/accounts assets crypto/wallets metrics health/details; do
    code=$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "$origin/api/$route")
    [[ $code == 401 ]] || return 1
  done
}
# Schema names alone contain no owner portfolio values.
ledger() { docker exec "$db" sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT name FROM migrations ORDER BY id"'; }
if [[ $installation == existing ]]; then before=$(ledger); else before=''; fi
# Explicit refusal before changing owner data; migrate.js also enforces this invariant.
if [[ $installation == existing ]]; then
for migration in MigrateCurrencyToForeignKey1764000000000 DropStubModuleTables1764100000000 DropRemovedModuleTables1764200000000 CleanupCryptoTypeEnum1764300000000; do
  [[ $before == *"$migration"* ]] || { echo 'Legacy schema requires a separate data-preserving upgrade plan'; exit 1; }
done
smoke || { echo 'Existing HTTPS readiness/privacy preflight failed'; exit 1; }
else
  # TLS identity must already be valid; an absent app may return 404/502 before first deployment.
  curl --silent --show-error --max-time 10 --output /dev/null "$origin/"
fi
if [[ $mode == preflight ]]; then
  echo 'Read-only preflight passed: existing project/volume, configuration, key and HTTPS privacy boundaries verified'
  exit 0
fi
[[ $backend =~ ^ghcr.io/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$ && $frontend =~ ^ghcr.io/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$ ]] || exit 2
if [[ $installation == existing ]]; then
previous_backend=$(docker inspect capital_tracker_backend --format '{{.Image}}')
previous_frontend=$(docker inspect capital_tracker_frontend --format '{{.Image}}')
[[ $previous_backend =~ ^sha256:[a-f0-9]{64}$ && $previous_frontend =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
else
previous_backend=none
previous_frontend=none
fi
probe_container="capital-release-proxy-${commit:0:12}-$$"
restore_container="capital-release-restore-${commit:0:12}-$$"
state="$root/releases/$commit/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$state" "$root/backups"
if [[ $installation == existing ]]; then cp "$root/docker-compose.yml" "$state/previous-compose.yml"; fi
backup="$root/backups/$commit-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
for file in .env.images docker-compose.yml .release-managed-env; do
  if [[ -f "$root/$file" ]]; then cp "$root/$file" "$state/previous-${file#.}"; fi
done
activation_started=false
apps_stopped=false
success=false
restore_metadata() {
  local file
  for file in .env.images docker-compose.yml .release-managed-env; do
    if [[ -f "$state/previous-${file#.}" ]]; then
      cp "$state/previous-${file#.}" "$root/$file.recovery" && mv "$root/$file.recovery" "$root/$file" || return 1
    elif [[ -f "$root/$file" ]]; then
      mv "$root/$file" "$state/failed-${file#.}" || return 1
    fi
  done
}
cleanup() {
  local status=$?
  trap - EXIT
  docker container rm -f "$probe_container" "$restore_container" >/dev/null 2>&1 || true
  metadata_ok=true
  if [[ $success != true && $activation_started == true ]]; then
    restore_metadata || metadata_ok=false
  fi
  if [[ $success != true && $apps_stopped == true ]]; then
    if [[ $metadata_ok == true && $installation == existing && $(ledger) == "$before" ]]; then
      candidate="$state/previous-compose.yml"
      if BACKEND_IMAGE="$previous_backend" FRONTEND_IMAGE="$previous_frontend" dc up -d --no-deps --wait --wait-timeout 120 backend frontend && smoke; then
        echo 'Release failed; previous application pair readiness and privacy verified against unchanged schema'
      else
        dc stop backend frontend || true
        echo 'Release and application recovery failed; applications stopped. Manual recovery required'
      fi
    else
      dc stop backend frontend || true
      echo 'Release failed without compatible prior application pair; applications stopped. Created/existing database preserved; manual recovery required'
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
# Pull candidates before downtime; retain existing images and durable containers.
BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc pull backend frontend
# Maintenance window makes dump, restored fingerprint and migration one write-free boundary.
apps_stopped=true
if [[ $installation == existing ]]; then
  dc stop backend frontend
else
  # Fresh data creation follows explicit absence proof; never overwrite an existing project.
  dc up -d --wait --wait-timeout 120 postgres redis
  db=$(docker inspect capital_tracker_db --format '{{.Id}}')
  [[ $(docker exec "$db" sh -c 'cat "$PGDATA/PG_VERSION"') == "$expected_major" ]] || { echo 'Initialized PostgreSQL major mismatch'; exit 1; }
  network=$(docker inspect "$db" | jq -er '.[0].NetworkSettings.Networks | keys | select(length==1) | .[0]')
  # Observe the actual host->container socket path, never infer it from forwarding headers.
  docker run -d --name "$probe_container" --network "$network" -p 127.0.0.1:3102:3000 --entrypoint node "$backend" \
    -e 'require("http").createServer((req,res)=>res.end(req.socket.remoteAddress)).listen(3000,"0.0.0.0")' >/dev/null
  peer=''
  for attempt in {1..30}; do
    if peer=$(curl --fail --silent --max-time 2 http://127.0.0.1:3102/); then break; fi
    sleep 1
  done
  [[ $peer =~ ^(::ffff:)?[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Proxy socket observation failed'; exit 1; }
  docker container rm -f "$probe_container" >/dev/null
  [[ $(grep -c '^TRUSTED_PROXY_IPS=' "$runtime") == 1 ]] || exit 1
  sed -i "s|^TRUSTED_PROXY_IPS=.*|TRUSTED_PROXY_IPS=[\"$peer\"]|" "$runtime"
fi
pg_image=$(docker inspect "$db" --format '{{.Image}}')
docker exec "$db" sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$backup_key" -out "$backup"
sha256sum "$backup" >"$backup.sha256"
sha256sum -c "$backup.sha256" >/dev/null
# Dedicated disconnected, tmpfs-only rehearsal; never restore into owner's PostgreSQL.
docker run -d --name "$restore_container" --network none --tmpfs "$candidate_target" \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$pg_image" >/dev/null
for attempt in {1..60}; do
  if docker exec "$restore_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$backup_key" -in "$backup" \
  | docker exec -i "$restore_container" pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges -U postgres -d postgres
# Compare normalized logical SQL output, including actual rows and schema, not merely exit codes.
fingerprint() {
  docker exec "$1" sh -c 'pg_dump --no-owner --no-privileges -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"' \
    | awk -f "$normalizer" | sha256sum | cut -d' ' -f1
}
[[ $(fingerprint "$db") == $(fingerprint "$restore_container") ]] || { echo 'Isolated backup restore fingerprint mismatch'; exit 1; }
printf '%s\n' "$before" >"$state/migrations-before"
printf '%s\n%s\n' "$previous_backend" "$previous_frontend" >"$state/previous-images"
BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc run --rm --no-deps backend node backend/dist/migrate.js
ledger >"$state/migrations-after"
if [[ $installation == fresh ]]; then
  # Real production CLIs provision the owner and confirm a separately generated factor.
  # Password/factor/recovery material stays in private operator files, never Actions output.
  [[ -f "$root/.owner-password.json" && ! -L "$root/.owner-password.json" ]] || exit 1
  email=$(sed -n 's/^OWNER_EMAIL=//p' "$runtime")
  [[ $email =~ ^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$ ]] || exit 1
  BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc run --rm --no-deps -T backend \
    node backend/dist/owner-cli.js bootstrap --email "$email" --password-stdin < "$root/.owner-password.json"
  owner_id=$(docker exec "$db" sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT \"userId\" FROM owner_auth WHERE id=1"')
  [[ $owner_id =~ ^[a-f0-9-]{36}$ ]] || exit 1
  BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc run --rm --no-deps -T -v "$root/operator:/operator" backend \
    node backend/dist/mfa-cli.js prepare --user-id "$owner_id" --output /operator/enrollment.json
  candidate_id=$(BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc run --rm --no-deps -T -v "$root/operator:/operator:ro" backend \
    node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("/operator/enrollment.json")).candidateId)')
  [[ $candidate_id =~ ^[a-f0-9-]{36}$ ]] || exit 1
  BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc run --rm --no-deps -T -v "$root/operator:/operator:ro" backend \
    node -e 'const f=JSON.parse(require("fs").readFileSync("/operator/enrollment.json")); const totp=require("/app/backend/node_modules/otpauth").URI.parse(f.uri); process.stdout.write(JSON.stringify({code:totp.generate()}))' \
    | BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc run --rm --no-deps -T -v "$root/operator:/operator" backend \
      node backend/dist/mfa-cli.js confirm --user-id "$owner_id" --candidate-id "$candidate_id" --output /operator/recovery.json --code-stdin
fi
BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc up -d --no-deps --wait --wait-timeout 120 backend frontend
smoke || { echo 'Candidate HTTPS readiness/privacy verification failed'; exit 1; }
# Stage all selection/receipt/configuration files before activation. Recovery restores
# the previous metadata pair as well as containers if publication fails.
printf 'BACKEND_IMAGE=%s\nFRONTEND_IMAGE=%s\n' "$backend" "$frontend" >"$root/.env.images.next"
printf 'commit=%s\nbackend=%s\nfrontend=%s\nbackup=%s\nhealth=passed\n' "$commit" "$backend" "$frontend" "$backup" >"$state/receipt.next"
cp "$candidate" "$root/docker-compose.yml.next"
if [[ $installation == fresh ]]; then printf 'generated-runtime-only\n' >"$root/.release-managed-env.next"; fi
activation_started=true
mv "$root/.env.images.next" "$root/.env.images"
mv "$root/docker-compose.yml.next" "$root/docker-compose.yml"
if [[ $installation == fresh ]]; then mv "$root/.release-managed-env.next" "$root/.release-managed-env"; fi
mv "$state/receipt.next" "$state/receipt"
success=true
echo 'Release verified; private server receipt records images, schema and encrypted backup'
