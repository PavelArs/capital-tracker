## Why

Production deploy run 36914835760 on frozen main failed when `pg_restore` could not connect to the PostgreSQL socket after the runner had created PostgreSQL 18 and Redis containers, volumes, and a network. Those initialized resources are now durable and must be preserved; a fresh setup retry is unsafe, while the ordinary existing-installation mode does not describe this interrupted first install.

## What Changes

- Require bounded readiness of the final PostgreSQL server over loopback TCP before decrypting or restoring the encrypted backup; timeout must fail before restore, migrations, owner creation, or application activation.
- Add a narrowly guarded `resume-fresh` release mode for this exact interrupted first-install state. It proves the exact historical receipt and immutable image digests, checks the currently observed fixed project resources and empty application state, then preserves those observed resource IDs throughout continuation. The old receipt does not record Docker IDs, so it cannot prove historical container UUIDs.
- Make the next candidate acceptance, scan, export, and receipt use the exact original derived PostgreSQL digest and revision, alongside new application images. Resume may pull application images only; it may not rebuild, pull, recreate, or replace PostgreSQL or Redis.
- Preserve created data and stop for manual recovery after any failure once the resume process begins.

## Capabilities

### New Capabilities

- `manual-mvp-release-recovery`: bounded final-PostgreSQL restore readiness and safe resume of a partially initialized fresh manual-MVP runtime.

### Modified Capabilities

None. The active `manual-mvp-release` change has no canonical capability in `openspec/specs`; this recovery contract is introduced separately and does not modify or complete that active change.

## Impact

Affected release runner and dispatcher/receipt mode validation, CD and critical-acceptance CI, and focused release readiness/process tests. No application API or database schema change is intended. The current restore failure is a genuine hosted RED; the temporary socket-only PostgreSQL init-server explanation is a strong inference, not proven by container logs. Process-level tests and required real PostgreSQL 18/CI evidence will be reported separately.

Data impact is preservation-critical: run 36914835760 created `capital-tracker_postgres_data`, `capital-tracker_redis_data`, the project network, and PostgreSQL/Redis containers before restore failed. The existing volumes and infrastructure images must not be reset or replaced. The encrypted off-host predeploy archive is confirmed, but restore has not passed and deployment is incomplete.

Dependencies: owner/root read-only reconciliation of the actual runtime; a new trusted successful-main receipt for the changed source; CI access to the original promoted PostgreSQL image via scoped `packages: read`; exact original PostgreSQL and Redis identities; and successful isolated encrypted restore/fingerprint verification before any database migration or owner/application activation. The old acceptance receipt is valid only for its original source and is not acceptance evidence for this change.

Non-goals: retrying deployment now, bootstrapping again, removing or recreating containers/volumes/networks, manual edits/resets/destructive data changes, weakening encrypted backup/restore or financial/security acceptance, changing the canonical `manual-mvp-release` requirements, or claiming production readiness/completion. The recovery flow may perform its explicitly gated migrations and owner creation only after the required verified backup and restore.
