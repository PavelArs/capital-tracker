## Context

Deploy run `36914835760` on main `0f479b3955aba1cf351a29e897c7ffbdc9909638` created the PG18/Redis containers, volumes, and network, then failed at `pg_restore` with a missing PostgreSQL socket. The resources are durable and must be preserved. The exact earlier consumed receipt is historical provenance only: commit `0f479b3955aba1cf351a29e897c7ffbdc9909638`, CI run `36900868365`, used receipt SHA256 `56db9c19cfc8f5c5d08359e5f53f9c2122f369857123172f1e29168f4d61ebc3`. The failed deploy run is not that receipt's run ID.

The official PG entrypoint's socket-only temporary init server could explain the transient readiness window, but logs do not prove that race. Separately, code review found readiness timeout fall-through. Fix the observable contract without depending on PID 1 naming: require `pg_isready -h 127.0.0.1 -U postgres` within 60 bounded attempts, and explicitly refuse before decrypt/restore on timeout.

## Decisions

- Add explicit `resume-fresh` through CD input, receipt validation, dispatcher, and runner. Never infer it, fall back to `fresh`, or treat `existing` as equivalent.
- Make the readiness probe and isolated restore-side `pg_restore` and fingerprint `pg_dump` use explicit `-h 127.0.0.1`; this proves final TCP service end to end. The source production dump may retain its existing socket path.
- Resume requires both the exact consumed receipt above as interruption provenance and a distinct, newly approved successful-main receipt for the candidate. The latter authorizes this attempt; the old receipt does not.
- Prove the whole expected project/resource inventory, PG18 data mount, exact running image digests and health, runtime database user/name against container environment, and a clean bootstrap cluster (no unexpected databases, roles, schemas, application objects, extensions, or large objects). The old receipt proves immutable provenance but contains no Docker UUIDs: snapshot currently observed container, volume, and network identities before continuation and require them unchanged afterward. Allow only corroborated residues from the failed attempt: bootstrap secrets/config, empty operator directory, optional saved vhost, lock, old release state without migration/receipt markers, encrypted backup and checksum, and the probed trusted-proxy value. Refuse unknown or mismatched state without cleanup.
- Pin the original PG image `ghcr.io/pavelars/capital-tracker-postgres@sha256:c6a966be9561266a345c4c705a01a20fb82a061c3827e95b39e7127f7527f58f` and its reviewed origin revision, plus original Redis `redis@sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23`. Do not substitute a newly derived PG image. Resume acceptance authenticates with scoped `packages: read`, pulls the exact PG digest, skips PG rebuild, runs Compose with `--no-build`, and tests/scans/exports that image with newly built apps. CD promotes apps only and carries the original infra references into the new receipt.
- Host resume may pull candidate app images only. It must never pull, bring up, recreate, or replace PG/Redis/network. Verify the observed proxy peer against recorded trust; use an app-absent TLS preflight, not a deployed smoke claim.
- Before any migration/owner/MFA/app activation, make and verify a fresh encrypted backup and pass isolated restore plus logical fingerprint equality. On failure preserve PG/Redis and data, stop only app services if present, and require manual recovery.

## Verification design

First add focused process tests and observe RED before changing readiness/dispatch behavior. Cover transient socket-only readiness, never-ready timeout, and permanent TCP-ready success. These are process evidence only.

In hosted critical acceptance, after exact original PG image selection and before receipt/export, run a disposable `--network none` PG18 restore fixture with an init-hook handshake. Demonstrate socket readiness while loopback TCP refuses, release initialization, then require bounded loopback-TCP readiness, encrypted restore via `pg_restore -h 127.0.0.1`, and fingerprint via isolated `pg_dump -h 127.0.0.1`. Verify pinned source image identity is unchanged before and after acceptance. Use no production Compose or volumes and clean up only the disposable fixture.

Resume tests must prove refusal on absent/wrong historical receipt, missing/extra resources, project/network/mount/image drift, unhealthy infrastructure, non-empty schema or activation, and unknown runtime files. Assert zero infrastructure pull/up/recreate, migration, owner, or app activation on refusal. Success must preserve exact resource identities and prove backup/restore before writes. A later failure preserves initialized PG/Redis and stops apps only.

## Risks

Resume is a tightly scoped recovery path with a larger state-proof surface than a normal first install. Any ambiguity must fail closed and preserve all existing resources. The original private GHCR image must remain available to CI. Hosted real-PG verification is required; local process tests cannot establish readiness behavior. No production retry or readiness claim follows from this proposal.
