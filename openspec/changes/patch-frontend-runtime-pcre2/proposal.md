## Why

PR #29 CI run 37008110156 passed its 20 selected real acceptance cases but the frontend image scan found HIGH CVE-2026-103111 in Alpine `pcre2` 10.48-r0. The required image gate rejected candidate export; Alpine v3.24 main for x86_64 now publishes the scanner's 10.49-r0 fixed version.

## What Changes

- Install exactly `pcre2=10.49-r0` in the existing frontend Nginx release stage, retaining its immutable base image digest.
- Record the scanner RED and require a rebuilt image package check plus high/critical image scan GREEN on the exact candidate before export.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `engineering-gates`: add a specific frontend runtime image remediation and evidence requirement under the existing fail-closed image gate.

## Impact

Only `frontend/Dockerfile` and this change's evidence are affected. No Node version update, base image change, lockfile, workflow, migration, application behavior, infrastructure image, dependency policy, advisory exception, deployment or owner data change. The patch depends on the existing Alpine v3.24 main x86_64 repository and the hosted image/security gate for the rebuilt exact source.
