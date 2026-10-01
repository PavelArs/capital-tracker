# Independent record-asset-swaps review

Reviewed detached commit `175120a` in `/Users/pavelars/Projects/temp/capital-review-swaps`, 2026-09-26. Source and evidence review only: no tests, Docker, installs, source changes, preview access, or database operations were performed. Git status was clean. The owner's restored agent quota supersedes the stale pause in verification.md:314-315.

## Result

No confirmed product defect found in the reviewed exact accounting, owner-scoped transaction/replay, snapshot/loading, or frozen UI retry paths. Final follow-up on 2026-09-26 closes both CSV evidence findings after root review and successful real PostgreSQL execution, and accepts the corrected persistence wording. No unresolved blocking finding remains from this review. Root still owns final delivery-manifest reconciliation, integration and archive procedures. This is not production/release approval; image-specific frontend scope is preserved below.

## Original findings — both closed by final follow-up below

### P2 — Missing concurrent CSV preview/swap snapshot oracle

- Contract: `openspec/changes/record-asset-swaps/specs/usd-csv-imports/spec.md:231-234` (SWAP-CSV-SNAPSHOT).
- Evidence location: `tests/e2e/asset-swaps-db.cjs:576-594` performs preview, finishes a swap correction, then starts another preview. The real overlapping-reader harness at `tests/e2e/asset-swaps-db.cjs:796` includes only history, series and portfolio.
- This verifies stale preview invalidation, but cannot demonstrate that a CSV preview already in flight remains wholly on its established revision while connected swap heads change. Existing generic/predecessor CSV tests contain no nonempty swap history.
- Required oracle: use two real connections; establish and pause the actual CSV preview transaction after its journal/snapshot read, commit a connected swap correction on the writer, resume the reader. Require full old preview DTO/hash/pin/cost completeness, then exact new preview/hash/pin, and refusal of old confirmation. Compare private source bytes, immutable swap receipts and all relevant rows before/after read. Assert RR/read-only in PostgreSQL. Extend the existing fixture rather than adding a broad E2E suite.
- No inferred product failure: `csv-import.service.ts:690-693` does use RR/read-only and the candidate loader is shared. The gap is mandatory acceptance evidence, not evidence of a mixed snapshot.

### P2 — Missing invalid CSV candidate that strands an effective swap

- Contract: `openspec/changes/record-asset-swaps/specs/usd-csv-imports/spec.md:70-73` (SWAP-CSV-PREVIEW).
- Evidence location: `tests/e2e/asset-swaps-db.cjs:537-708` covers a valid recipient sale with unknown/known basis, stale confirmation, successful confirm/rollback, and rollback of source funding. It never previews a new earlier sale which consumes stock needed by an already effective later swap.
- Required oracle: fund a journal, create a valid later swap, then upload an earlier CSV sale which leaves that swap short. Real `preview` must return `canConfirm:false`, null candidate summary/hash and the intended bounded history error; there must be no trade/swap version, pin, request key or partial import mutation. Prefer a connected-account example if asserting `connected-history` specifically. Keep the source bytes exact. The code at `csv-import.service.ts:577-588` is the error branch needing this witness.
- No inferred product failure: full candidate replay appears implemented correctly. A successful sale and a rejected rollback do not exercise the invalid-preview envelope.

## Original nonblocking contract cleanup — wording accepted below

- `persistence.md:32` says an existing bounded lock error policy applies. `backend/src/accounting/accounting-lock.ts:4-12` waits on `pg_advisory_xact_lock` without a transaction-local timeout; `asset-swap.service.ts:101-102` adds none, and the runtime TypeORM options only set a connection timeout. Auth service transaction-local timeouts do not establish accounting timeouts. The race tests release their held lock promptly, so they do not prove a bound. This is inherited shared accounting behavior, not a new swap regression. Do not claim a verified bounded accounting-lock policy: clarify the contract and track shared hardening, or implement and verify it deliberately if it remains a slice requirement. A future oracle would hold the owner lock beyond the configured bound and require timely private failure, zero writes and reusable request identity.
- `persistence.md:24-27` describes saved/stored instrument labels, but `asset-swap.store.ts:23-29` joins the immutable instrument catalog on each read and the migration stores UUIDs only. With the current create/read-only catalog this preserves observable receipts. Describe the actual dependency on catalog immutability; introducing label edits later would require receipt preservation work.

## Reviewed no-findings scope

- Strict parser completeness/allowlisting, UUID/time/numeric canonicalization, null versus known zero, source/asset/quantity fee coupling, canonical replay including kind/target/pins.
- FIFO principal before held fee before acquisition; incoming fee uses the new original interval even with older same-asset lots; full incoming fees, one-atom allocation, independent evidence, source-only swap results and transfer/return provenance. Existing trade totals are not synthetic swap totals.
- Migration22 composite ownership/FKs, numeric/fee constraints and deferred head integrity; immutable append API, replay before live pins/caps, owner advisory lock before sorted connected account locks, old and candidate replay, participant capacity and atomic pin advancement. Direct SQL fixture uses exact SQLSTATE and positive controls; deferred-COMMIT fixture records a real post-write witness.
- Counts before swap materialization, full bounded pages, stale connected allocation pins, retained void summary, one connected load per chart/selected portfolio snapshot, unchanged original receipts after upstream restatement.
- Owner/account scoped recovery map, original command/key/body/pins on explicit retry, preservation across SPA remount, late review-generation guards, field/refresh invalidation, immutable receipt versus current allocation, and independent trade draft. Authorization/CSRF failures on an already ambiguous retry retain recovery. Full reload durability is explicitly excluded.

