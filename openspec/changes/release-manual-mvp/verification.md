# Manual MVP acceptance manifest and evidence

## Latest hosted checkpoint — run 36857990125 (integration source `a661fc46453b2244ca78d26f3411b97b922d8790`)

Seven basic CI jobs passed. Production dependency audit failed with 7 HIGH and 6
MODERATE findings; backend Axios `1.18` is below the required `1.20` floor. The
owner requested cancellation and Actions reached terminal `cancelled`: release E2E
was cancelled, image scans and candidate export were skipped. No promotion or
deployment occurred. Actual audit log: `/private/tmp/capital-mvp-ci5-audit-job.log`.
Axios remediation and the CI cost gate are underway; no pass is claimed for either
until Root records final results. This checkpoint does not close any release gate.

Owner decision (2026-10-01): pause hosted E2E temporarily until test cleanup is
complete. Keep the manual test command and test files, while non-E2E checks, image
builds/scans, audit and engineering security checks continue. The E2E plus real-DB
bundle is currently unrun. A paused run cannot produce a tested-candidate export or
promotion. Restore E2E after PM-TEST coverage cleanup. The workflow change and its
actual check results remain pending implementation evidence.
Local Docker-dependent image/PG/HTTPS runtime checks are unrun because Docker is
unavailable; earlier runtime evidence remains historical.

Frozen workflow source is `f46d72ecefddd20bf47b68259c657cc4e628d529` in
`capital-tracker-ci-audit-gate`. `CI_E2E_ENABLED` defaults false; the release job
builds images and runs all four scans without invoking acceptance. CD requires the
exact run's real-acceptance step to have succeeded before candidate export/upload;
non-inventory preflight/deploy also require that result. Paused mode can inventory,
but cannot promote, preflight or deploy. Scan labels reflect the paused gates.
Policy acceptance passed 195/195 across two affected suites in 7.932 seconds. The
original pause-gate RED was 2 failures; the expanded pause/provenance RED was 7
semantic failures. Style, diff and strict OpenSpec validation passed (46/46). These
are local source checks only. Independent review is pending; hosted CI, actual image
builds/scans and real DB/HTTPS acceptance have not run, and nothing has been pushed.
After PM-TEST coverage cleanup, restore `CI_E2E_ENABLED=true` in a reviewed source
commit and rerun the full release acceptance before candidate export/promotion.

Axios runtime preparation is preserved in the separate ignored directory
`/Users/pavelars/Projects/temp/capital-tracker-ci4-runtime/tests/e2e/.runtime/axios-preparation/`:
the public runtime script, plan, catalog script and catalog text. Script SHA256 is
`5c4e77833ededb9a193e81075726c55655303b87b640ecf626e216ba6f78ddb9`. Independent
plan review passed; script syntax and catalog checks passed 4/4. No Docker build or
runtime check ran. These scripts use a plan under `/private/tmp`; if that file is
missing before a later authorized run, restore it from the preserved public plan.
Keep the ignored preparation directory. Its runtime target is still old source
`efb7e60`; integrate the upgraded, reviewed Axios source before any GO decision.

The earlier run 36706275247 remains historical evidence below. Its recorded results
and local follow-up receipts are retained as written. Some older temporary receipts
and scripts are absent on this host, so that historical evidence is unavailable
locally; this does not invalidate or replace the prior recorded results.

Preparation at a03371b only; no product changes, Docker, provider/server access, publish/push or deployment by acceptance author. Actual OpenSpec1.2 new/status/instructions(proposal/design/specs/tasks) generated this change. The18 retained real journeys below are selected gates, not newly authored cases or a full-suite claim.

## Genuine predecessor RED

`pnpm --dir backend exec jest engineering/manual-mvp --runInBand` against existing source:
first run8tests:6FAIL/2PASS. Runtime false still invokes crypto constructor collection and fiat module-init collection; true/unset startup characterization passes. Existing runnable CD fails skippable-backup, SSH TOFU, destructive down/prune and missing explicit migration policy assertions. Log `/private/tmp/capital-manual-mvp-predecessor-red.log`.

Final rerun with the bounded fiat HTTP timeout assertion exited1:7FAIL/2PASS (9tests). The additional failure observes the real enabled fiat request omitting its timeout option. Log `/private/tmp/capital-manual-mvp-predecessor-final-red.log`. Mocks are confined to lower-level service/external process contracts. No backend/auth E2E response is fabricated. Policy regex gates establish predecessor defects only: successful regex assertions cannot establish safe provenance, backup/restore, rollback or deployment. Executable negative validator/orchestration acceptance and real isolated/server proof remain required.

## Retained real browser manifest (18)

Each is one existing named test; file line anchors describe the preparation commit and may shift. Invoke concrete files/tests with exact names; do not widen grep unintentionally.

| Existing journey | Source |
| --- | --- |
| MFA-002-A password grants pending only | tests/e2e/mfa.spec.ts:121 |
| MFA-002-B actual TOTP full-session rotation | tests/e2e/mfa.spec.ts:155 |
| SES-001-B copied-cookie logout revocation | tests/e2e/sessions.spec.ts:172 |
| SES-002-A CSRF/foreign Origin denial | tests/e2e/sessions.spec.ts:251 |
| OPEN-001-A/OPEN-002-A exact opening unknown/zero/restart | tests/e2e/manual-opening.spec.ts:66 |
| TRADE-003-A/TRADE-006-A FIFO250/100/0.5 correction/history | tests/e2e/usd-trades.spec.ts:139 |
| SWAP-UI exact review/committed retry | tests/e2e/asset-swaps.spec.ts:243 |
| REWARD-UI unknown/zero/category/retry | tests/e2e/asset-rewards.spec.ts:328 |
| TRANSFER-UI create retry/correction/void | tests/e2e/owned-transfers.spec.ts:285 |
| CSV-006-A full sale-first import/restart/rollback | tests/e2e/csv-import-journey.spec.ts:407 |
| FLOW-004-A initialize/contribution/correction/history | tests/e2e/external-usd-flows.spec.ts:293 |
| PRICE-UI/PRICE-RECOVERY exact prices/committed retry/late read | tests/e2e/manual-usd-prices.spec.ts:242 |
| VAL-UI exact valuation/late result/draft | tests/e2e/historical-valuation.spec.ts:267 |
| VCH-UI zero history/late response/draft | tests/e2e/valuation-history.spec.ts:219 |
| MPV-UI selected portfolio/gaps/stale read | tests/e2e/manual-portfolio-valuation.spec.ts:380 |
| PROFIT-UI/PROFIT-LATE reviewed inputs/late/error | tests/e2e/period-profit.spec.ts:200 |
| XIRR-UI/XIRR-LATE available/unavailable | tests/e2e/xirr-preview.spec.ts:172 |
| TWR-UI boundary coverage/late invalidation | tests/e2e/twr-preview.spec.ts:203 |

