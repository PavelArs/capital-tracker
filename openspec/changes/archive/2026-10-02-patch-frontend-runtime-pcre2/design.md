## Context

The PR #29 frontend image contains Alpine 3.24.2 from the pinned Nginx runtime digest. Its actual Trivy report identifies HIGH CVE-2026-103111 in `pcre2` 10.48-r0 and gives 10.49-r0 as fixed. The image gate failed despite 20/20 critical acceptance cases passing, and no candidate was exported. The official Alpine [v3.24 main x86_64 repository](https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/) lists `pcre2-10.49-r0.apk` dated 2026-10-01.

## Goals / Non-Goals

**Goals:** Replace this one vulnerable runtime package at an exact fixed version while preserving the pinned base image and fail-closed image security gate.

**Non-Goals:** Node upgrade, moving Alpine branches, replacing the Nginx digest, broad package upgrade, scanner exclusion, lockfile or workflow edits, application or deployment changes.

## Decisions

Add `RUN apk add --no-cache pcre2=10.49-r0` immediately after the existing `FROM ... AS release`. This targets the vulnerable package in the final served image and lets the existing v3.24 repositories resolve dependencies. Exact pinning fails the image build if that patch is unavailable; neither edge repositories nor `latest` tags are used. Updating the builder would not patch the final image. Moving the Nginx base digest or running an unbounded `apk upgrade` would widen the change and scan surface.

The existing image scan remains the release oracle. A subsequent CI candidate must show pcre2 10.49-r0 installed and pass the high/critical frontend image scan; the previous 20/20 acceptance result applies only to its old source and image. Static Dockerfile inspection and OpenSpec validation can be completed locally; local Docker is unavailable, so no local image-build or scanner GREEN is claimed.

## Risks / Trade-offs

- Repository propagation or package retention changes may make the exact pin unavailable → the build fails closed and CI cannot export a candidate.
- The patched package adds a new runtime layer above the immutable Nginx base → the resulting image digest changes and requires a fresh scan and bound candidate evidence.
- Other image advisories can appear independently → the unchanged scanner gate must still reject high/critical findings without an exception.

## Migration Plan

No data migration or service configuration change. Rollback is a source revert before producing a candidate; it does not authorize release of the previously failing image. Any eventual production rollout follows the existing promoted-digest workflow and its own gates.

## Open Questions

None for source preparation. The rebuilt-image package and scan result await hosted CI.
