# Self-hosted CI runner

A short owner's guide in Russian (add, reinstall or remove a runner) is in
[self-hosted-runner.ru.md](self-hosted-runner.ru.md).

GitHub's hosted runners can be scarce: on 2026-10-05 jobs waited or were cancelled for
lack of a runner, which held back pull requests and the main release build. Every CI job
can therefore run on runners the owner hosts, and the deploy on a separate runner of its own.

## What runs where

| Workflow | Switch (repository variable) | Runner labels when the switch is `true` |
| --- | --- | --- |
| Every job of `.github/workflows/ci.yml`: lint, unit tests, builds, specification gates, dependency audit, release image build, six acceptance shards, image scan, acceptance receipt, merged pull request check, browser cache warm-up, CI Status | `CI_SELF_HOSTED` | `self-hosted, linux, x64, ci` |
| Deploy Manual MVP (`cd.yml`): deploy and tag | `DEPLOY_SELF_HOSTED` | `self-hosted, linux, x64, deploy` |

Unset or anything other than `true`, a workflow runs on GitHub as before. Turn a switch
off whenever its runners are down, otherwise the jobs wait in the queue for them.

The deploy holds the production environment's dispatcher key and publishes images, so it
runs only on its own runner (label `deploy`). CI jobs run code from branches and
dependencies and a runner keeps files between jobs; since CI runners carry the label `ci`
and the deploy runner does not, a CI job can never run where the key is written.
`ENG-008-D` checks both label sets. The deploy still waits for the approval of the
GitHub `production` environment. The release images themselves are built by a CI job, so
the CI runners must be trusted as much as GitHub's builders were.

Each runner executes one job at a time; with two CI runners a run proceeds two jobs at a
time, so a full pull request run takes longer than on GitHub's parallel runners.

## Security

While the repository is public, anyone can open a pull request against it, and a job runs
whatever code the pull request contains. A self-hosted runner must never execute that
code. The layers below hold whether the repository is public or private:

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
- Docker Engine with the `buildx` and `compose` plugins, plus `git`, `jq`, `zstd`, `curl`, `libatomic1`,
  `tar` and `python3` (the security tests).
- Chromium's system libraries, installed once as root by the setup script. Node.js, pnpm,
  the Chromium browser itself and Trivy are downloaded by the jobs.
- Only **one** runner per Docker daemon. Acceptance uses a fixed Compose project name,
  fixed subnets and the fixed local port 8443 (also written into the tests), so two jobs on
  one daemon would collide. Several runners on one server therefore each get their own
  LXD container (or VM) with its own Docker daemon and network namespace.

## CI and deploy runners on one server (LXD containers)

On the host, as root (Ubuntu with a kernel of 5.15 or newer). Unprivileged LXD containers
also keep the CI jobs away from the host: `docker` group membership inside a container is
root only inside that container.

Put the containers on a large data disk, never on the system disk of a host that also runs
production: the runners' Docker images, build cache and browser fill tens of gigabytes, and
a full system disk stops production too. The example uses a `dir` pool on a RAID mount.

```sh
snap install lxd
lxd init --auto
lxc storage create raid dir source=/mnt/raid1/lxd   # a directory on the large disk
for name in ghrunner-1 ghrunner-2 ghrunner-deploy; do
  lxc launch ubuntu:24.04 "$name" --storage raid \
    -c security.nesting=true \
    -c security.syscalls.intercept.mknod=true \
    -c security.syscalls.intercept.setxattr=true \
    -c limits.cpu=4 -c limits.memory=8GiB
done
```

`lxc list` must show an IPv4 address for each container. If the host runs `ufw`, it drops
DHCP on the LXD bridge and the containers get none. Allow only DHCP, DNS to the host and
forwarding out through the external interface, so the containers reach neither the host's
other ports nor its Docker networks:

```sh
ufw allow in on lxdbr0 to any port 67 proto udp
ufw allow in on lxdbr0 to any port 53
ufw route allow in on lxdbr0 out on "$(ip route show default | awk '{print $5; exit}')"
```

### Shared image store

The repository is private, and its artifact storage quota (about 500 MB on the free plan)
cannot hold the image archives: about 220 MB per pull request run and as much for each
release candidate. On a self-hosted runner, Build Release Images therefore moves the archive
to `/srv/ci-images/<run id>/` and uploads only the manifest and the archive's checksum. The
shards, the image scan and the deploy link the stored archive and check it against the
artifact's checksum before loading it (`ENG-008-E`), so a changed archive is refused. On
GitHub's runners nothing changes. Turn both switches on or off together: a candidate built
on the CI runners can only be deployed by the deploy runner.

The store is a host directory, preferably on a large disk, mounted into every runner
container: read-write for the CI runners, read-only for the deploy runner. A daily cron job
removes runs older than three days, roughly 8-15 GB at a busy pace (an estimate).

```sh
store=/srv/ci-images   # any directory on the large disk
install -d -m 1777 "$store"
for name in ghrunner-1 ghrunner-2; do
  lxc config device add "$name" ci-images disk source="$store" path=/srv/ci-images
done
lxc config device add ghrunner-deploy ci-images disk source="$store" path=/srv/ci-images readonly=true
printf '#!/bin/sh\nfind %s -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} +\n' "$store" \
  > /etc/cron.daily/ci-images-prune
chmod 0755 /etc/cron.daily/ci-images-prune
```

Then, for each container, copy `scripts/self-hosted-runner-setup.sh` from this repository
into it and run it with the runner's name and role (`ci` or `deploy`):

```sh
lxc file push self-hosted-runner-setup.sh ghrunner-1/root/
lxc exec ghrunner-1 -- bash /root/self-hosted-runner-setup.sh ghrunner-1 ci
lxc file push self-hosted-runner-setup.sh ghrunner-deploy/root/
lxc exec ghrunner-deploy -- bash /root/self-hosted-runner-setup.sh ghrunner-deploy deploy
```

The script asks for a registration token from **Settings → Actions → Runners → New
self-hosted runner** (valid for one hour and usable for both runners; never commit or
paste it anywhere else). It installs Docker with the `buildx` and `compose` plugins,
`git`, `jq`, `zstd`, `python3` and `libatomic1` (Node.js 26 needs it) (plus the SSH client and `gh` from GitHub's apt repository for the deploy role),
creates the `ci` user in the `docker` group, gives a CI runner one sudoers rule (below)
and Chromium's system libraries for the pinned Playwright version, downloads the latest
runner and checks it against the SHA-256 in its release notes, registers it under the
given name with the default labels `self-hosted`, `Linux` and `X64` plus its role label,
starts it as a service and adds a weekly Docker cleanup. The runners then show as
**Idle** under **Settings → Actions → Runners**.

A `dir` storage pool does not cap the containers' disk use; watch the data disk's free
space, since images, build cache and the browser take several gigabytes per runner.
Containers already on the system disk move with `lxc stop <name>`, then
`lxc move <name> --storage raid` and `lxc start <name>`.

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
   name `CI_SELF_HOSTED`, value `true`; and, for the deploy runner, `DEPLOY_SELF_HOSTED`,
   value `true`.
3. Re-run CI on an open pull request or run the CI workflow manually. Every job lists a CI
   runner's name under **Set up job**; the next deploy lists the deploy runner.

To go back to GitHub's runners, set a variable to `false` or delete it.

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