Reuse archived financial/security source evidence and independently reviewed responsive frames when untouched; final candidate needs actual selected HTTPS/MFA/backend/PostgreSQL execution with external fixtures only. Keep existing whole-suite/CI gates intact. Manual-mode changes must not fabricate cache prices or weaken precision/provider/admission/fingerprint assertions. Supported manual/CSV views stay provider-independent; explicit FX/legacy demand reads retain their own semantics and need separate retained coverage when affected.

## Router compatibility supplement

The Router major update also requires existing `SHELL-UI` in tests/e2e/application-shell.spec.ts:14 as the19th selected journey. Its original real password/TOTP, navigation, private entry and logout assertions remain; bounded read-only additions exercise `/assets/*`, all three fixed tab URLs and anonymous unknown-route redirect. This supplement is compatibility characterization, not a manufactured financial RED.

## Staged release gates

1. Scoped RED/GREEN unit/process contracts, independent source review, baseline lint/build/unit/types/specs/audit and no unresolved documented production dependency finding.
2. Actual isolated release-image/artifact/network/migration probes, encrypted backup/checksum/restore rehearsal and19retained journeys; record exact candidate image digests and unrun scope.
3. Trusted Actions promotion/provenance; pinned-host read-only actual server preflight (origin, volumes/schema, secrets/MFA readiness). No owner-data mutation before verified backup/migration preflight.
4. Locked actual Actions release with explicit migrations/refusal, app-only update and compatible rollback; HTTPS minimal health/private denial, real MFA/manual-read/logout. Record actual deployed identities/results privately without leaking credentials.

No runtime deployment/restore success, hosted CI success, production readiness or whole-target completion is claimed by this preparation.

## Lower-level release contracts

QA acceptance against actual release candidate bfb8f42 uses only synthetic external-command executables in test-owned temporary directories. Exact candidate validator20tests and server orchestration12tests PASS32/32 in31.056s; `/private/tmp/capital-manual-mvp-process-expanded.log`. Covers refusal stage witnesses, dump/encryption/restore/fingerprint failure before migration, partial-stop recovery, exact previous pair with readiness, failed rollback startup fail-closed, changed schema stopping without owner DB restoration, and successful ordering/persistence. This is process-contract evidence, not real Docker/PostgreSQL restore, trusted Actions promotion or server deployment proof. Candidate-path overrides permit bounded read-only cross-worktree evaluation; final integrated tests default to their checkout's scripts.

Focused engineering/manual-mvp against integrated4cc54a8 exited0:38/38tests across4suites in25.705s, `/private/tmp/capital-manual-mvp-integrated-focused.log`. Confirms runtime false/default/timeout and existing policy/validator/process gates at that commit; later fresh/configuration changes still require their own focused checks. Runtime task2.1 complete; Router actual navigation, final release-image journeys, real backup/restore and deployed server gates remain pending.

First real scoped harness attempt stopped at stale client-source-startup expectation16 while current22migration probes passed (`/private/tmp/capital-mvp-scoped-attempt1.log`, runtime-agent execution). QA5e58c6d corrects exact count22 and checks latest AddAssetSwaps1790300000000, retaining all startup/refusal/security/fingerprint assertions. No probe skipped and no image rebuild inferred. Subsequent real execution remains required.

Existing-mode orchestration rerun against the deployment worktree's c8b2957 plus pending fresh-mode preparation passes13/13 in32.138s (`/private/tmp/capital-manual-mvp-process-configuration.log`). Added unsafe historical-ledger refusal and verifies original Compose bytes used for paired rollback. Fresh-mode behavior is not covered by this result; it still needs separate collision/initialization acceptance. External commands remain synthetic stubs only.

The second/third real scoped attempts stopped before browser execution on the numeric invalid-proxy fixture privacy assertion (`/private/tmp/capital-mvp-scoped-attempt2.log`, `/private/tmp/capital-mvp-scoped-attempt3.log`). Bounded diagnostic identifies the short literal match as a stack frame, not proof of a settings echo. QA replaces numeric123 with distinct safe-integer canary812734650918273, retaining numeric-type rejection, full unfiltered output no-echo and all secret scans; temporary diagnostics removed. No backend change or security-probe skip. The corrected runtime result remains pending.

Real attempt4 passes all27 HTTP startup refusals after the canary correction, then exposes another stale CLI marked-migration count17 against actual22 (`/private/tmp/capital-mvp-scoped-attempt4.log`). QA now requires exactly22 displayed names and exact equality with the preserved database ledger; absent HTTP configuration, CLI success and all-state fingerprint remain unchanged. Browser execution remains pending.

Bounded E2E fixture audit finds only two automatic-startup provider expectation definitions: manual-opening inline and shared restartWithExactProviderWarmup. Isolated Compose explicitly sets BACKGROUND_JOBS_ENABLED=false; root authorizes their exact two-call expectation to exact unchanged provider log based on the earlier genuine false-flag runtime RED and agreed manual profile. Replica restart/readiness, precise provider identities/counters and all financial/fingerprint assertions remain intact. No fabricated warmup and no browser RED claim; scoped Biome and strict all-E2E TypeScript pass.

