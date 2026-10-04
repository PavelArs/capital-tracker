## Why

`Release Images and Security` takes about 32 minutes (green run 37220925062): 8 minutes
of serial PostgreSQL/CLI probes and 18 minutes of 21 serial critical browser cases, all
in one job on one stack. The repository is public, so parallel job minutes cost nothing;
wall time is what blocks a release. The owner also wants to run full release acceptance
on a branch before merge without opening a deployment path for it.

## What Changes

- A new `Build Release Images` job builds the backend and frontend acceptance images
  once (the same Compose build and tags), pulls and verifies the pinned PostgreSQL and
  Redis images exactly as before, records the four image IDs in a schema-v3 manifest and
  uploads `docker save` of the four images.
- A matrix job `Critical acceptance (<shard>)` runs five isolated shards in parallel,
  each on its own runner and stack: `probes-1` and `probes-2` split the 31 canonical
  real checks (restore readiness, provider proxy, 28 database/CLI probes and client
  source startup) by measured duration; `browser-1..3` split the 21 manifest cases by
  index modulo 3. Each shard loads the images, refuses any ID that differs from the
  manifest, never builds, keeps the Nginx preservation and Compose cleanup, and uploads
  a receipt naming the commit, run, shard, tested image IDs and either its exact ordered
  checks or its Playwright results.
- `Release Images and Security` (same job id and name) needs the build and every shard,
  loads the same images, merges the receipts into the unchanged critical receipt only
  when every shard tested the manifest images, the probe lists cover the canonical list
  exactly once and the browser results cover the manifest exactly once with every case
  passed, then verifies it and runs the unchanged scans, security gate and candidate
  export.
- `scripts/acceptance.mjs` gains `images --manifest <path>` and
  `critical --shard <name> --images <manifest>`; `run`, `critical` and `down` keep their
  behaviour. The step plan and probe commands move to `scripts/acceptance-shards.cjs`.
- CD provenance additionally requires `Build Release Images` and every
  `Critical acceptance (<shard>)` job with a successful `Run critical real release
  acceptance` step, and the final job's merge and receipt verification steps.
- CI gains a `workflow_dispatch` trigger. All three release jobs run when the event is
  not `pull_request`; the aggregate requires all three for every event except
  `pull_request`. CD still accepts only push runs on main. The concurrency group now
  includes the event, so a manual run never cancels the deployable push run of main.

## Capabilities

### Modified Capabilities
- `engineering-gates`: ENG-001, ENG-004, ENG-005 and ENG-006 change for the release job
  graph; new ENG-007 states the build-once, sharded and merged acceptance.

## Impact

`.github/workflows/ci.yml`, `.github/workflows/cd.yml`, `scripts/acceptance.mjs`, new
`scripts/acceptance-shards.cjs`, `scripts/critical-release-profile.cjs` (new
`partition`, `project`, `merge`; `receipt` and `verify` unchanged), engineering tests,
testing documentation and continuity. Application code, Dockerfiles,
`tests/e2e/compose.yml`, test cases, production Compose and `frontend/nginx.conf` are
unchanged. The release part dropped from about 32 to about 10.5 minutes (whole CI run
11 min 51 s) in hosted run 37227886949.
