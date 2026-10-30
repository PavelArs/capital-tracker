#!/usr/bin/env bash
# Scheduled encrypted PostgreSQL backup between releases, with the same recipe and key as
# manual-mvp-release.sh, so its restore rehearsal decrypts these dumps. No secret is printed:
# OpenSSL reads the key from its file and no plaintext dump is written to disk.
set -euo pipefail
umask 077
root=${RELEASE_ROOT:-/opt/capital-tracker}
backup_key=${RELEASE_BACKUP_KEY_FILE:-$root/.backup-key}
retention_days=${BACKUP_RETENTION_DAYS:-30}
keep_min=${BACKUP_KEEP_MIN:-7}
metrics_dir=${BACKUP_METRICS_DIR:-/var/lib/node_exporter/textfile_collector}
db=capital_tracker_db
fail() { echo "Scheduled backup failed: $1" >&2; exit 1; }
[[ $retention_days =~ ^[0-9]+$ && $keep_min =~ ^[0-9]+$ ]] || fail 'BACKUP_RETENTION_DAYS and BACKUP_KEEP_MIN must be whole numbers'
for tool in docker flock openssl sha256sum find mktemp; do
  command -v "$tool" >/dev/null || fail "required tool $tool is missing"
done
[[ -d $root ]] || fail "release root $root does not exist"
[[ -f $backup_key && ! -L $backup_key && -r $backup_key ]] || fail 'private backup key unavailable'
[[ $(wc -c <"$backup_key") -ge 32 ]] || fail 'private backup key unavailable'
# Same rule as the release: mode 400 or 600 only (find -perm keeps it portable to BSD for the tests).
[[ -n $(find "$backup_key" -maxdepth 0 \( -perm 400 -o -perm 600 \)) ]] || fail 'private backup key unavailable'
[[ $backup_key != "$root/backups/"* ]] || fail 'the backup key must not live in the backup directory'
# Share the release lock: wait for a running release instead of dumping during its maintenance.
exec 9>"$root/.release.lock"
flock -w 3600 9 || fail 'a release held the server lock for an hour'
[[ $(docker inspect "$db" --format '{{.State.Running}}' 2>/dev/null) == true ]] || fail "container $db is not running"
mkdir -p "$root/backups"
backup="$root/backups/scheduled-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
[[ ! -e $backup && ! -L $backup ]] || fail "$backup already exists"
written=false
trap '[[ $written == true ]] || rm -f "$backup" "$backup.sha256"' EXIT
docker exec "$db" sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$backup_key" -out "$backup" \
  || fail 'pg_dump or encryption did not finish'
[[ -s $backup ]] || fail 'the encrypted dump is empty'
sha256sum "$backup" >"$backup.sha256"
sha256sum -c "$backup.sha256" >/dev/null || fail 'checksum verification failed'
written=true
size=$(wc -c <"$backup" | tr -d ' ')
echo "Scheduled backup written: $backup ($size bytes)"

# Retention touches only scheduled dumps; release dumps (<commit>-<utc>.dump.enc) are never pruned.
# The newest keep_min scheduled dumps stay regardless of age; older ones go after retention_days.
shopt -s nullglob
scheduled=("$root"/backups/scheduled-*.dump.enc)
for ((i = 0; i < ${#scheduled[@]} - keep_min; i++)); do
  old=${scheduled[i]}
  if [[ -n $(find "$old" -maxdepth 0 -type f -mmin +$((retention_days * 1440))) ]]; then
    rm -f "$old" "$old.sha256"
    echo "Pruned scheduled backup: $old"
  fi
done

# node_exporter textfile metric. It reads only *.prom, so the hidden temp file is renamed into place.
# umask 022 here: a non-root node_exporter must be able to enter a directory created by this script.
(umask 022 && mkdir -p "$metrics_dir")
metric_tmp=$(mktemp "$metrics_dir/.capital_tracker_backup.prom.XXXXXX")
cat >"$metric_tmp" <<METRICS
# HELP ct_backup_last_success_timestamp_seconds Unix time of the last verified scheduled backup.
# TYPE ct_backup_last_success_timestamp_seconds gauge
ct_backup_last_success_timestamp_seconds $(date +%s)
# HELP ct_backup_last_size_bytes Size in bytes of the last verified encrypted scheduled backup.
# TYPE ct_backup_last_size_bytes gauge
ct_backup_last_size_bytes $size
METRICS
chmod 644 "$metric_tmp"
mv -f "$metric_tmp" "$metrics_dir/capital_tracker_backup.prom"