Explicit fresh-install process acceptance adds7 checks: existing named app container, named app volume, project-labeled volume, failure of each of the3 inventory commands, and positive empty-inventory preflight requiring configuration/TLS without provisioning. Actual cross-tree orchestration20/20PASS36.52s against deployment draft following captured labeled-volume assignment fix; only synthetic command stubs, not real absence inventory, fresh initialization, backup/restore or server proof. Default existing missing-DB refusal remains covered.

Metadata publication process regression passes1/1 focused (5.753s) against the current deployment draft: synthetic failure of candidate Compose rename after candidate image selection publication requires exact old image-selection/configuration/managed-marker restoration, both prior images with verified readiness/privacy, no final receipt and no false release success. This is a lower-level process fault injection, not filesystem or deployed recovery proof.

Whole orchestration regression passes21/21 in43.609s against deployment draft script SHA2560b5a2840fa942c1757e7db81eb055deafcc9581e7d2c767fff0afb84ac406c4f. Final receipt absence assertion discovers the actual unique attempt directory and requires no receipt there, correcting the formerly stale fixed path. Scoped Biome, diff check and strict OpenSpec validation pass. Process stubs only; actual restore/deployment gates remain pending.

Image-report gate characterization passes14/14 in1.689s against actual scripts/check-release-image-security.cjs from627a99e: exact tested-image identity/schema/OS evidence, LOW/MODERATE retention, HIGH/CRITICAL vulnerability and secret rejection including non-OS findings, excerpt/configuration redaction while preserving actionable findings and blocking status. Synthetic report tests only; no real Trivy image-scan success or package-database freshness is claimed. Scoped Biome and diff check pass.

Scanner followup uses real Trivy MEDIUM severity and adds malformed-report CLI privacy checks for normal gate and redactor mode;16/16 pass. Exact PostgreSQL16.10 snapshot normalizer8/8 passes: three reviewed equivalence pairs only, changed bounds/states/unsupported DDL remain distinct, COPY rows (including comment/restrict/mapped-DDL-looking rows) and dollar bodies preserved. Combined24/24 passes2.088s against current deployment draft. These are synthetic report/text contracts, not actual scanner/backup-restore proof.

## Actual Router/manual candidate execution

Runtime-agent real attempt5 (`/private/tmp/capital-mvp-scoped-attempt5.log`) exits nonzero with18/19 journeys passing4.9m: backend SHA256049c5e91b667e737aeee06823d28931e290a29671e1693f84998228f528f4400, frontend SHA256bd407fdd78986c185583421a50bb7f871d329eec22e2e3907ba0d6d7eb4e6495. Router SHELL-UI passes11.6s with real login/MFA, assets/tab/unknown-route/private/logout navigation. Retained manual/accounting/CSV exact financial, restart provider independence, privacy and fingerprint checks pass; only VCH responsive page-width check fails. Startup27 real refusal evidence reused only on the identical backend; exact migration CLI ledger correction passes.

A scoped VCH rerun (`/private/tmp/capital-mvp-vch-green.log`) passes1/1 in15.9s with unchanged backend and rebuilt frontend SHA25628faa7ab8a7d695c1f4859d95669a340d7e7f2a6da8889f55d0471ddaa76f86d after the reviewed layout correction. This is18 journeys on the previous frontend plus1 focused journey on the rebuilt frontend, not a full19-case pass on the rebuilt image. Router7.18.4 production dependency audit0 findings,121 frontend unit tests and matching build/type evidence resolve task2.2; candidate Actions gates, actual image scanner, encrypted backup/restore and deployed-server verification remain pending.

Read-only owner assessment eef9922 source is independently approved and22/22 synthetic process fixtures pass14.274s: strict dotenv classification and fail-closed resource/tool discovery with no private values. Local unit stubs do not establish the real server's absent-data prerequisites. The owner must run only checksum-verified assessment from an exclusively created private home staging directory before any bootstrap.

## Integrated engineering acceptance

Actual integrated fc7fad5, matching isolated dependencies, no cross-worktree overrides: `pnpm exec jest engineering/manual-mvp --runInBand` exits0 with96/96 tests across7suites in53.471s (`/private/tmp/capital-manual-mvp-fc7fad5-engineering.log`). Includes current runtime, policy, manifest, orchestration, owner-assessment, image-report and exact snapshot-normalizer contracts against scripts in the same checkout. Scoped Biome7files, strict all-E2E TypeScript, strict OpenSpec validation, shell/Node syntax and clean diff pass. No Docker or unchanged broad suite rerun.

Task1.3 complete for executable lower-level rejection contracts: provenance/digest, missing existing DB, dump/encryption/isolated-restore/fingerprint failure, migration refusal, exact compatible two-image recovery, failed recovery and metadata publication safety. Synthetic commands/report/text fixtures are not proof of real restore, actual image scanning or server deployment. Tasks2.3/3.1/3.2 retain approved implementation evidence but remain open for their required trusted Actions and owner-server preparation/rollout gates;96 unit/process passes do not close them.

## PostgreSQL18 fresh-only scope change

