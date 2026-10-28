# Scheduled encrypted backups

Releases already dump the database before they migrate (`scripts/manual-mvp-release.sh`). This
directory adds a daily dump between releases. `scripts/scheduled-backup.sh` uses the release's
exact recipe: `pg_dump -Fc` in the `capital_tracker_db` container, piped straight into OpenSSL
AES-256-CBC with PBKDF2 and 200000 iterations, keyed by the same `/opt/capital-tracker/.backup-key`.
No plaintext dump reaches the disk. Each run writes
`/opt/capital-tracker/backups/scheduled-<UTC time>.dump.enc` with a `.sha256` file next to it,
checks the checksum, prunes old scheduled dumps and updates a Prometheus textfile metric. It takes
the release lock (`.release.lock`) and waits up to an hour for a running release. On any failure
it exits non-zero with a message in the journal and leaves no partial dump behind.

The release takes the same lock without waiting. A release that starts while the daily backup
runs (the timer fires at 03:30 server time plus up to 30 minutes, and the dump takes as long as it
takes) fails at once with `Another release holds the server lock`. Nothing has changed on the
server at that point: wait for `systemctl status capital-tracker-backup.service` to show the run
finished, then re-run the release.

## Install (one time, as root, on the production host)

Install the timer only after the first activation has finished. The release's resume helper
(`scripts/manual-mvp-resume.py`) expects `backups/` to hold only the interrupted release's own
dumps, so a scheduled dump written during an interrupted first installation makes a resume refuse
with `interrupted encrypted backup set differs`.

From a checkout of the commit you want to install:

```sh
install -m 0700 -o root -g root scripts/scheduled-backup.sh /usr/local/sbin/capital-tracker-scheduled-backup
install -m 0644 -o root -g root deploy/backup/capital-tracker-backup.service deploy/backup/capital-tracker-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now capital-tracker-backup.timer
systemctl start capital-tracker-backup.service   # first run now; check it
journalctl -u capital-tracker-backup.service -n 20
systemctl list-timers capital-tracker-backup.timer
```

Releases do not update these files. Repeat the two `install` lines and `daemon-reload` when a
later commit changes the script or the units. Change paths or retention with
`systemctl edit capital-tracker-backup.service` (the `Environment=` lines), not in the repository
copy.

## Retention

Scheduled dumps older than `BACKUP_RETENTION_DAYS` (default 30) are deleted, but the newest
`BACKUP_KEEP_MIN` (default 7) scheduled dumps always stay, however old they are. Release dumps
(`<commit>-<UTC time>.dump.enc`) are never pruned. Copy dumps you want to keep longer, and the
backup key, to off-host encrypted storage yourself; the dumps are useless without the key.

## Backup-age alert

The script writes `capital_tracker_backup.prom` into `BACKUP_METRICS_DIR` (default
`/var/lib/node_exporter/textfile_collector`) with a temporary file and a rename, so node_exporter
never reads half a file:

- `ct_backup_last_success_timestamp_seconds`: Unix time of the last verified backup.
- `ct_backup_last_size_bytes`: size of that encrypted dump.

The script creates a missing directory with mode 0755 so a non-root node_exporter can read it; if
you create it yourself, give node_exporter read access. Start node_exporter with `--collector.textfile.directory=/var/lib/node_exporter/textfile_collector`
(a containerized node_exporter needs that directory mounted read-only), and let your Prometheus
scrape it (the commented `node` job in `deploy/observability/prometheus-scrape.yml`). The alert rules `CapitalTrackerBackupStale` and `CapitalTrackerBackupMissing` in
`deploy/observability/capital-tracker.rules.yml` then fire when the last backup is older than 36
hours or the metric is absent. This needs no change to the release-managed `docker-compose.yml`.
Without node_exporter, `cat` the file or check `systemctl list-timers` and the journal instead.

## Restore

Restore exactly as for a release dump; see "manual restore" in `docs/manual-mvp-release.md`.
Verify the checksum (`sha256sum -c <dump>.sha256`), then decrypt into a NEW, isolated
PostgreSQL of the same major version, as the release's restore rehearsal does:

```sh
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/opt/capital-tracker/.backup-key -in <dump> \
  | docker exec -i <isolated container> pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges -U postgres -d postgres
```

Never pipe a restore into the active owner database.
