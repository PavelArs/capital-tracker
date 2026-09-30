## 1. Acceptance and scope

- [x] 1.1 Specify manual + CSV scope and startup/demand-read boundary; retain the deferred whole-target backlog.
- [x] 1.2 Observe genuine current-runtime and current-CD policy RED, preserving true/unset characterization (verification.md); policy tests do not prove actual deployment.
- [x] 1.3 Complete executable release-validator/orchestrator rejection tests for provenance/digest, missing DB, backup/encryption/restore failure, migration refusal and compatible two-image rollback; coordinate implementation interface.

## 2. Runtime and trusted candidate

- [x] 2.1 Gate automatic startup/scheduling under existing false flag, bound enabled fiat HTTP timeout, preserve explicit FX/legacy demand semantics; pass focused runtime tests.
- [x] 2.2 Resolve Router release advisories, retain routing/authentication and production audit evidence.
- [ ] 2.3 Neutralize upstream automatic CD safely before main integration; implement trusted immutable tested candidate promotion and pinned SSH identity with existing Actions/GHCR.

Task2.3 has approved workflow/script implementation and lower-level contracts; actual trusted candidate promotion remains required. It is not a deployed-server gate.

- [ ] 2.4 Require schema-v3 manifest and independent reviewed PostgreSQL build inputs/official Redis pin for both exact scanned images; reject mutable fresh Compose references and existing database/cache image drift before downtime. Prove actual four-image scanner/architecture/artifact identity in trusted Actions.

- [ ] 2.5 Replace the Docker-capable deployment SSH path with the MVP-007 restricted principal, forced root-owned dispatcher, owner-approved receipts and receipt-producing promotion; realign ENG-002 gates to the replaced workflow.

Task2.5 has implementation plus adversarial request/receipt/file/runtime-secret tests and updated ENG-002 gates. Operator installation on the real host, the new `DEPLOY_DISPATCH_SSH_KEY` secret/`DEPLOY_DISPATCH_USER` variable, registry read configuration and an actual Actions inventory through the dispatcher remain required; keep it open.

## 3. Server preparation and recovery

- [ ] 3.1 Implement and verify locked read-only preflight, mandatory encrypted backup/checksum and isolated restoration; reject preparation failures before server mutation.
- [ ] 3.2 Invoke existing explicit migration refusal, app-only update without down/prune/volume replacement, readiness/privacy checks and compatible two-image rollback; preserve owner data/config/key/preview.

Tasks3.1/3.2 have approved implementation and integrated synthetic failure/recovery tests. Owner-side assessment/preflight, verified server backup/restore and actual migration/application rollout remain separate required evidence; keep these tasks open.

## PostgreSQL18 fresh-target acceptance

- [x] 3.3 Pin fresh PostgreSQL18 and its versioned PGDATA/parent volume layout; preserve existing PostgreSQL16 defaults/data/preview and prove fail-closed major/layout mismatch before downtime or mutation. Source/process major-layout refusals and actual PGDATA fresh/reuse contract are recorded in verification.md.
- [x] 3.4 Run actual PostgreSQL18 current migrations and retained exact release journeys, encrypted backup/checksum/disconnected restore with logical schema/data equality. Record image/version and source-preservation evidence separately from historical PostgreSQL16 results. Exact four-image 19/19, migrations, encrypted disconnected restore and source-preservation evidence are in verification.md, “Current local runtime and hosted checkpoint”.

## 4. Verify and deploy

- [ ] 4.1 Independent source/oracle review; baseline lint/build/unit/types/spec/audit gates, actual isolated PostgreSQL migration/backup/restore/artifact probes and existing19critical real journeys in verification.md. Record any explicit fixture setup and retain exact oracles.

Tasks3.3/3.4 local acceptance is complete, but task4.1 remains open: the hosted CI acceptance rerun is pending, and explicit types evidence is not yet linked here.
- [ ] 4.2 Run trusted candidate Actions gates and privately discover actual server prerequisites; perform actual Actions deployment only after backup/restore/preflight success. Record candidate/deployed commit, digests, schema and health/privacy/MFA/manual-read/logout evidence.
- [ ] 4.3 Update operator/MVP/deferred-backlog documentation, review limitations, archive after actual required completion and guard integration. Do not claim whole-target completion or consolidate original projects.

## 5. Bounded Snap host compatibility (MVP-008)

- [x] 5.1 Specify fixed managed runtime, preserve legacy files/defaults, and observe process/security RED for fresh configuration and unsafe setup paths.
- [x] 5.2 Implement trusted fresh bootstrap, fixed dispatcher runtime/native PATH and exact dedicated plugin configuration; pass scoped process/security checks and independent review.
- [x] 5.3 Record actual public Snap-common bind and isolated native Compose lookup evidence separately from bootstrap/deploy/recovery; retain the actual deployment tasks above until their own evidence exists. Owner public bind probe and server native Compose lookup passed; see `verification.md`, “Snap host compatibility final evidence”. Bootstrap/deploy/recovery tasks remain open.
