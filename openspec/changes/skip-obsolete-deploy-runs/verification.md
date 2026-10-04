# Verification: skip-obsolete-deploy-runs

## Observed cause (2026-10-04)

- Main CI 37229245822 (#44, `2d58a28`, old serial workflow) and main CI 37230006261
  (#39, `0b1c1ed`) both finished green at 20:04Z. #46 had added the event name to the
  CI concurrency group, so the #44 run was not cancelled by the later pushes.
- Each completion started a deploy run with `github.sha` = main head `0b1c1ed`: run
  37230724661 (approved, deploying) and run 37230730343 (pending behind the
  `deploy-production` concurrency group). The second one's CI commit `2d58a28` is not
  the head, so provenance (`.head_sha==$sha`) would refuse it after approval.

## RED

`npx jest src/engineering/release-approval.spec.ts src/engineering/gates.spec.ts`
after the test change and before the workflow change: 3 failed, 232 passed
(RAP-001-A and ENG-002-A exact expressions, RAP-001-D).

## GREEN

- `npx jest src/engineering --runInBand`: 391 passed.
- `pnpm test:engineering`: 245 passed plus 23 Node tests.
- Strict OpenSpec validation: 55/55. Backend lint: 77 existing warnings, no errors.

## Not run

- The real workflow_run evaluation on GitHub: only the next main CI after merge shows
  one deploy run (task 3.3).
