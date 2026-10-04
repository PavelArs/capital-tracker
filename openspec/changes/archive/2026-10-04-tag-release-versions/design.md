## Decisions

**Version name.** `v<YYYY.MM.DD>-<7-character SHA>` from the commit date in UTC. It is
deterministic per commit, sorts by date, and names the commit, so no counter or
state is needed and re-running a release for the same commit yields the same name.

**Image tags before deployment.** The promotion step already pushes the tested image
under the commit SHA. It now also tags the same local image ID with the version and
pushes it to the same repository, so both tags resolve to the same manifest. The
receipt still carries only digests from the SHA tag; tags never decide what runs.

**Git tag after success, in its own job.** Writing a Git ref needs `contents: write`.
Granting it to the deploy job, which holds the dispatcher SSH key, would widen what a
compromised step there could do. A second job `tag` needs `deploy`, runs only when
the deploy job reports the version after a successful `deploy` or `release` request,
has only `contents: write` and no environment or secret. It creates the ref through
the API and accepts an existing tag only when it already points at the same commit.

## Risks

- A later promotion of the same commit from another CI run would move the image
  version tag to that run's images. The Git tag and receipt digests stay correct.
- The Git tag says what was deployed last through this workflow; manual changes on
  the host are not reflected.
