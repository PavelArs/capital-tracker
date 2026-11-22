#!/usr/bin/env bash
# Creates the backend's runtime database role once (docs/manual-mvp-release.md, "Runtime
# database role"): a login role without administrative attributes, named in the private runtime
# file with a generated password. It gets data access to the current tables at once, so any
# backend start from now on works as it; each later release grants it new tables (migrate.js).
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
# The release runner's own mark of an activated installation.
[[ -f $root/docker-compose.yml ]] || fail 'no activated installation; finish the installation first'
if grep -Eq '^DB_APP_(USERNAME|PASSWORD)=' "$runtime"; then
  fail 'the runtime file already names a runtime role'
fi
# The release lock: never change the runtime file while a release or backup uses it.
exec 9>"$root/.release.lock"
flock -n 9 || fail 'a release or backup holds the server lock; try again when it finishes'
[[ $(docker inspect "$db" --format '{{.State.Running}}' 2>/dev/null) == true ]] || fail "container $db is not running"
sql() { docker exec -i "$db" sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'; }
# Checked before a password exists, so a refused CREATE never logs one.
state=$(sql <<<"SELECT (SELECT count(*) FROM pg_roles WHERE rolname = '$role') || '|' || has_schema_privilege('public', 'public', 'CREATE')") \
  || fail 'could not inspect the database roles'
[[ $state == 0\|* ]] || fail "role $role already exists; see docs/manual-mvp-release.md to remove it first"
[[ $state == '0|false' ]] || fail 'every role may create objects in schema public; see docs/manual-mvp-release.md'
password=$(openssl rand -hex 32)
[[ $password =~ ^[a-f0-9]{64}$ ]] || fail 'could not generate a password'
# The new runtime file is complete before the role exists, and replaces the old one only after.
next="$runtime.next.$$"
trap 'rm -f "$next"' EXIT
cp -p "$runtime" "$next"
[[ -z $(tail -c 1 "$next") ]] || echo >>"$next"
printf 'DB_APP_USERNAME=%s\nDB_APP_PASSWORD=%s\n' "$role" "$password" >>"$next"
# The role and its data access in one transaction: the same grants as migrate.js.
sql <<SQL >/dev/null || fail "PostgreSQL refused to create role $role; nothing was changed"
BEGIN;
CREATE ROLE $role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '$password';
REVOKE ALL ON SCHEMA public FROM "$role";
GRANT USAGE ON SCHEMA public TO "$role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "$role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "$role";
REVOKE ALL ON TABLE public.migrations FROM "$role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "$role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "$role";
COMMIT;
SQL
mv "$next" "$runtime"
trap - EXIT
echo "Created the runtime database role $role with data access, and named it in $runtime."
echo 'The next approved release starts the backend as it.'
