#!/usr/bin/env bash
# Creates the backend's runtime database role once (docs/manual-mvp-release.md, "Runtime
# database role"): a login role without administrative attributes, named in the private runtime
# file with a generated password. The next approved release checks it, grants it read and write
# access to the application tables (migrate.js) and starts the backend as it.
# Run as root from a clean checkout. No password is printed or passed as an argument.
set -Eeuo pipefail
umask 077
root=${RELEASE_ROOT:-/var/snap/docker/common/capital-tracker}
runtime=${RELEASE_RUNTIME_FILE:-$root/.env.release}
role=capital_app
db=capital_tracker_db
fail() { echo "Runtime database role not created: $1" >&2; exit 1; }
[[ $(id -u) == 0 ]] || fail 'run as root'
for tool in docker openssl flock; do
  command -v "$tool" >/dev/null || fail "required tool $tool is missing"
done
[[ -f $runtime && ! -L $runtime ]] || fail "missing private runtime file $runtime"
if grep -Eq '^DB_APP_(USERNAME|PASSWORD)=' "$runtime"; then
  fail 'the runtime file already names a runtime role'
fi
# The release lock: never change the runtime file while a release or backup uses it.
exec 9>"$root/.release.lock"
flock -n 9 || fail 'a release or backup holds the server lock; try again when it finishes'
[[ $(docker inspect "$db" --format '{{.State.Running}}' 2>/dev/null) == true ]] || fail "container $db is not running"
sql() { docker exec -i "$db" sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'; }
# Checked before a password exists, so a refused CREATE never logs one.
[[ $(sql <<<"SELECT count(*) FROM pg_roles WHERE rolname = '$role'") == 0 ]] \
  || fail "role $role already exists; see docs/manual-mvp-release.md to remove it first"
password=$(openssl rand -hex 32)
[[ $password =~ ^[a-f0-9]{64}$ ]] || fail 'could not generate a password'
# The new runtime file is complete before the role exists, and replaces the old one only after.
next="$runtime.next.$$"
trap 'rm -f "$next"' EXIT
cp -p "$runtime" "$next"
[[ -z $(tail -c 1 "$next") ]] || echo >>"$next"
printf 'DB_APP_USERNAME=%s\nDB_APP_PASSWORD=%s\n' "$role" "$password" >>"$next"
sql <<SQL >/dev/null || fail "PostgreSQL refused to create role $role; nothing was changed"
CREATE ROLE $role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '$password';
SQL
mv "$next" "$runtime"
trap - EXIT
echo "Created the runtime database role $role and named it in $runtime."
echo 'The next approved release grants it the application tables and starts the backend as it.'
