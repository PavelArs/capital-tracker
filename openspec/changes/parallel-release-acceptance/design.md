## Context

The serial `critical` runner builds two images, pulls two pinned ones, runs 31 real
checks and 21 browser cases on one Compose stack and then scans and exports the same
images. Every probe creates its own database and resets the provider fixture it uses;
every critical browser case restarts the backend pair and enrolls a fresh synthetic owner
in its auto fixture. Only `client-source-startup` needs the migrated and seeded main
database. That independence makes isolated parallel stacks equivalent to the serial
order for each subset.

## Decisions

- **Build once, prove identity everywhere.** The build job writes the same schema-v3
  manifest the candidate export writes and validates it with the existing
  `validateRelease`/`validateLoadedImages`. Each shard and the final job check the tar
  checksum, `docker load` it and run the same validation against `$GITHUB_SHA` and
  `$GITHUB_RUN_ID` before anything else. At its end a shard re-validates the four tags and
  the image of each running PostgreSQL and Redis container (browser shards also the
  backend pair, both clients and the frontend) and records those IDs; the
  merge rejects any shard whose IDs differ from the manifest. `docker save`/`load` keeps
  image IDs (the existing CD promotion already depends on that).
- **One plan.** `acceptance-shards.cjs` holds the canonical check list with a fixed shard
  per check and a pure `plan(command, shard)` that both the runner and the tests use. The
  serial `run` and `critical` plans are characterised exactly; a shard plan keeps their
  relative order for its subset, starts with `verify-prebuilt-images`, ends with
  `verify-tested-images` and contains no build step. The shard holding
  `client-source-startup` migrates and seeds first, as the serial runner did.
- **Probe split by measured time, browser split by manifest index.** Probes: about 270 s
  per shard by run 37220925062 timings; a hand assignment is acceptable because every
  check lives in one list with exactly one shard, and the merge requires each shard's
  exact ordered list and their union to equal the list. Browser cases: index modulo 3,
  so a new manifest case is assigned automatically.
- **Merge reuses the receipt oracle.** `merge` requires each shard to have executed
  exactly its own subset (the unchanged `receipt()` on the subset), the subsets to cover
  the manifest once, and then calls `receipt()` on the combined result. `receipt()` and
  `verify()` are not changed; the final file has the same schema, so CD verification is
  unchanged.
- **Step names stay truthful.** Each shard's acceptance step is named `Run critical real
  release acceptance`, because it runs real acceptance. The final job's step that used to
  run acceptance now only merges, so it is renamed `Merge verified critical acceptance
  shards` (step id unchanged, so the export conditions are unchanged). CD requires the
  shard step in every shard job and the merge and verification steps in the final job.
- **Manual dispatch is not a deployment path.** `workflow_dispatch` runs the full
  release jobs for any branch, but CD keeps requiring a successful push run on main.
  ENG-006 keeps its header (the requirement identity used by the unarchived
  `e2e-on-main-only` change); its text now covers manual dispatch.
- **Delta bases.** ENG-001, ENG-004 and ENG-006 are copied from the unarchived
  `e2e-on-main-only` change and ENG-005 from the unarchived
  `run-critical-release-acceptance` change, because the canonical spec still holds older
  texts (for example the paused ENG-005). Archive those two changes first.

## Risks / Trade-offs

- The image artifact is about 1 GB uncompressed and is downloaded six times; upload,
  download and `docker load` add about one to two minutes per job. Retention is one day.
- Redis is referenced by digest in the test Compose file; a loaded image has no repo
  digest, so Compose may pull the same digest again. Its container image ID is still
  checked against the manifest.
- Six concurrent runners per release run; on a busy account they may queue. Hidden
  coupling between probes or cases that the serial order masked would fail a shard
  (fail-closed), not pass silently.
- CD couples to the rendered matrix job names `Critical acceptance (<shard>)` and to
  `Build Release Images`; the tests pin both sides to the same shard list.
