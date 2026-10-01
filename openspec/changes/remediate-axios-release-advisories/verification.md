# Axios remediation verification

Date: 2026-10-01. Base: `a661fc4` integration checkpoint, isolated
`fix/manual-mvp-axios` worktree. Initial local source verification used no Docker,
deployment, archive or remote push.

## AXS-001-A/C — actual dependency RED/GREEN

Actual hosted run 36857990125 production audit exited 1: 7 high, 6 moderate.
Displayed high advisories are Axios, with patched range >=1.20.0.
`/private/tmp/capital-mvp-ci5-audit-job.log` is the original hosted receipt.
Existing passing functional characterization was preserved; no deliberate RED.

Root verified official exact npm metadata and its integrities:
`/private/tmp/capital-axios-registry-1.20.0.json` and
`/private/tmp/capital-axios-follow-redirects-metadata.json`.
Both manifests use Axios 1.20.0; lock diff is 11 additions/11 deletions, limited to
Axios importer/package/snapshot and follow-redirects 1.16.1 within Axios's range.
Provider image probe asserts 1.20.0. Existing Multer/YAML overrides unchanged.

Root's real registry full audit `/private/tmp/capital-axios-audit-after-root.json`
exited 1: 0 high/critical/low/info, 1 moderate, 332 production dependencies.
Required gate `/private/tmp/capital-axios-audit-gate-root.log` exited 0.
Remaining Multer diskStorage advisory, bounded memory-storage applicability review,
owner and 2026-10-08 expiry are recorded in `docs/dependency-security.md`.
No ignore/mute entries; registry failure cannot be interpreted as a clean audit.
Lock SHA256: `37276bfd9014162a5c77824cf125c99d3ac7550a733fde2fc99d2b49a3da679b`.

## AXS-001-B — retained source characterization

All successful commands used Node 22.23.2 / pnpm 10.33.0.
Earlier Node20 failures are not evidence against the supported graph; supported
Node22 pre-upgrade reruns passed and are the retained baseline.

| Check | Actual result | Evidence under /private/tmp |
| --- | --- | --- |
| Pre-upgrade backend Jest provider/domain/runtime | 64/64, 3 suites | capital-axios-backend-before-node22.log |
| Pre-upgrade frontend client/AuthContext/Login Vitest | 39/39, 3 files | capital-axios-frontend-before-node22.log |
| `CI=true pnpm install --frozen-lockfile` | exit0, frozen graph, no resolution refresh | capital-axios-frozen-node22-live.log |
| Same backend Jest scope after upgrade | 64/64, 3 suites, exit0 | capital-axios-backend-after-node22.log |
| Same frontend Vitest scope after upgrade | 39/39, 3 files, exit0 | capital-axios-frontend-after-node22.log |
| Backend lint, `exec tsc --noEmit`, build | all exit0; 77 existing lint warnings | command execution receipt; build: capital-axios-backend-checks-node22.log |
| Frontend lint, `exec tsc --noEmit`, build | all exit0; 27 existing lint warnings and existing chunk warning | command execution receipt; build: capital-axios-frontend-checks-node22.log |
| `node openspec/changes/remediate-axios-release-advisories/http-characterization.cjs 1.20.0` | 5/5 real backend HTTP checks, exit0 | capital-axios-http-after-node22.log |

HTTP checks use synthetic loopback data, actual backend HTTP adapter and explicit
provider request options: maxRedirects0 makes zero destination requests, preserves
429 Retry-After, rejects body >65536 bytes and stalled request at configured timeout,
and retains textual success values. Frontend package VERSION asserted separately;
browser adapter is not tested by this fixture. Pre-upgrade HTTP fixture was UNRUN
because listen was denied (EPERM); no pre-upgrade transport PASS is claimed.
Post-upgrade authorized loopback execution passed at the historical command path
shown in the table. The script was subsequently moved byte-for-byte to
`tests/transport/axios-http-characterization.cjs` so archiving the change retains
the regression fixture. Current repository-root command:
`node tests/transport/axios-http-characterization.cjs 1.20.0`.
Before/after script SHA256 is identical:
`e641d24052068e835d58746cbaecb073990aafaa689509ed5f1155cde81653cb`.
`node --check tests/transport/axios-http-characterization.cjs` passed on Node22.23.2.
No HTTP or scoped-suite rerun was needed for this content-identical move.

An initial sandbox frozen attempt hit ENOTFOUND and was stopped (exit130);
prior offline attempt lacked a TTY and did not count as a pass. Authorized registry/
cache frozen install succeeded. Existing blocked dependency-script warnings are
retained; no `approve-builds` policy change was made.

## Mandatory checks remaining

Independent source review **PASS**, no blocking findings, on frozen source
`79f874a` atop `ed8c299`. The separate reviewer approved the final diff and
independently checked the byte-identical fixture SHA256, Node syntax and diff.
This closes task 3.1 only; it does not establish runtime or release acceptance.

Rebuilt release-image exact-version/provider TLS and
selected real HTTPS/password/MFA/CSRF/stored-provider/browser/PostgreSQL acceptance
UNRUN: Docker unavailable and explicitly prohibited for this task. Broad E2E
UNRUN. Hosted build/scan evidence is recorded below. These are separate runtime/
release evidence and must not be
inferred from unit, HTTP or source build checks. Change stays active, unarchived.

Strict `OPENSPEC_TELEMETRY=0 pnpm exec openspec validate --all --strict --no-interactive`
using installed OpenSpec 1.2.0 passed **46/46**, exit0. Receipt:
`/private/tmp/capital-axios-openspec-final.log`. `git diff --check` passed.
Source tasks 1.1–2.3 and independent source review task 3.1 complete.
Runtime task 3.2 and final integration/archive task 3.3 remain open.

## Hosted build/security follow-up (2026-10-01)

Fresh API receipt `/private/tmp/capital-mvp-ci6-run.json`, independently verified
by Root, records [Actions 36886571152](https://github.com/PavelArs/capital-tracker/actions/runs/36886571152)
at exact combined source `f85a638da84b3f9f5df2e146aaaa8f9cc11d9c0c`: SUCCESS,
10/10 jobs including the production audit, application builds/tests, engineering/
security gates and paused release-image job. Backend/frontend/PostgreSQL image
build, all four image scans and exact-image high/critical enforcement passed.
This is image-gate success, not a claim of zero overall scanner findings.

Browser installation/full acceptance and tested-candidate export/upload were
skipped. Actual new-image provider TLS/transport and HTTPS/password/MFA/CSRF/
stored-provider/browser/PostgreSQL acceptance remain UNRUN; Docker is unavailable
locally. No tested runtime candidate, promotion or deployment exists from this run.
Task 3.2 and final integration/archive task 3.3 remain open, and this change stays
ACTIVE. The tracked MODERATE Multer finding remains due for triage 2026-10-08.
