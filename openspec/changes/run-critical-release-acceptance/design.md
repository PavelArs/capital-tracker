## Context

ENG-005 currently pauses hosted browser/runtime acceptance, so green CI only proves build, scan and non-E2E gates. The owner's 2026-10-01 decision permits a shorter real release acceptance while broad browser coverage is cleaned up. The unused 19-case manifest offers an exact source inventory; the additional CSV-006-B auth-recovery journey covers a material missing release risk. Independent source review found the selected response interception forwards real service responses or loses/delays their delivery after a real fetch, without synthetic own-backend/auth replies. This is source evidence, not a runtime pass.

## Goals / Non-Goals

**Goals:** Keep every fixed provider HTTPS/TLS, migration, PostgreSQL domain, owner CLI/MFA, startup, artifact, image/security and cleanup gate. Select 20 exact browser file/title cases, including CSV auth renewal. Reject duplicate, missing, ambiguous, skipped, partial or failed selection and execution. Bind the receipt to source commit, CI run, profile and manifest hash, and validate it before candidate export and any CD publishing/server access. Retain the unchanged full manual command.

**Non-Goals:** Change application authentication, accounting, migrations, dependencies, lockfiles, test assertions, release image format, production data or server setup. This change does not itself run Docker locally, hosted Actions, backup/restore, promotion or deployment.

## Decisions

- The `critical` mode enters the existing acceptance runner. Its setup and `finally` cleanup remain shared with full mode; only the Playwright invocation and receipt differ. The default `pnpm test:e2e` continues to run the full suite, while `pnpm test:e2e:critical` selects the release profile.
- Use the actual Playwright `--list --reporter=json` discovery output before starting Docker. Validate each manifest file/title against exactly one discovered test, require globally unique selected titles, escape each title into an anchored OR expression, and pass the selected file paths. This prevents substring, file-route, duplicate and missing-case drift. One worker and zero retries remain explicit.
- Parse Playwright's JSON execution report and require exactly one passing result per required case, no skipped or unexpected statuses, and no extra cases. Emit one small `critical-release-acceptance.json` receipt only after the real runner completes. Remove any stale receipt at startup. The receipt stores schema version, `critical` profile, source SHA, Actions run ID, manifest SHA and ordered selected file/title/pass entries; no secrets or synthetic fixture values.
- CI keeps all early jobs and four image scans. Its named critical acceptance and receipt verification steps must succeed before exporting the existing schema-v3 image manifest. CD checks exact trusted main push/job/step provenance, downloads the receipt artifact and validates it against the checked-out manifest and commit/run before candidate image download, registry publishing or SSH. Separate receipt validation avoids changing the existing image manifest schema or server receipt contracts.

## Risks / Trade-offs

- A selected browser set is narrower than the full suite, so broader browser regressions remain possible. The full manual suite stays available and its unrun status is explicit. Fixed real PostgreSQL/provider/security gates still execute on every critical run.
- A forged receipt within a compromised trusted CI run is outside this script's trust boundary; trusted run provenance, exact source checkout and GitHub artifact retrieval are required. Missing, expired or malformed artifacts fail closed.
- JSON reporter shape or test-title changes can break selection. Contract tests and pre-Docker discovery fail visibly rather than silently dropping coverage.

## Migration Plan

Merge the reviewed source change; run its scoped contract/strict-spec checks, then obtain actual hosted critical acceptance and image/security receipts on the exact main commit. CD promotion remains separate and requires the owner-approved release process, actual backup/restore and server prerequisites. Roll back the source change if the hosted profile fails; do not promote a candidate without its exact receipt. Existing database and runtime state are untouched by this source-only change.

## Open Questions

Hosted runtime and server operational results remain unrun until the root release coordinator executes them. They are not marked complete in this change.
