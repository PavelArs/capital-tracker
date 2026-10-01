## Context

The selected repository has six Jest suites, seven Vitest files, eight TypeORM
migrations and GHCR/Compose workflows. The provided OpenSpec configuration has no
implemented specs or other active changes. The audit is in docs/brownfield-audit.md.
The separate unversioned Bun MVP and unrelated projects are not deletion candidates.

## Goals / Non-Goals

Goals: a documented baseline, independent characterization, pinned specification
tooling, and an executable fail-closed CI aggregate including Docker/spec checks.
Non-goals: changing portfolio/auth/schema behavior or claiming deployment readiness.
The full target remains in the target brief and audit follow-up sequence.

## Decisions

- Keep Git history, pnpm, supported Node 22, frameworks and existing registry. Work
  in a local clone to isolate changes and preserve the original dirty Nginx file.
- Reuse Jest for gate tests (backend test discovery) and existing unit tests.
  A Node CommonJS CLI accepts GitHub needs JSON plus an explicit required-job list;
  only exact success for every expected job returns zero. Reject malformed/missing
  inputs. Do not infer required jobs from the input object, which could omit one.
- Workflow tests parse YAML and verify aggregate dependencies equal every required
  job and the gate CLI receives that list; this avoids testing a disconnected helper.
- CI invokes reusable root scripts; specs use exact OpenSpec 1.2.0 from the lockfile.
  Pin external action SHAs using repository tag evidence; retain existing job layout.
- Legacy CD becomes manual-only, main-only, and gated by an unset rollout variable.
  This is temporary containment, not a production-ready promotion design. The full
  release pipeline is a later change; operators must not enable legacy deployment.
  Failure handlers must positively require a failed deployment and recorded previous
  image; dependency reachability alone does not prevent failure() from bypassing skips.
- Preserve authentication/ownership characterization without freezing public signup,
  stateless logout, fabricated history, or zero-on-provider-error as desired contracts.

## Risks / Trade-offs

- Existing unsafe migration chain -> never run on owner data; a dedicated migration
  preflight/backup design is required before any existing-database release.
- Missing Docker daemon -> establish isolated daemon and record real execution;
  do not label static workflow inspection as E2E or image execution.
- Existing frontend coverage failures -> retain thresholds and repair meaningful
  missing tests in a separate scoped step if runtime correction is insufficient.
- First gate remains insufficient for release security -> disabled rollout and explicit
  remaining gates (ASVS, scanners, images, real E2E, restore) in audit documentation.

## Migration Plan

No schema or data changes. Reverting this commit reverts engineering setup only;
restoring automatic legacy deployment is unsafe and requires separate review.
No remote push or production execution is part of this change.

## Open Questions

Existing production data and applied migrations are unknown. Provider capability
and retention evidence is being researched independently. Original project deletion
is deferred until a final replacement is verified and data/backups are inventoried.
