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

Each runner executes one job at a time; with two runners a run proceeds two jobs at a
time, so a full pull request run takes longer than on GitHub's parallel runners.

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
5. **An isolated runner.** Never run a runner directly on the production host. Use a
   separate machine, a VM, or an unprivileged LXD container (below). The runner user must be
   in the `docker` group, which is equivalent to root wherever that Docker daemon runs, so
   that machine, VM or container must hold nothing else of value. A container shares the
   host's kernel, so a VM or separate machine isolates more strongly than a container.

## Machine requirements

- Linux x86-64 (the images are `linux/amd64`). Ubuntu 24.04 LTS is recommended because
  Playwright installs Chromium's system packages for it.
- At least 4 CPU, 8 GB RAM and 20 GB free disk per runner (an estimate, not a measurement).
- Docker Engine with the `buildx` and `compose` plugins, plus `git`, `jq`, `zstd`, `curl`,
  `tar` and `python3` (the security tests).
- Chromium's system libraries, installed once as root by the setup script. Node.js, pnpm,
  the Chromium browser itself and Trivy are downloaded by the jobs.
- Only **one** runner per Docker daemon. Acceptance uses a fixed Compose project name,
  fixed subnets and the fixed local port 8443 (also written into the tests), so two jobs on
  one daemon would collide. Several runners on one server therefore each get their own
  LXD container (or VM) with its own Docker daemon and network namespace.

## Two runners on one server (LXD containers)

On the host, as root (Ubuntu with a kernel of 5.15 or newer). Unprivileged LXD containers
also keep the CI jobs away from the host: `docker` group membership inside a container is
root only inside that container.

```sh
snap install lxd
lxd init --auto
for name in ghrunner-1 ghrunner-2; do
  lxc launch ubuntu:24.04 "$name" \
    -c security.nesting=true \
    -c security.syscalls.intercept.mknod=true \
    -c security.syscalls.intercept.setxattr=true \
    -c limits.cpu=4 -c limits.memory=8GiB
done
```

Then, for each container, copy `scripts/self-hosted-runner-setup.sh` from this repository
into it and run it with the runner's name:

```sh
lxc file push self-hosted-runner-setup.sh ghrunner-1/root/
lxc exec ghrunner-1 -- bash /root/self-hosted-runner-setup.sh ghrunner-1
```

The script asks for a registration token from **Settings → Actions → Runners → New
self-hosted runner** (valid for one hour and usable for both runners; never commit or
paste it anywhere else). It installs Docker with the `buildx` and `compose` plugins,
`git`, `jq`, `zstd` and `python3`, creates the `ci` user in the `docker` group with one
sudoers rule (below), installs Chromium's system libraries for the pinned Playwright
version, downloads the latest runner and checks it against the SHA-256 in its release
notes, registers it under the given name with the default labels `self-hosted`, `Linux`
and `X64`, starts it as a service and adds a weekly Docker cleanup. Both runners then
show as **Idle** under **Settings → Actions → Runners**.

The default `dir` storage pool does not cap the containers' disk use; watch the host's
free space, since images, build cache and the browser take several gigabytes per runner.

The sudoers rule allows exactly the one security test that must run as root
(Specification and Engineering Gates; `ENG-008-C` keeps it the only `sudo` in CI):

```
ci ALL=(root) NOPASSWD: /usr/bin/python3 -B -m unittest discover -s tests/security -p manual_mvp_dispatch_flow_test.py -k test_application_uid_is_accepted_only_at_delegated_paths
```

It runs repository test code as root inside the container, which grants nothing the
`docker` group does not already give the same user there.

When `@playwright/test` is upgraded, update `playwright_version` in the script and run
`npx -y playwright@<version> install-deps chromium` as root in each container.

## Turn it on and check it

1. Set the fork approval policy from the security section above.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   name `CI_SELF_HOSTED`, value `true`.
3. Re-run CI on an open pull request or run the CI workflow manually. Every job lists the
   self-hosted runner's name under **Set up job**.

To go back to GitHub's runners, set the variable to `false` or delete it.

## Housekeeping

`actions/checkout` cleans the workspace and acceptance always removes its Compose stack,
but old images and build cache accumulate. The setup script installs a weekly cron job in
each container that runs:

```sh
docker image prune --force && docker builder prune --force --filter until=168h
```

To remove a runner: in its container, `./svc.sh stop && ./svc.sh uninstall` as root in
`/home/ci/actions-runner`, then `./config.sh remove --token <token>` as `ci` with a removal
token from the runners page; `lxc delete --force <name>` removes the container itself.