## Initial evidence and completion assessment (before follow-up)

Read the proposal/design/persistence/tasks/verification, active capability deltas, owner guide, engineering contract/continuity/target brief, implementation and relevant pure/HTTP/PG fixtures. Inspected existing log output directly (did not rerun): schema22 log reports 55 SQL refusals and populated21 preservation; bounds attempt2 reports six passing families; connected attempt1 reports six passing families; UI green attempt1 reports SWAP-API/UI and 7 total passing cases. Their claims match the inspected barriers/assertions for those scopes. Native bulk setup in bounds tests is explicitly fixture construction; boundary actions invoke actual services.

Tasks 3.1-3.3 have substantial matching evidence for their enumerated migration/race/bounds/read claims. They must not be read as evidence for every CSV scenario: the two findings above remain before closing 5.2. Task 5.1 can only close after root records disposition and fixes/evidence; 5.3 is root's later procedural archive task. No full suite, hosted CI, backup/restore, broad security matrix, production rollout, or owner visual approval is required by this scoped review or newly claimed here. The ongoing frontend redesign also means the dated swap UI image pass is not automatically a pass for every later frontend tree.


## Final follow-up disposition — 2026-09-26

Inspected root worktree `/Users/pavelars/Projects/temp/capital-tracker-review-followup` at `aad33a9`, the uncommitted persistence wording diff, and completed `/private/tmp/capital-reviews-swaps-pg.log`. Test file has no further diff from root's cherry-pick `aad33a9` of `7773bb77d72eadac22e3bc047ef4eb1c2fdde2e6`. This reviewer authored only the follow-up acceptance additions; root independently reviewed them before executing actual PostgreSQL acceptance. Root reports command exit0. The inspected log contains seven PASS lines and normal disposable PostgreSQL/network cleanup, with no failure line. It identifies backend image `sha256:dd90a8c5bc87122a0105d8e3012dea5e446dfc31db51dc6615b6e224f32369b2`; root reports the existing isolated PG image was used. I performed no new runtime/Docker operation.

- **Closed P2 SWAP-CSV-PREVIEW:** `tests/e2e/asset-swaps-db.cjs:709-756` now sends a valid earlier 2-unit sale into the connected source history. Runtime passes the exact `connected-history` error, `canConfirm:false`, null hash/summary, valid normalized row, unchanged current summary/basis120, unchanged draft/source bytes and full-table fingerprint. It exercises the missing invalid-candidate branch rather than relying on rollback refusal.
- **Closed P2 SWAP-CSV-SNAPSHOT:** the fourth reader in `coherentReadModels` now pauses an actual CSV preview after its journal query inside RR/read-only, commits a connected swap correction on the other PostgreSQL PID, then resumes. Runtime passes full old DTO equality, exact old/new journal pins4/5 and independently assembled documented hashes; cost30/result50 becomes cost40/result40, with exact full new DTO equality. It checks one swap count and one nonempty materialization, old-confirmation409, unchanged draft bytes/all rows after reads/refusal and original swap receipt replay. The previous six families remain, with a seventh PASS line for the negative preview subcase; this is not a claim of seven entirely separate test families.
- **Accepted lock wording correction:** `persistence.md:35-38` now explicitly says no dedicated accounting transaction-local lock-wait timeout exists and that controlled-release race tests prove serialization, not bounded waiting. Shared timeout hardening remains a separate release task; no product timeout policy changed. This resolves the misleading slice claim without presenting future hardening as verified.
- **Accepted label wording correction:** `persistence.md:24-30` now explains UUID storage and joins to the current create/read-only immutable instrument catalog, with explicit future receipt-preservation work if label editing is introduced. This matches the reviewed store/migration behavior.

### Remaining scope and readiness

Both required evidence gaps and both wording observations are resolved for this review. I agree that this review no longer blocks closing task5.1 or root's final task5.2 reconciliation once the accepted wording/evidence is retained in the repository. Root must still complete its supported archive/canonical-comparison/strict-validation/cleanup procedure under task5.3; this reviewer did not archive or independently certify that procedure.

The newest frontend two-field route-reset fix is outside this review's original source snapshot and has a separate independent reviewer. Root reports WORKSPACE+WORKFLOW2/2 passed in25.7s on FE64923db4, with earlier SWAP-UI/REWARD-UI/CSV3 passes on FE795d1b7a before that fix. I did not inspect those new browser logs here and do not convert them into a full swap browser matrix on FE64923db4. Retain exact image/scenario dates in final evidence and the separate frontend review. The earlier directly inspected SWAP-API/UI pass remains evidence for its original image, not every later frontend tree.

No full historical matrix, hosted CI, backup/restore, broad security scans, production rollout, owner visual approval, full-reload command recovery, future mutable catalog, or bounded accounting lock waits is newly verified or required to be claimed by this scoped follow-up. No source, dependency, deployment or Docker changes were made in this final inspection; only this permitted review report was updated.
