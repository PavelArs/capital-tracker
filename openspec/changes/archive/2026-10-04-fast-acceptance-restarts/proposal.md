## Why

Hosted CI takes about 33 minutes per run and the owner pays for Actions minutes since
2026-10-04 ("очень долго выполняется прогон е2е"; the account hit its spending limit).
In green run 37220925062 the critical acceptance step took 29 min 21 s. Every one of
the 21 browser cases restarts both backends from its auto fixture, and 4 cases restart
again in their body: 25 restarts of about 12.5 s each. The backend image runs Node as
PID 1 (`backend/Dockerfile` `CMD ["node", "backend/dist/main.js"]`) without a SIGTERM
handler or init process, so the stop signal is ignored and every `compose restart`
waits Docker's default 10 s before the same SIGKILL (teardown in that run: backend
`Stopping 18:04:34` → `Stopped 18:04:44`).

## What Changes

- The acceptance harness restarts the backend pair with `--timeout 0`, so Docker kills
  the processes at once instead of after the ignored 10 s grace period. Readiness
  checks after the restart are unchanged.

## Capabilities

### Modified Capabilities
- `isolated-release-acceptance`: ISO-006 acceptance restarts skip the ignored stop
  signal.

## Impact

`tests/e2e/replicas.ts` and an engineering test only. Expected saving about 4 minutes
of wall time and billed minutes per CI run (inferred from the log; hosted CI on the PR
measures it). No application, image, release or production Compose change; the
production stop behaviour of the backend is not touched.
