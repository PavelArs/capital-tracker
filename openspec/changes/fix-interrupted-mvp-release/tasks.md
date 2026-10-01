## 1. Readiness gate

- [ ] 1.1 Add process characterization for socket-only readiness, bounded timeout refusal, and permanent TCP readiness; record RED before implementation.
- [ ] 1.2 Implement bounded `pg_isready -h 127.0.0.1 -U postgres` before decrypt/restore; use `-h 127.0.0.1` for isolated `pg_restore` and fingerprint `pg_dump`, preserving encrypted restore and fingerprint checks.
- [ ] 1.3 Add hosted disposable PostgreSQL 18 delayed-init acceptance proving socket-ready/TCP-unready then final readiness, TCP restore/fingerprint, and unchanged pinned source image identity before/after.

## 2. Resume provenance and safeguards

- [ ] 2.1 Define and validate explicit `resume-fresh` receipt fields linking the exact historical consumed receipt to a distinct successful candidate receipt; keep `fresh` and `existing` semantics unchanged.
- [ ] 2.2 Implement fail-closed host preflight for exact project/resource/image/mount/proxy identity, empty application schema, and the documented allowed residue set; make refusal preserve all resources.
- [ ] 2.3 Implement resume execution that pulls apps only, preserves running PG/Redis, and verifies fresh encrypted backup plus isolated restore/fingerprint before writes.
- [ ] 2.4 Add positive and negative dispatcher/runner tests, including missing/extra/drifted resources, unknown files, app data/activation, no infra pull/up/recreate, and failure preservation.

## 3. Immutable-image acceptance and release

- [ ] 3.1 Update critical acceptance to authenticate with scoped registry read access, pull and pin the original PG digest/revision, skip PG rebuild, use `--no-build`, and validate/scan/export the original image with new app artifacts.
- [ ] 3.2 Update CD/receipt validation to promote apps only and retain exact original PostgreSQL/Redis identities for `resume-fresh`.
- [ ] 3.3 Run required focused tests, hosted real-PG acceptance, full applicable release checks, and independent review; record failed/unrun checks and keep production status false until the owner executes the already approved privileged preparation and verified recovery actions.
- [ ] 3.4 Record the measured pipeline timing follow-up in the post-MVP backlog; defer cache or phase optimizations until per-phase and per-case timings exist, without weakening critical assertions.
