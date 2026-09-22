# Verification — establish-brownfield-baseline

Date: 2026-09-21. Base commit: 9c78d80036d6314e8902dc54adb0e26d30d156a2;
verified local scoped working-tree changes, not a published release. Runtime for
final commands: Node 22.21.1, pnpm 10.33.0, OpenSpec 1.2.0. No production access.

## Traceability and executed evidence

| Requirement | Tests/evidence | Result |
|---|---|---|
| ENG-001 A/B/C | backend/src/engineering/gates.spec.ts invokes scripts/check-ci-results.cjs with all required statuses and invalid inputs | GREEN |
| ENG-001 D | Same suite parses actual YAML and executes actual gate command with rendered needs; removes each required job | GREEN |
| ENG-002 A | Same suite verifies dispatch-only, main/explicit opt-in and transitive layout | GREEN |
| ENG-002 B | New review regression requires successful entry gate, failed deploy and nonempty prior image | RED then GREEN |
| CHAR-AUTH-001 | auth/guards/jwt-auth.guard.spec.ts: real Passport JWT extraction/signature/expiry, no attached identity on denial | 6 passing cases; no HTTP server or PostgreSQL claim |
| CHAR-WALLET-001 | crypto/crypto.service.spec.ts: synthetic owner-scoped repository fixture and provider-call spies | 3 added passing cases; repository remains mocked |
| ENG-003 A | docs/brownfield-audit.md, docs/provider-feasibility.md, actual logs, independent review | Complete for engineering slice |

Commands and results:

- Initial `pnpm install --frozen-lockfile`: passed after authorized network access.
- Initial backend `pnpm --dir backend test --runInBand`: 108 tests / 6 suites pass.
- Initial frontend test under incompatible default shell runtime: ERR_REQUIRE_ESM,
  7 workers failed. Not behavior RED. Node 22 rerun: 59 tests / 7 files pass.
- Before implementation `pnpm --dir backend exec jest engineering/gates --runInBand`:
  140 failed / 1 passed. Valid RED: eight required aggregate jobs expected, six
  found (Docker/spec missing); CD dispatch-only expected, push present; initial
  guard missing. Missing CLI failures were prerequisites, not behavior RED.
  Raw log `/tmp/capital-engineering-gates-red.log`.
- QA also discovered pre-existing invalid CD YAML indentation in notification text.
  Fixed indentation before behavior RED; no external message sent.
- Initial GREEN: `pnpm test:engineering`: 141 tests pass.
- `pnpm verify:baseline`: exit 0; strict specs, backend/frontend lint (99/38 existing
  warnings), both builds (existing bundle-size warning), backend 258 tests / 8 suites,
  frontend 59 tests / 7 files. `/tmp/capital-baseline-green.log`.
- Review regression `... jest engineering/gates --runInBand --testNamePattern=ENG-002-B`:
  intended assertion RED on insufficient rollback conditions. Fixed condition.
- Final `pnpm test:engineering`: 142 tests pass, `/tmp/capital-engineering-final.log`.
  Other application code unchanged since full regression; no unnecessary duplicate run.
- `pnpm install --frozen-lockfile --offline`: passed with same approved external store.
  Sandbox attempt selected a different store and aborted before removal; not a passing check.
- `cmp frontend/nginx.conf /Users/pavelars/Projects/capital-tracker-old/frontend/nginx.conf`:
  exit 0. Owner edit preserved byte-for-byte.
- `git diff --check`: pass; final strict spec validation recorded at archive.

## Independent review

Separate QA context wrote gate tests before implementation; separate review context
reviewed CLI, workflow wiring, auth characterization and docs. Reviewer found:

1. Auth scenario wording overstated direct guard tests as handler execution.
   Clarified guard-level scope; future real HTTP denial requirement remains intact.
2. Rollback could run after build/version failure when deploy was skipped.
   Added ENG-002-B regression (RED), then required successful version, failed deploy,
   nonempty/non-none prior image (GREEN). Reviewer confirmed resolved.

No remaining blocking findings for this scoped engineering change. This does not
approve the retained legacy deployment procedure.

## Action pin provenance

Verified exact tags using `git ls-remote https://github.com/<owner>/<repo>.git refs/tags/<tag>`:

| Action tag | Commit |
|---|---|
| actions/checkout v4.2.2 | 11bd71901bbe5b1630ceea73d27597364c9af683 |
| actions/setup-node v4.4.0 | 49933ea5288caeca8642d1e84afbd3f7d6820020 |
| pnpm/action-setup v4.2.0 | 9fd676a19091d4595eefd76e4bd31c97133911f1 |
| actions/upload-artifact v4.6.2 | ea165f8d65b6e75b540449e92b4886f43607fa02 |
| docker/setup-buildx-action v3.10.0 | b5ca514318bd6ebac0fb2aedd5d36ec1b5c232a2 |
| docker/build-push-action v6.15.0 | 471d1dc4e07e5cdedd4c2171150001c434f0b7a4 |
| docker/login-action v3.4.0 | 74a5d142397b4f367a81961eba4e8cd7edddf772 |
| webfactory/ssh-agent v0.9.0 | dc588b651fe13675774614f8e6a936a468676387 |

## Limits and next slice

No real PostgreSQL, migration, release-image, Playwright, security scanner, backup
restore or rollback execution yet. No GitHub-hosted run or production deployment.
Docker daemon 29.5.3 is now accessible; cached images are not proof of tested source.
Frontend coverage remains 35.41% statements / 18.75% branches; the pre-existing
nested global thresholds are not effective. Do not call unit pass full coverage.

The current spec contains engineering guarantees only. All target product/security/
release requirements remain in the target brief and follow-up sequence. First next
slice must establish isolated real migration/image/HTTPS browser execution before
claiming any critical user journey passes end to end.
