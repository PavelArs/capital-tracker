## Context

Release today: CI on main exports a tested candidate; `cd.yml` promotes it and writes
a receipt; the owner approves the receipt as root on the host; `cd.yml` then sends
`inventory`/`preflight`/`deploy` data requests over a forced-command SSH key to a
root-owned dispatcher, which runs the fixed release runner. Server files (runner,
Compose, pins, resume helper, inventory, normalizer) are installed only by root.

## Decisions

**One job, environment approval.** `release` runs provenance validation, promotion,
receipt writing, preflight and deploy in the existing single `deploy` job, which
already uses `environment: production`. GitHub holds the job (and its secrets) until a
required reviewer approves, so one click covers promotion and deployment. Splitting
promotion into an unprotected job would publish images without approval and add a
job boundary for the receipt; it buys nothing for a single owner.

**Trigger.** `workflow_run` on `CI` `completed`, filtered to main, plus a job condition
on `conclusion == 'success'`, `event == 'push'` and `head_branch == 'main'`. The run
id and commit come from the event; the existing provenance step still re-reads the
run, requires every gate and the critical acceptance receipt, and refuses when main
moved on. `workflow_run` executes the default-branch workflow with `GITHUB_SHA` set
to the main head, which is exactly what the provenance check compares.

**Request-carried receipt (version 2).** The approval now lives in GitHub, so the
receipt travels in the request instead of a root-installed file. All receipt checks
remain, including installed-file digests, so only root decides what runs as root.
Version 2 does not consume anything: replaying a request needs another environment
approval and redeploys the same pinned digests. Version 1 is unchanged so the
existing manual path and its tests stay valid.

**`resume-activation`.** The 2026-10-02 attempt (resume-fresh) failed after
migrations, owner provisioning and MFA confirmation, at application health. Its
state is: migrated database, owner row, `operator/recovery.json`, stopped
applications, no activation metadata. The new mode is the `existing` path with
three differences: activation metadata must be absent (instead of present), there
is no previous application pair (a failure stops the apps, as for fresh), and it
writes the managed-runtime marker on success. The owner and MFA CLIs never run, so
the existing enrollment and recovery codes stay valid. It is explicit, never
inferred from `existing`.

**Health check.** Compose frontend health uses `127.0.0.1` like the image
`HEALTHCHECK`. Adding an IPv6 listener to Nginx was rejected: `listen [::]:80`
fails to start where the container has no IPv6.

**`update`.** Re-running `install` needs the public key file and rewrites the key,
sudo rule and registry configuration. `update` reuses the same validated copy loop
for the dispatcher and server files only.

## Security, migration and rollback

Approval moves from root-on-host to the GitHub environment reviewer; the host-root
boundary (server files) is unchanged. No schema change. Every deploy keeps the
encrypted backup, isolated restore fingerprint, explicit migration and privacy smoke.
Rollback of this change: revert the commit and re-run `update`; version 1 receipts
work throughout.

## Risks

- Without a required reviewer on `production`, release runs without a click. The
  owner must keep that rule; the workflow cannot verify it.
- The IPv6 cause of the 2026-10-02 health failure is inferred, not observed on the
  host. If the frontend is unhealthy for another reason, `resume-activation` fails
  the same way and preserves the database.
