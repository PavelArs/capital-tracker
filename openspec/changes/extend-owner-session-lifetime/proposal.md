## Why

The owner is often sent back to sign-in. A full session expired after thirty minutes
without activity (and at most twelve hours after sign-in), so leaving the app open
during a break ended the session. The owner asked for a session that lives about a
day after authorization.

## What Changes

- A full session lasts 24 hours from factor completion. The thirty-minute idle
  timeout is removed; activity still records `lastSeenAt` but never extends the
  deadline.
- The session cookie `maxAge` matches the 24-hour server deadline.
- Anonymous and pending sessions keep their five-minute lifetime. Logout, CLI
  recovery, factor replacement and the ten-session cap still end sessions early.

## Capabilities

### Modified Capabilities
- `owner-sessions`: SES-001 states the one-day lifetime; SES-001-C replaces the idle
  boundary with "unused for most of a day still works".

## Impact

Backend `SessionService` and the MFA cookie only. No schema change, no migration, no
environment variable or Compose change. Existing sessions keep the deadline they were
issued with; sessions issued after deploy get 24 hours.