The owner now requires PostgreSQL18 for the new fresh installation. Official image documentation confirms PGDATA=/var/lib/postgresql/18/docker and parent volume=/var/lib/postgresql; existing <=17 layout stays /var/lib/postgresql/data ([official source](https://hub.docker.com/_/postgres)). Existing PostgreSQL16 volumes/preview are preserved; supported same-major existing app promotion is distinct from a major upgrade.

Genuine new refusal RED against integratedfc7fad5:4/4 added process cases fail because preflight exits0 for existing major/layout mismatch and fresh old major/layout; `/private/tmp/capital-manual-mvp-pg18-refusal-red.log`, exit1,8.72s. Synthetic external commands only, no Docker/server mutation. Compatibility-only image/path updates require retained passing characterization, not invented defects; actual18 migration/schema/financial and encrypted backup/restore evidence remains required.

Prior real isolated PostgreSQL16.10 rehearsal is historical: `/private/tmp/capital-mvp-backup-rehearsal3.log` reports current22 schema, exact decimal/JSON/bytea encrypted restoration in disconnected tmpfs, equal logical fingerprint/source unchanged, and actual dump-refusal pipefail. Runtime/release agents executed it against synthetic data and cleaned owned resources. It does not close new PostgreSQL18 acceptance.

PG18 major/layout guard draft makes the earlier4 process refusal cases pass, but a concurrent whole25-case run yielded24 pass/1 unsafe-schema stage witness failure; its focused rerun passed without changing the oracle. No whole-GREEN claim until a committed immutable candidate rerun. Four additional process RED cases for mutable fresh PostgreSQL/Redis references and existing PostgreSQL/Redis candidate image drift fail4/4 on the guard draft (`/private/tmp/capital-manual-mvp-infrastructure-drift-red.log`,8.899s). Schema-v2 manifest with exact infrastructure IDs/digests and separately supplied trusted pin fixture yields2 genuine behavioral failures/22 passes against the old v1 validator (`/private/tmp/capital-manual-mvp-infra-pins-red.log`,1.86s). The first compile-only trial was corrected before the behavioral run. No v2 validator, four-image scan or infra-drift GREEN is claimed.

Follow-up acceptance commits9017a37/bb43b1f require direct command witnesses for image checks and a separate CLI pin mismatch. A focused positive fresh-preflight run against frozen integrated sourcee8efe30 exited1 with1failure/28skips in5.946s: preflight succeeded but never queried the PostgreSQL/Redis Compose image references. The changed oracle has its own observed RED; the earlier RED logs remain evidence for their original assertions. Scoped Biome and diff check pass; source GREEN awaits an immutable v2 implementation candidate.

## MVP-007 restricted release dispatcher (2026-09-30, branch fix/manual-mvp-boundary)

Genuine RED: the initial adversarial request/receipt/trusted-file contract (8 cases) ran against a stub dispatcher and failed with 24 subtest failures and 2 errors (Python3.10.12, Linux VM on the owner Mac). Implementation then made 8/8 pass. Added end-to-end dispatch, receipt-generation, entry-point, single-use receipt, runtime-tree, delegated application uid, registry plugin and Codex-authored runtime-secret cases. Final `python3 -B -m unittest discover -s tests/security -p '*_test.py'`: 32 tests OK, 1 skipped (root-only uid1000 case, which passed separately as root on Python3.13 in the cloud workspace; the reviewer reports 30/30 at an intermediate state on Python3.8.20/3.13 as root and as `nobody`).

ENG-002 was already RED at 976f917 before this work: 3 gates.spec cases asserted the retired legacy version/build/deploy/rollback/notify job graph that the replacement cd.yml no longer has. The modified ENG-002 delta and rewritten cases now pass: `jest src/engineering/gates.spec.ts gates-preservation.spec.ts manual-mvp-release.spec.ts` 187/187 (ts-jest type check included). `manual-mvp-orchestration.spec.ts` is unchanged by this work and fails nondeterministically in the Linux VM (1–4 different cases per run, including 1 at unmodified 976f917); it needs a rerun on macOS/CI. Strict OpenSpec validation: 45/45. Installer: `bash -n` only.

Independent security review (two rounds) found: root code execution through `approve` via `python3 -` importing from the working directory (fixed with `/usr/bin/python3 -I`), replayable receipts (now consumed before deploy), unchecked runtime tree/registry plugins, double-read approval, installer reuse/symlink gaps and an unpinned registry namespace; all fixed with tests. It also caught that the whole-tree check would have refused bootstrap's uid1000 `.mfa-key`/`operator/`, now an explicit narrow delegation.

Not verified: Biome lint (only a darwin binary is installed and the registry refused the Linux package), real host install/sshd/sudo behaviour, an actual Actions inventory/promote/deploy through the dispatcher, and GHCR pulls through `/etc/capital-tracker/docker-config`.

## MVP-002-C derived PostgreSQL candidate identity (2026-09-30)

Bounded source work from `c9dc2b9`, paired with runtime `f0f14b4` Dockerfile and
`7274076` acceptance revision label. Source pin binds Dockerfile SHA256
`76b06e0a59cb0ca7a47497ebbd8c0b6de803752bf99850ef5c7dda409832b5b4` and official
base `postgres@sha256:d8703cd7fba306b9fec9268ecedfa8a966846c053036a60e3635791957eb2f66`.
Neither is the final derived image identity. Schema3 records the tested derived
image ID; export/promotion verifies all four local IDs and linux/amd64 plus the
PostgreSQL build revision. CD publishes the unchanged derived image to the exact
Capital PostgreSQL GHCR repository, and passes its actual registry digest to the
receipt. Official-base/foreign-repository final PostgreSQL receipts now refuse.

ATDD: changed MVP-002-C/source contract first; predecessor validator rejected the
valid schema3 derived candidate (1 failed/25 passed). Separately observed the
actual `c9dc2b9` dispatcher accepting the vulnerable official base digest as a
final fresh receipt identity, violating MVP-002-C. That official final-identity
negative case now refuses. Focused GREEN: validator+scanner Jest 43/43; Python
manual-MVP dispatcher/receipt process contracts 36 passed/1 existing root-boundary
skip; Biome focused validator file passed; strict active OpenSpec validation passed;
workflow YAML parsed and 35 shell/4 embedded JavaScript bodies syntax checked;
release/bootstrap shell syntax and diff whitespace passed.

Bootstrap now reads strict root-reviewed fresh metadata from a root-owned,
non-writable, ancestor/symlink-checked receipt before runtime creation; commit,
image arguments and reviewed source hashes must match. Final installer approval
follows bootstrap/runtime ownership setup, avoiding an approval/setup dependency
cycle. Root-protected private GHCR read access remains an actual operator
prerequisite. Existing PostgreSQL16 same-major/data-layout refusal remains intact.

These source/process tests do not prove actual Docker builds, scans, retained real
PostgreSQL18 journeys/restore, hosted CI, GHCR promotion, server bootstrap or
production deployment. Those gates remain open and require the runtime/root
agents' exact-image evidence. No server, Docker or remote Git mutation here.

CI now explicitly runs the one root-only application-UID delegation acceptance in
its disposable temporary tree using hosted Ubuntu sudo. It remains unrun locally
without privilege escalation; a configured hosted step is not observed CI proof.
Operational completion also requires owner-coordinated retirement of the obsolete
repository-level Docker-capable deployment credential after restricted-key cutover,
without revoking shared host access for other services.

Independent source review caught bootstrap's inherited Python cwd/PYTHONPATH import
exposure. A bounded fake-id/non-root process test with malicious pathlib/json/subprocess
modules actually executed its sentinel before receipt refusal (RED1/1). Both privileged
bootstrap inline interpreters now use fixed `/usr/bin/python3 -I -`; the same sentinel
process acceptance passes, while missing metadata still refuses before server mutation.
Focused GREEN after this fix: bootstrap1/1; manual-MVP security37 passed/1 root-only
skip; shell syntax passed. These are process fixtures, not a privileged server run.


## Current local runtime and hosted checkpoint (2026-09-30)

Latest evidence is explicitly local runtime, not deployment: source commit
`7274076cd4456708b98b630e92aaeca11bc9226a`, Dockerfile SHA256
`76b06e0a59cb0ca7a47497ebbd8c0b6de803752bf99850ef5c7dda409832b5b4`,
official base `postgres:18.6-alpine3.24@sha256:d8703cd7fba306b9fec9268ecedfa8a966846c053036a60e3635791957eb2f66`.
Exact tested runtime image IDs:

| Image | Local image ID |
| --- | --- |
| Backend | `sha256:366e4c76d62c91fbf1dc474665b059cc8212e319b84f83b673f9438305b7c8ad` |
| Frontend | `sha256:cf0e723570cdbc5e85a43135084b0c44a4e018ae15f7a118786a0df8953d560c` |
| Derived PostgreSQL 18 | `sha256:52b47063956def54ddf45b5eb2f0fe1e5b9d6a6590e824088814f174d69d79ae` |
| Redis | `sha256:2d3814be5e9b06a30a0be54770b7e12052e7e79ec85271aefd34875c1f393b23` |

The 19 retained real HTTPS/MFA/accounting browser journeys passed 19/19 in
12.7 minutes, one worker, zero retries on this runtime. Migration matrix: 16
PASS lines. Current startup refusals: 27; CLI ledger and artifact checks passed.
The same-image encrypted disconnected PostgreSQL 18 restore matched source and
restored fingerprints, with source preservation. Four final scans found zero
critical/high and zero secrets; backend has one MEDIUM, other three images have
no findings. The historical official PostgreSQL base findings (1 critical/21
high) are remediated in the derived candidate; retain this history. Existing
installed infrastructure pins remain as installed; the fresh-install receipt
uses the derived PostgreSQL digest. Machine-readable summary is
`/private/tmp/capital-mvp-local-runtime-evidence.json`.

Current hosted evidence is separate. GitHub Actions PR #26 run
[36687877047](https://github.com/PavelArs/capital-tracker/actions/runs/36687877047)
passed lint, unit, build, spec, security and audit, then failed acceptance before
browser execution because a fixture expected 16 migrations while the actual
current ledger is 22. This is a stale fixture, not an authentication regression.
The approved correction `b887a4c` now passes actual scoped PostgreSQL auth-limit
acceptance: exit 0 with 14 original PASS lines in
`/private/tmp/capital-mvp-auth-limits-green.log`. Coverage includes all auth
families; cross-process and last-slot races; 4096-row capacity and expiry;
advisory/target/pruning locks; safe lock timeout and retry; query and COMMIT
refusal with rollback and no internal retry; 5000 ms pool exhaustion; SQL
constraints/indexes; and preservation of all prior ledger rows. The preceding
`/private/tmp/capital-mvp-auth-limits-red.log` records the setup refusal and
explicitly does not claim a behavioral product RED. Hosted CI rerun remains
pending; no hosted acceptance/browser green is claimed.

The owner confirmed the existing server `.env` is an unused template and no
owner database ever existed, resolving first-install history. The strict
helper preserved that env and observed zero related resources; its refusal is
historical evidence. Bootstrap has not run. GitHub `production` environment and main-only branch rule are
configured; `DEPLOY_DISPATCH_SSH_KEY` and
`DEPLOY_DISPATCH_USER=capital-release` are configured. The owner has a classic
`read:packages` PAT and will enter it themselves; no value was received. The new
private key path is `/Users/pavelars/.ssh/capital-tracker-actions`; never read or
print it. Public fingerprint: `SHA256:RiQUzRfzDnexla/4l/H//qAnzI3kAzTM70gWXWKvAOM`.
No server key installation, bootstrap, off-host custody/recovery or deployment
has occurred. Retirement of the old repository-level Docker-capable
`DEPLOY_SSH_KEY` remains pending cutover. No archive or deployed status is
claimed.

## Follow-on release checkpoint (2026-09-30; source snapshot 0ebd7a5)

Hosted PR #26 run [36692852787](https://github.com/PavelArs/capital-tracker/actions/runs/36692852787)
for published source `670b8c1` passed eight basic CI jobs, then failed database-opening
acceptance before browser execution. Safe diagnostic `/private/tmp/capital-mvp-manual-opening-delete-diagnostic.log`
confirms a stale `RESTRICT` delete expectation (`23503` expected, PostgreSQL 18
returns `23001` for the opening-snapshot FK). The printed `costStatus` NOT NULL
stage label is stale; that preceding null-status case passed. Do not infer a product
accounting regression from this fixture mismatch.
Minimal opening changes `9cc9b85` and `b0d377e` were integrated in `f523` and
`c49f2f3`. Independent actual PostgreSQL opening acceptance passes 6/6 in
`/private/tmp/capital-mvp-manual-opening-green2.log`; it verifies exact numeric text
and UTC handling, replay/history, SQL constraints and preservation, atomic type/date/
owner failures, process/race/CAS behavior, commit rollback/retry and safe diagnostics.
The initial actual-DB 24-scenario batch had 19 original PASS and five
`RESTRICT` expectation failures. Reviewed source `9ec4e40` corrected all five; all
24 real PostgreSQL scripts passed across the initial run plus targeted reruns, not
as one uninterrupted 24/24 run. Machine receipt `/private/tmp/capital-mvp-db-compat-evidence.json` records exact same four image IDs, linux/amd64, all five targeted fixtures exit 0 and zero remaining containers. Summary `/private/tmp/capital-mvp-corrected-db-summary.tsv`;
original batch `/private/tmp/capital-mvp-remaining-db-summary.tsv`. Targeted logs are
`/private/tmp/capital-mvp-db-green-<fixture>.cjs.log`. All runs used the same
backend image `sha256:366e4c76d62c91fbf1dc474665b059cc8212e319b84f83b673f9438305b7c8ad`
and PostgreSQL image `sha256:52b47063956def54ddf45b5eb2f0fe1e5b9d6a6590e824088814f174d69d79ae`; no image rebuild or browser rerun. The separate reviewed opening suite passed 6/6 on c49f2f3. Hosted CI and browser acceptance remain pending.

A separate host compatibility probe verified native Docker CLI 29.8, Compose 5.5.1
and the daemon API. Native tools via isolated `cliPluginsExtraDirs` passed on the
server; the temporary nonsecret config was cleaned. Public binding under `/opt`
failed. The owner-run public probe `98482852…` checksum-verifies
`capital_snap_common_bind=PASS` under `/var/snap/docker/common`. Fixed managed runtime is integrated at `/var/snap/docker/common/capital-tracker`,
using Capital-only native PATH and registry extraDirs without a global Docker CLI
override. Task 5.3 evidence covers the actual public bind and isolated native Compose
lookup only; it does not close bootstrap/deployment tasks. The owner reconfirmed
`/opt/capital-tracker/.env` mode 0600 and
`/opt/capital-tracker/.gitignore` mode 0644; contents were not read. Public
deploy key is staged
at `agm:~/.capital-mvp-setup/capital-tracker-actions.pub`, fingerprint
`SHA256:RiQUzRfzDnexla/4l/H//qAnzI3kAzTM70gWXWKvAOM`, not installed. The owner selected
an encrypted recovery archive on the Mac plus password-manager custody, and authorized
deleting the unused deploy account and key after the new `capital-release` path works.
Preserve other home files (do not use `userdel -r`); no unrelated home-file deletions,
private-key reads, production bootstrap or deployment had occurred at this checkpoint.
Bootstrap/deployment remain pending until the current-main candidate and required
operator/release gates are verified. Current public HTTPS had valid TLS but `/health`
returned 404; no deployment occurred.


## Snap host compatibility final evidence (MVP-008, source `036d3ca`)

The actual public bind probe returned checksum-verified
`capital_snap_common_bind=PASS` under `/var/snap/docker/common`; a bind under `/opt`
failed. Native Docker CLI 29.8 and Compose 5.5.1 were found and run with the
isolated `cliPluginsExtraDirs` configuration; the temporary nonsecret config was
cleaned. This closes only task 5.3's host compatibility evidence. It does not claim
bootstrap, recovery or deployment. The reviewed managed runtime uses
`/var/snap/docker/common/capital-tracker`, a Capital-only native PATH and registry
extraDirs; there is no global Docker CLI override.

Final scoped checks against source `036d3ca`: security suite 74 total (73 passed,
one root-only skip), dispatcher runner 32 passed, installer 14 passed and fresh
bootstrap 7 passed after the curated PATH fix. These are separate overlapping
suites; do not add their counts together. The actual baseline bootstrap RED was 6
failures (`/private/tmp/capital-snap-bootstrap-baseline-red.log`); dispatcher
runner RED was 2 failures with 30 passing (`/private/tmp/capital-snap-runner-red.log`).
Final GREEN logs: `/private/tmp/capital-snap-security-final.log`,
`/private/tmp/capital-snap-runner-green.log`,
`/private/tmp/capital-snap-installer-green.log` and
`/private/tmp/capital-snap-bootstrap-final.log`. Strict OpenSpec validation,
shell syntax and diff checks passed. Independent source review approved the exact
source; host bootstrap and deployment remain pending. Public HTTPS had valid TLS,
but `/health` returned 404. The public deploy key remains staged, not installed;
no production bootstrap/deploy or private-key read occurred.

## Hosted CI follow-up — run 36701142974 (source `26b7b91`)

GitHub Actions PR #26 [run 36701142974](https://github.com/PavelArs/capital-tracker/actions/runs/36701142974)
passed all eight basic jobs, then failed in `Release Images and Real Acceptance`
at `docker compose up --wait`, before `pnpm test:e2e` could launch browsers. The
actual error was `container capital-tracker-e2e-client-b-1 has no healthcheck
configured` at 10:26:35Z. Backend, backend replica, frontend, proxy, PostgreSQL,
Redis and provider services were healthy; client-a/client-b remained `Waiting`.
Thus this run provides no browser acceptance, image-scan or candidate-export result.
An attempted cancellation raced with natural completion and did not cancel the run.
Full failed log: `/private/tmp/capital-mvp-third-ci-failed.log`.

The separate manual-opening browser lock observer change is integrated at `bd15e40`.
The predecessor exposed a stale helper expectation (RED log:
`/private/tmp/capital-mvp-opening-browser-red.log`); the reviewed replacement observes
the actual advisory-lock follower → writer → captured-psql-blocker sequence and keeps
the original acceptance oracles unchanged. The two retained cases then passed in
53.6s and 38.5s, without rebuilding images. Strict TypeScript checking of all E2E
files also passed (`/private/tmp/capital-mvp-final-e2e-types.log`, using
`backend/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022
--module commonjs --moduleResolution node --esModuleInterop
--typeRoots backend/node_modules/@types tests/e2e/*.ts`). These focused results do
not replace hosted browser acceptance. Local current-migration, MFA/session, and 27
startup-refusal PostgreSQL checks remain green; all current real-DB scripts passed.
The two-case browser GREEN evidence is `/private/tmp/capital-mvp-opening-browser-green.log`
and `/private/tmp/capital-mvp-opening-browser-evidence.json`. The later client-readiness fix is
covered by scoped tests below; hosted image scans and release/deployment gates remain
open.

## Post-failure readiness and CI checks (integrated sources)

Approved readiness source `618a532` is integrated as `d10e633`; scoped tests against
the real readiness predicate pass 2/2, and the Compose configuration checks against
Compose v5.5.1. CI budget source `e99fd54`, integrated as `732567c`, raised the Docker
build timeout from 35 to 120 minutes. Follow-up `f4fab92` raises it to 180 minutes
based on the hosted run’s observed duration; it has not run yet. Workers, retries,
per-test limits, selection and gates remain unchanged. Formatting-only source
`10aa507`, integrated as `55aec09`, passes
scoped Biome (`/private/tmp/capital-e2e-client-readiness-biome.log`), final readiness
Jest 2/2 (`/private/tmp/capital-e2e-client-readiness-unit-final.log`) and engineering
gates 165/165 (`/private/tmp/capital-ci-release-budget-engineering.log`). Strict
all-E2E TypeScript also passed above. These local checks do not constitute hosted
Compose/Firefox or image-scan acceptance.

## Hosted CI follow-up — run 36706275247 (source `0c62f04`)

GitHub Actions PR #26 [run 36706275247](https://github.com/PavelArs/capital-tracker/actions/runs/36706275247)
tested source `0c62f04`. Eight jobs passed. Release job `109857531845` was cancelled
at its configured 120-minute cap, 11:05:37–13:06:06 UTC; status job `109899752845`
failed because the Docker build job was cancelled. The release job planned 174 E2E
tests; 153 completed with results (144 passed, 9 failed). Test 154 was interrupted
and has no complete result. Do not claim a full-suite result or infer results for the
remaining tests. The cap stopped the unfinished suite; the nine reported failures
occurred before cancellation and require independent diagnosis.

The nine actual failed cases, from the uploaded Playwright artifact, were:

- `SES-002-A` missing CSRF/foreign-Origin currency privacy assertion: received three preexisting `user_currency_preferences` rows instead of `[]`.
- `LIMIT-001-B/LIMIT-001-D` CSRF path variants across restarts: received HTTP 502 instead of 429.
- `LIMIT-001-B` factor admission across restarts: received HTTP 502 instead of 429.
- `CARRY-001-A` exact lot provenance after restart: expected a string, got `undefined`.
- `CSV-001-A` private original retention across repetition/restart: HTTP 502 instead of 200.
- `OPEN-001-A/OPEN-002-A` opening values/restart/history: timed out waiting for the “Начальные данные” button.
- `PRICE-UI/PRICE-RECOVERY` committed price retry/late read: timed out waiting for the price editor response/control.
- `CSV-006-A` sale-first import/restart/rollback: timed out waiting for the “Вид операций” combobox.
- `SWAP-UI` committed exchange retry across SPA remount: the case exceeded 120 seconds; cleanup then observed the closed page.

Log: `/private/tmp/capital-mvp-fourth-ci-release.log`. The real uploaded failure
artifact is locally extracted at `/private/tmp/capital-mvp-ci4-artifact`; Actions
artifact ID `11097437276`. Image scans, candidate export, promotion, bootstrap and
deployment did not run. These release tasks remain open.

Separate local Compose/Firefox evidence for source `55aec09` completed 4/4 in 2.7m,
one worker, zero retries: three genuine Firefox page cases (MFA pending/private
denial; TOTP form rotation/session durability across restarts; logout and copied
credential revocation) plus one engine-independent source-client API case
(client A exhausted quota while client B completed password/MFA admission). Compose
health readiness and cleanup passed. Exact identities and receipt:
`/private/tmp/capital-mvp-firefox-critical-evidence.json`. This does not substitute
for the incomplete hosted run. Strict all-E2E TypeScript passed at
`/private/tmp/capital-mvp-final-e2e-types.log`. The owner's Snap common-bind probe
`capital_snap_common_bind=PASS` is separately recorded under MVP-008 above.

## Initial targeted local runtime run — source `61ce070` (historical; superseded below)

Approved harness-security source `a28fd73` and financial acceptance source
`ee33d68` are integrated as `a730f4f` and `c9c03fa`. At test source
`61ce07072e09b095e73ce693f0ad8a6738031661`, a targeted real HTTPS/password/MFA/
backend/PostgreSQL run used the exact cached four-image application set from source
`7274076`, including unchanged frontend image
`sha256:cf0e723570cdbc5e85a43135084b0c44a4e018ae15f7a118786a0df8953d560c`. OpenSpec
strict validation passed 45/45 at integrated `48e466a`, before the pagination
change was created; current all-change validation remains pending. This is local
acceptance, not hosted CI or release evidence.

The no-retry, one-worker selection included the two previously failing LIMIT cases,
SES-002-A, OPEN-001-A/OPEN-002-A, CARRY-001-A, CSV-001-A, CSV-006-A, SWAP-UI,
PRICE-UI/PRICE-RECOVERY, CVIS-UI and one password-restart neighbor. Results: 5/11
passed (SWAP-UI; password-restart neighbor; both original LIMIT failures; CARRY-001-A),
CSV-006-A found one product failure, and five cases were unrun after the first failure:
SES-002-A, OPEN-001-A/OPEN-002-A, CSV-001-A, PRICE-UI/PRICE-RECOVERY and CVIS-UI.
This is not an 11/11 pass. Cleanup left zero owned containers/networks. The global
Docker context remained `desktop-linux`, and the owner Nginx checksum was preserved.
Receipt: `/private/tmp/capital-mvp-ci4-selected-evidence.json`.

CSV-006-A fails in `inspectAndMap`, before preview, restart or financial oracles. The
first `CsvMapping` load-more request repeats the already displayed first page of 50
instruments because the child component loses the parent cursor. Deduplication then
leaves the dropdown count unchanged while the cursor primes the next page; the existing
strict per-click-growth helper times out. Request proof is
`/private/tmp/capital-mvp-ci4-csv-pagination-red.json`; trace is recorded in the
receipt. The fixture/helper was not weakened or changed. OpenSpec change
`fix-csv-instrument-pagination` is undergoing ATDD implementation in worktree
`capital-tracker-csv-pagination`; it is not complete or archived. Next: rebuild the
frontend to a new image ID, rerun the two CSV cases, then run the remaining five
selected cases including CVIS-UI. The 180-minute CI budget change `f4fab92` remains
unrun. The prior hosted failures are now classified as six post-restart 502s, two
first-page observers and one currency-preference-state mismatch, but actual GREEN
acceptance remains incomplete. No new hosted CI, image scans, candidate export,
promotion, bootstrap or deployment has run.

## Final CSV pagination runtime follow-up (2026-10-01)

The CSV-006-A failure at source `61ce07072e09b095e73ce693f0ad8a6738031661` was
a real product RED: the first CSV load-more repeated the visible instrument page
because its child-owned cursor was unset. The unchanged HTTPS helper correctly stopped
on zero visible option growth. The fix delegates CSV instrument discovery to the
account page's authoritative choices and cursor. OpenSpec change
`fix-csv-instrument-pagination` was archived into
`openspec/changes/archive/2026-10-01-fix-csv-instrument-pagination/`; its two
requirements were synced into canonical `openspec/specs/csv-workbench/spec.md` and
strict validation passed 45/45 (`/private/tmp/capital-mvp-ci4-archived-openspec.log`).
This closes the pagination change only.

The source-approved frontend change is `efb7e60d6c223ecadeff037eee9d0729cbc0d899`.
Its new `linux/amd64` image has ID
`sha256:fb1c86b402438de3e153d39f9ff39f8562b6f76177b94760e2531c03ddf3d1a6`; cached
backend, PostgreSQL 18 and Redis images from `7274076` were retained. Build receipt:
`/private/tmp/capital-mvp-ci4-frontend-build-evidence.json`. Exact real HTTPS/MFA/
backend/PostgreSQL CSV-006-A/B passed 2/2 in 102.650 seconds, one worker and zero retries.
The complete affected frontend unit set passed 12/12 across five files after six
expected predecessor RED failures. Strict frontend types, production build and scoped
Biome checks passed. Logs:
`/private/tmp/capital-csv-pagination-unit-red.log`,
`/private/tmp/capital-csv-pagination-affected-unit-complete.log`,
`/private/tmp/capital-csv-pagination-types.log`,
`/private/tmp/capital-csv-pagination-build.log` and
`/private/tmp/capital-csv-pagination-style.log`.

The separate remaining selection passed 7/7 in one uninterrupted real runtime run
(315.024 seconds, 5.3 minutes; one worker, zero retries), including CVIS-UI and the original hosted
session/privacy, opening, CSV upload and USD-price failures. The session case
preserved the same three currency-preference rows as its pre-test state. Receipt
`/private/tmp/capital-mvp-ci4-remaining-evidence.json`; log
`/private/tmp/capital-mvp-ci4-remaining.log`. Combined with the earlier old-frontend
5 passes and new-frontend CSV 2 plus remaining 7, this gives 14 unique selected passes
across separate runs, not one unified 14/14 run or the hosted 174-test suite. The
original runtime RED remains historical; final independent review approved the
receipts summarized in `/private/tmp/capital-mvp-ci4-staged-summary.json`.

All nine cases that failed in hosted run 36706275247 now have selected local GREEN
evidence. Six restart-associated HTTP 502s traced to missing HTTPS edge routing
verification after backend restarts; the harness now probes the selected backend
pool through HTTPS before assertions and retries harmless health checks only. Two
tests assumed the target account/instrument was on page one; the selectors now load
pages until the exact UUID is present. The currency privacy test assumed empty seeded
`user_currency_preferences`; it now snapshots pre-test state and asserts denied
writes preserve those rows. These are scoped local results, not a repeat of hosted CI.

The initial predecessor batch on the old frontend had 5 passes, one CSV pagination
product RED and 5 unrun cases. The new-image CSV 2 and remaining 7 passed in separate
runs. All three runtime batches used one worker and zero retries; cleanup left zero
owned containers/networks, the global Docker context remained `desktop-linux`, and
the owner Nginx checksum/mode remained unchanged. The 180-minute hosted job budget
has not yet run. No new hosted CI, image scan, candidate export/promotion, bootstrap
or deployment is evidenced. Remaining manual-MVP gates are trusted current-main
hosted CI, fresh promotion receipt, owner bootstrap and direct PAT entry, encrypted
Mac recovery archive/password-manager custody, restricted dispatcher install and
inventory/preflight, deployment, post-deployment backup verification, old key/account
retirement after verified cutover, and final manual-MVP archive. The whole product
remains incomplete.
