# Verification — patch-frontend-runtime-pcre2

## Actual RED and package availability

PR #29 CI run `37008110156` on source `c4da0476ce29758f231388ab9e4fd5d8b0712ffe` passed 20/20 selected real acceptance cases. Its actual frontend Trivy report `/private/tmp/capital-allocation-ci-37008110156-security/frontend-image-security.json` records Alpine 3.24.2, `pcre2` 10.48-r0, HIGH CVE-2026-103111, fixed version 10.49-r0. The frontend image gate failed and no candidate export occurred. This is IMG-PCRE2-001-A's actual RED; no artificial unit failure was created.

The official [Alpine v3.24 main x86_64 repository listing](https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/) showed `pcre2-10.49-r0.apk`, dated 2026-10-01, when checked on 2026-10-02. This confirms the exact package exists for the affected branch and architecture; package installation into this project's image has not been observed locally.

## Historical source checks before hosted verification

The frontend Dockerfile diff adds only `RUN apk add --no-cache pcre2=10.49-r0` in the release stage. Both original immutable `FROM` digests, builder instructions, Nginx configuration copy and health check remain unchanged. `git diff --check` passed. `OPENSPEC_TELEMETRY=0 openspec validate --all --strict --no-interactive` passed 50/50 items, including this change.

At the source-preparation checkpoint IMG-PCRE2-001-B/C remained **unverified**: local Docker is unavailable and no image build, installed-package inspection, frontend image scan, candidate export or fresh acceptance was run from this patched source. The prior 20/20 acceptance result belongs to the old source and image. Root must integrate the reviewed commit, run the existing hosted image/build/scan and source-bound acceptance gates, confirm exact installed `pcre2` 10.49-r0 plus zero high/critical image findings, and only then consider candidate export. No production or server action occurred in this worktree. Keep the change active until that evidence is recorded.

Root integrated the patch as `cd28c11` after the independently reviewed allocation and valuation presentation changes. Combined strict OpenSpec validation passed 51/51. The unchanged engineering gates passed 196 Jest tests and 10 Node tests; these verify source/profile/receipt policies, not a rebuilt image or scanner GREEN.

## Combined hosted verification and visual finding

[CI run 37013305851](https://github.com/PavelArs/capital-tracker/actions/runs/37013305851) completed **SUCCESS**, all 10/10 jobs. Tested synthetic merge `13c98d5250d64c92b68dac10f69cee2c380f9a46` and reviewed branch head `8e4b29291b4bfb0d84e9b872972753af403b84ca` have the same tree `b311cfb181cc0defba63fb570cf0c487cbe3484f`, verified locally and through the GitHub commit API. The canonical receipt passed root's unchanged verifier (exit 0) against that exact merge/run identity. Its manifest hash identifies the scenario manifest, not the candidate image manifest.

Actual logs `/private/tmp/capital-mvp-ui-ci-37013305851-public-evidence.log` prove the final frontend upgraded pcre2 10.48-r0 to 10.49-r0, PostgreSQL probes `PASS MPV-EXACT/GAPS/PRIVATE`, `PASS MPV-SNAPSHOT`, and `PASS MPV-PRECISION/BOUND` (79 ms observation, not an SLA), and 20/20 critical Playwright cases in 15.9 minutes. The full critical step ran 13:32:02–13:56:53 UTC. All four exact-image HIGH/CRITICAL vulnerability and secret gates passed; backend and PostgreSQL each retained one MEDIUM, frontend and Redis zero. Frontend ImageID is `sha256:b5f0d94bf66d7bdb7b5673b719a6d64e88b4c27ad04c072ab5f1215a88c1407a`. Candidate export/upload succeeded; artifact metadata ID 11229964010. Root did not download its 237 MB image archive or perform promotion/deployment.

Independent root/designer inspection of six real MPV-UI frames at `/private/tmp/capital-mvp-ui-ci-37013305851-mpv-ui/` rejected narrow-table readability: at 360/768px numeric strings fragment vertically. Passing text assertions do not establish usable numeric presentation. The active UI change is being corrected with minimum table widths, unbroken numeric columns and stronger same-case browser assertions; actual new frames/acceptance remain pending. Do not cite this run for subsequently changed CSS or call the whole frontend redesigned.

## Completion boundary

The independently reviewed package patch is now verified for exact source `13c98d5` / tree-equal `8e4b292`: APK installed 10.49-r0, all four unchanged exact-image security gates passed, source-bound acceptance and candidate export succeeded. IMG-PCRE2-001-C uses the preserved fail-closed build/scan policy and the prior observed blocked export; no intentionally unavailable production package or artificial vulnerability was created. The separate valuation visual correction remains active and will require its own rebuilt-image acceptance. This security patch can be archived independently; it does not claim UI visual approval or authorize deployment.
