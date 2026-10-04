## Why

On 2026-10-04 two `Deploy Manual MVP` runs appeared after one green main pipeline and
the second waited for the first. Each completed `CI` run on main starts a deploy run,
and a workflow_run deploy always checks out the current main head. A green CI run of
an older commit (here the #44 run, which a concurrency-key change in #46 kept from
being cancelled) therefore produced a second run that asked the owner for approval and
would only have been refused by provenance afterwards (`head_sha` differs from main).

## What Changes

- The automatic branch of the deploy job condition also requires
  `github.event.workflow_run.head_sha == github.sha`, so an obsolete CI completion
  skips the job before the `production` approval. Provenance checks are unchanged.
- RAP-001 gains scenario RAP-001-D; engineering tests pin the expression.

## Impact

`.github/workflows/cd.yml`, `backend/src/engineering/release-approval.spec.ts`,
`backend/src/engineering/gates.spec.ts`, release documentation and continuity. No
server file, application or CI change; manual dispatch is unchanged.
