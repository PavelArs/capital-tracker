## Why

On 2026-10-04 GitHub stopped starting Actions jobs because the account's minutes ran
out and payment was not possible. A CI run costs about 44 billed minutes, 32 of them in
`Release Images and Security`, and every pull request push ran it. The owner made the
repository public and decided: "е2е запускать только на main".

## What Changes

- `Release Images and Security` (critical real acceptance, image scans, candidate
  export) runs only for pushes to main (`if: github.event_name == 'push'`; the push
  trigger is limited to main). Default success scheduling after its six
  prerequisites is unchanged.
- The CI aggregate requires the release job for every event except `pull_request`,
  where it accepts the job being skipped; all other eight jobs stay required.
- Deployment is unchanged: it already requires a successful push run on main with
  successful critical acceptance.

## Capabilities

### Modified Capabilities
- `engineering-gates`: ENG-001 and ENG-004 allow the release job to be skipped on pull
  requests only; new ENG-006 states when the release job runs.

## Impact

`.github/workflows/ci.yml`, engineering gate tests and docs. Pull requests lose
browser acceptance and image scanning before merge; a regression shows up as a red
main run, which blocks deployment until fixed. No application or deploy change.
