# Verification — patch-frontend-runtime-pcre2

## Actual RED and package availability

PR #29 CI run `37008110156` on source `c4da0476ce29758f231388ab9e4fd5d8b0712ffe` passed 20/20 selected real acceptance cases. Its actual frontend Trivy report `/private/tmp/capital-allocation-ci-37008110156-security/frontend-image-security.json` records Alpine 3.24.2, `pcre2` 10.48-r0, HIGH CVE-2026-103111, fixed version 10.49-r0. The frontend image gate failed and no candidate export occurred. This is IMG-PCRE2-001-A's actual RED; no artificial unit failure was created.

The official [Alpine v3.24 main x86_64 repository listing](https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/) showed `pcre2-10.49-r0.apk`, dated 2026-10-01, when checked on 2026-10-02. This confirms the exact package exists for the affected branch and architecture; package installation into this project's image has not been observed locally.

## Source checks and pending image gate

The frontend Dockerfile diff adds only `RUN apk add --no-cache pcre2=10.49-r0` in the release stage. Both original immutable `FROM` digests, builder instructions, Nginx configuration copy and health check remain unchanged. `git diff --check` passed. `OPENSPEC_TELEMETRY=0 openspec validate --all --strict --no-interactive` passed 50/50 items, including this change.

IMG-PCRE2-001-B/C remain **unverified**: local Docker is unavailable and no image build, installed-package inspection, frontend image scan, candidate export or fresh acceptance was run from this patched source. The prior 20/20 acceptance result belongs to the old source and image. Root must integrate the reviewed commit, run the existing hosted image/build/scan and source-bound acceptance gates, confirm exact installed `pcre2` 10.49-r0 plus zero high/critical image findings, and only then consider candidate export. No production or server action occurred in this worktree. Keep the change active until that evidence is recorded.

Root integrated the patch as `cd28c11` after the independently reviewed allocation and valuation presentation changes. Combined strict OpenSpec validation passed 51/51. The unchanged engineering gates passed 196 Jest tests and 10 Node tests; these verify source/profile/receipt policies, not a rebuilt image or scanner GREEN.
