# Self-hosted CI runner

GitHub's hosted runners can be scarce: on 2026-10-05 jobs waited or were cancelled for
lack of a runner, which held back pull requests and the main release build. The three
Docker-heavy CI jobs can therefore run on a runner the owner hosts. Everything else stays
on GitHub's runners.

## What runs where

| Job (`.github/workflows/ci.yml`) | Runner when `CI_SELF_HOSTED` is `true` |
| --- | --- |
| Build Release Images (also on every push to main) | self-hosted |
| Critical acceptance (six shards) | self-hosted |
| Image Security Scan | self-hosted |
| Lint, unit tests, builds, specification gates, dependency audit, acceptance receipt, merged pull request check, CI Status, browser cache warm-up | GitHub |
| Deploy Manual MVP (`cd.yml`) | GitHub |

These three jobs build and load about 700 MB of images, start the Compose stack and run
the browser suite; they are the slowest and the ones a missing runner hurts most. The
light jobs need no Docker, and the specification gates need `sudo`, which the self-hosted
runner does not grant.

The repository variable `CI_SELF_HOSTED` is the switch. Unset or anything other than
`true`, every job runs on GitHub as before. Turn it off whenever the runner machine is
down, otherwise the three jobs wait in the queue for it.

## Security on a public repository

Anyone can open a pull request against a public repository, and a job runs whatever code
the pull request contains. A self-hosted runner must never execute that code. The layers:

1. **Workflow routing.** The three jobs pick the self-hosted runner only for a push, a manual
   dispatch or a pull request whose branch lives in this repository and was not opened by
   Dependabot. A pull request from a fork, or a dependency update, runs on GitHub's
   runners. `ENG-008` in `backend/src/engineering/gates.spec.ts` checks this routing.
2. **Fork approval.** A fork can edit the workflow file inside its own pull request, so
   routing alone is not enough. In **Settings → Actions → General → Approval for running
   fork pull request workflows from contributors**, choose **Require approval for all
   external contributors**. A fork's run then waits for the owner's approval; never approve
   one that changes anything under `.github/`.
3. **No `pull_request_target`.** No workflow runs pull request code with the base
   repository's privileges (`ENG-008-B`).
4. **Read-only tokens.** The routed jobs get `contents: read` (and `packages: read` to pull
   the pinned base images); the runner holds no deploy credentials or secrets.
5. **A dedicated machine.** Use a separate machine or VM, never the production server. The
   runner user must be in the `docker` group, which is equivalent to root on that machine,
   so the machine must hold nothing else of value.

## Machine requirements

- Linux x86-64 (the images are `linux/amd64`). Ubuntu 24.04 LTS is recommended because
  Playwright installs Chromium's system packages for it.
- At least 4 CPU, 8 GB RAM and 40 GB free disk.
- Docker Engine with the `buildx` and `compose` plugins, plus `git`, `jq`, `zstd`, `curl`
  and `tar`.
- Chromium's system libraries, installed once as root (see below). Node.js, pnpm, the
  Chromium browser itself and Trivy are downloaded by the jobs.
- Only **one** runner per Docker daemon. Acceptance uses a fixed Compose project name,
  fixed subnets and a fixed local port, so two jobs on one daemon would collide. With one
  runner the jobs simply run one after another.

## Install (once, as root on the runner machine)

```sh
# Docker Engine with the buildx and compose plugins: https://docs.docker.com/engine/install/ubuntu/
apt-get update && apt-get install -y git jq zstd curl tar xz-utils

# A dedicated user without sudo, allowed to use Docker.
useradd --create-home --shell /bin/bash ci
usermod -aG docker ci

# Chromium's system libraries for the Playwright version in package.json.
curl -fsSL https://nodejs.org/dist/v26.10.0/node-v26.10.0-linux-x64.tar.xz | tar -xJ -C /opt
PATH=/opt/node-v26.10.0-linux-x64/bin:$PATH npx -y playwright@1.63.0 install-deps chromium
```

When `@playwright/test` is upgraded, repeat the last line with the new version.

## Register the runner

1. In GitHub open **Settings → Actions → Runners → New self-hosted runner**, choose
   **Linux** and **x64**. The page shows the download commands and a registration token
   that is valid for one hour; never commit or paste that token anywhere else.
2. As the `ci` user (`sudo -iu ci`), run the page's commands in `~/actions-runner`:
   download, verify the checksum, unpack, then
   `./config.sh --url https://github.com/<owner>/<repository> --token <token> --unattended`.
   The default labels `self-hosted`, `Linux` and `X64` are the ones the workflow asks for.
3. Back as root, install and start the service from that folder:
   `./svc.sh install ci && ./svc.sh start`.
4. The runner shows as **Idle** under **Settings → Actions → Runners**.

## Turn it on and check it

1. Set the fork approval policy from the security section above.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   name `CI_SELF_HOSTED`, value `true`.
3. Re-run CI on an open pull request or run the CI workflow manually. The three jobs list
   the self-hosted runner's name under **Set up job**; the others list a GitHub runner.

To go back to GitHub's runners, set the variable to `false` or delete it.

## Housekeeping

`actions/checkout` cleans the workspace and acceptance always removes its Compose stack,
but old images and build cache accumulate. A weekly root cron entry on the runner machine
keeps the disk in check:

```sh
docker image prune --force && docker builder prune --force --filter until=168h
```

To remove the runner: `./svc.sh stop && ./svc.sh uninstall` as root, then
`./config.sh remove --token <token>` as `ci` with a removal token from the runners page.
