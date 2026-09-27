#!/usr/bin/env bash
# Server release: no runtime secrets are sourced as shell code or logged.
set -Eeuo pipefail
umask 077
mode=${1:?Use preflight or deploy}
commit=${2:?Required commit}
backend=${3:-}
frontend=${4:-}
[[ $mode == preflight || $mode == deploy ]] || exit 2
[[ $commit =~ ^[a-f0-9]{40}$ ]] || exit 2
root=${RELEASE_ROOT:-/opt/capital-tracker}
candidate=${RELEASE_COMPOSE_FILE:?Required candidate Compose file}
runtime=${RELEASE_RUNTIME_FILE:-$root/.env.release}
cd "$root"
for tool in docker jq flock curl openssl sha256sum; do command -v "$tool" >/dev/null; done
[[ -f .env && -f $runtime && ! -L $runtime ]] || { echo 'Missing private release runtime configuration'; exit 1; }
# This lock serializes server operations independently of Actions concurrency.
exec 9>"$root/.release.lock"
flock -n 9 || { echo 'Another release holds the server lock'; exit 1; }
db=$(docker inspect capital_tracker_db --format '{{.Id}}')
project=$(docker inspect "$db" --format '{{index .Config.Labels "com.docker.compose.project"}}')
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ && $project != *e2e* && $project != *preview* ]] || exit 1
volume=$(docker inspect "$db" | jq -er '.[0].Mounts[] | select(.Destination=="/var/lib/postgresql/data" and .Type=="volume") | .Name')
[[ -n $volume ]] || exit 1
image_env=()
[[ ! -f "$root/.env.images" ]] || image_env=(--env-file "$root/.env.images")
dc() { docker compose -p "$project" --env-file "$root/.env" --env-file "$runtime" "${image_env[@]}" -f "$candidate" "$@"; }
# Never print rendered configuration, which contains passwords.
config=$(dc config --format json)
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
[[ $(jq -er '.volumes.postgres_data.name' <<<"$config") == "$volume" ]] || { echo 'Database volume identity mismatch'; exit 1; }
[[ $(jq -er '.services.backend.environment.BACKGROUND_JOBS_ENABLED' <<<"$config") == false ]] || exit 1
jq -e '.services.backend.environment.TRUSTED_PROXY_IPS | fromjson | type=="array" and length>0' <<<"$config" >/dev/null
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
before=$(ledger)
# Explicit refusal before changing owner data; migrate.js also enforces this invariant.
for migration in MigrateCurrencyToForeignKey1764000000000 DropStubModuleTables1764100000000 DropRemovedModuleTables1764200000000 CleanupCryptoTypeEnum1764300000000; do
  [[ $before == *"$migration"* ]] || { echo 'Legacy schema requires a separate data-preserving upgrade plan'; exit 1; }
done
smoke || { echo 'Existing HTTPS readiness/privacy preflight failed'; exit 1; }
if [[ $mode == preflight ]]; then
  echo 'Read-only preflight passed: existing project/volume, configuration, key and HTTPS privacy boundaries verified'
  exit 0
fi
[[ $backend =~ ^ghcr.io/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$ && $frontend =~ ^ghcr.io/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$ ]] || exit 2
previous_backend=$(docker inspect capital_tracker_backend --format '{{.Image}}')
previous_frontend=$(docker inspect capital_tracker_frontend --format '{{.Image}}')
[[ $previous_backend =~ ^sha256:[a-f0-9]{64}$ && $previous_frontend =~ ^sha256:[a-f0-9]{64}$ ]] || exit 1
pg_image=$(docker inspect "$db" --format '{{.Image}}')
restore_container="capital-release-restore-${commit:0:12}-$$"
state="$root/releases/$commit"
mkdir -p "$state" "$root/backups"
backup="$root/backups/$commit-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
apps_stopped=false
success=false
cleanup() {
  local status=$?
  trap - EXIT
  docker container rm -f "$restore_container" >/dev/null 2>&1 || true
  if [[ $success != true && $apps_stopped == true ]]; then
    if [[ $(ledger) == "$before" ]]; then
      if BACKEND_IMAGE="$previous_backend" FRONTEND_IMAGE="$previous_frontend" dc up -d --no-deps --wait --wait-timeout 120 backend frontend && smoke; then
        echo 'Release failed; previous application pair readiness and privacy verified against unchanged schema'
      else
        dc stop backend frontend || true
        echo 'Release and application recovery failed; applications stopped. Manual recovery required'
      fi
    else
      dc stop backend frontend || true
      echo 'Release failed after schema change; applications stopped. Manual recovery required; database was not restored'
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
# Pull candidates before downtime; retain existing images and durable containers.
BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc pull backend frontend
# Maintenance window makes dump, restored fingerprint and migration one write-free boundary.
apps_stopped=true
dc stop backend frontend
docker exec "$db" sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$backup_key" -out "$backup"
sha256sum "$backup" >"$backup.sha256"
sha256sum -c "$backup.sha256" >/dev/null
# Dedicated disconnected, tmpfs-only rehearsal; never restore into owner's PostgreSQL.
docker run -d --name "$restore_container" --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$pg_image" >/dev/null
for attempt in {1..60}; do
  if docker exec "$restore_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$backup_key" -in "$backup" \
  | docker exec -i "$restore_container" pg_restore --exit-on-error --no-owner --no-privileges -U postgres -d postgres
# Compare normalized logical SQL output, including actual rows and schema, not merely exit codes.
fingerprint() {
  docker exec "$1" sh -c 'pg_dump --no-owner --no-privileges -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"' \
    | sed '/^--/d; /^\\restrict /d; /^\\unrestrict /d; /^$/d' | sha256sum | cut -d' ' -f1
}
[[ $(fingerprint "$db") == $(fingerprint "$restore_container") ]] || { echo 'Isolated backup restore fingerprint mismatch'; exit 1; }
printf '%s\n' "$before" >"$state/migrations-before"
printf '%s\n%s\n' "$previous_backend" "$previous_frontend" >"$state/previous-images"
BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc run --rm --no-deps backend node backend/dist/migrate.js
ledger >"$state/migrations-after"
BACKEND_IMAGE="$backend" FRONTEND_IMAGE="$frontend" dc up -d --no-deps --wait --wait-timeout 120 backend frontend
smoke || { echo 'Candidate HTTPS readiness/privacy verification failed'; exit 1; }
# Persist image selection separately; do not rewrite owner's runtime secrets/configuration.
printf 'BACKEND_IMAGE=%s\nFRONTEND_IMAGE=%s\n' "$backend" "$frontend" >"$root/.env.images.next"
mv "$root/.env.images.next" "$root/.env.images"
printf 'commit=%s\nbackend=%s\nfrontend=%s\nbackup=%s\nhealth=passed\n' "$commit" "$backend" "$frontend" "$backup" >"$state/receipt"
cp "$candidate" "$root/docker-compose.yml.next"
mv "$root/docker-compose.yml.next" "$root/docker-compose.yml"
success=true
echo 'Release verified; private server receipt records images, schema and encrypted backup'
