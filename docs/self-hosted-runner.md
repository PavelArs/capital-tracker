# Self-hosted CI runner

GitHub's hosted runners can be scarce: on 2026-10-05 jobs waited or were cancelled for
lack of a runner, which held back pull requests and the main release build. Every CI job
can therefore run on a runner the owner hosts; only the deploy stays on GitHub.

## What runs where

| Workflow | Runner when `CI_SELF_HOSTED` is `true` |
| --- | --- |
| Every job of `.github/workflows/ci.yml`: lint, unit tests, builds, specification gates, dependency audit, release image build, six acceptance shards, image scan, acceptance receipt, merged pull request check, browser cache warm-up, CI Status | self-hosted |
| Deploy Manual MVP (`cd.yml`) | GitHub |

The deploy keeps GitHub's runners: it holds the production environment's credentials
and reaches the server, and a self-hosted runner must hold no secrets.

The repository variable `CI_SELF_HOSTED` is the switch. Unset or anything other than
`true`, every job runs on GitHub as before. Turn it off whenever the runner machine is
down, otherwise the jobs wait in the queue for it.

With one runner the jobs of a run execute one after another, so a full pull request run
takes longer than on GitHub's parallel runners.

## Security on a public repository

Anyone can open a pull request against a public repository, and a job runs whatever code
the pull request contains. A self-hosted runner must never execute that code. The layers:

1. **Workflow routing.** The jobs pick the self-hosted runner only for a push, a manual
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
4. **Read-only tokens.** The CI jobs get read-only tokens (`contents: read`, plus
   `packages: read` to pull the pinned base images and `actions: read`/`pull-requests: read`
   for the merged pull request check); the runner holds no deploy credentials or secrets.
5. **A dedicated machine.** Use a separate machine or VM, never the production server. The
   runner user must be in the `docker` group, which is equivalent to root on that machine,
   so the machine must hold nothing else of value.

## Machine requirements

- Linux x86-64 (the images are `linux/amd64`). Ubuntu 24.04 LTS is recommended because
  Playwright installs Chromium's system packages for it.
- At least 4 CPU, 8 GB RAM and 40 GB free disk.
- Docker Engine with the `buildx` and `compose` plugins, plus `git`, `jq`, `zstd`, `curl`,
  `tar` and `python3` (the security tests).
- Chromium's system libraries, installed once as root (see below). Node.js, pnpm, the
  Chromium browser itself and Trivy are downloaded by the jobs.
- Only **one** runner per Docker daemon. Acceptance uses a fixed Compose project name,
  fixed subnets and a fixed local port, so two jobs on one daemon would collide. With one
  runner the jobs simply run one after another.

## Install (once, as root on the runner machine)

```sh
# Docker Engine with the buildx and compose plugins: https://docs.docker.com/engine/install/ubuntu/
apt-get update && apt-get install -y git jq zstd curl tar xz-utils python3

# A dedicated user, allowed to use Docker.
useradd --create-home --shell /bin/bash ci
usermod -aG docker ci

# The only sudo the user gets: the one security test that must run as root
# (Specification and Engineering Gates; ENG-008-C keeps it the only sudo in CI).
cat > /etc/sudoers.d/ci-runner <<'EOF'
ci ALL=(root) NOPASSWD: /usr/bin/python3 -B -m unittest discover -s tests/security -p manual_mvp_dispatch_flow_test.py -k test_application_uid_is_accepted_only_at_delegated_paths
EOF
chmod 0440 /etc/sudoers.d/ci-runner && visudo -cf /etc/sudoers.d/ci-runner

# Chromium's system libraries for the Playwright version in package.json.
curl -fsSL https://nodejs.org/dist/v26.10.0/node-v26.10.0-linux-x64.tar.xz | tar -xJ -C /opt
PATH=/opt/node-v26.10.0-linux-x64/bin:$PATH npx -y playwright@1.63.0 install-deps chromium
```

When `@playwright/test` is upgraded, repeat the last line with the new version.

The sudoers rule runs repository test code as root. That grants nothing the `docker`
group does not already give the same user, which is why the machine must be dedicated.

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
3. Re-run CI on an open pull request or run the CI workflow manually. Every job lists the
   self-hosted runner's name under **Set up job**.

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
