# Pull release agent

Owner decision (2026-11-19): production releases move from the SSH release dispatcher
(`scripts/manual-mvp-dispatcher.py`, `docs/manual-mvp-release.md`) to an agent on the
server that pulls owner-approved releases from GitHub. The approval stays where it is:
the required reviewer on the `production` environment presses "Approve and deploy" in
Actions. The release itself stays the same runner, `scripts/manual-mvp-release.sh`:
encrypted backup, isolated restore check, migrations, health and privacy checks, and the
rollback to the previous pair.

The change lands in small steps, and production keeps deploying through the dispatcher
until the owner switches:

1. **Agent in observe mode (#452).** The owner installs the agent next to the dispatcher.
   It checks every approved release and logs what it would release; it releases nothing.
2. **Deploy job waits for the server (in place, off until the owner switches).** With the
   repository variable `DEPLOY_PULL=true`, an approved `release` of an `existing`
   installation in `cd.yml` uploads its promoted receipt as the `server-release-request`
   artifact instead of calling the dispatcher, then waits for the agent's commit status
   (see "Switching releases to the agent"). Every other mode (`inventory`, `preflight`,
   `deploy`, `promote`) and every other installation still uses the dispatcher.
   - Only the job in the `production` environment uploads the request. The approvals API
     names no attempt, so the approval is bound to an attempt only because that job
     cannot start without one.
   - The job waits up to 150 minutes, longer than one agent pass can take (the unit stops
     it after two hours, plus 15 minutes for the rollback).
   - It accepts only a `production-release` status that names its own run attempt and was
     posted with the owner's token, so an earlier attempt's result on the same commit or a
     status written by a workflow never counts.
3. **Retire the dispatcher** after two releases through the agent: remove its workflow
   steps, scripts and tests, then the owner removes the `capital-release` account, its
   sudo rule and the `DEPLOY_DISPATCH_SSH_KEY` secret.

## What the agent trusts

Nothing connects to the server: a systemd timer runs one pass of the agent every minute,
and the agent asks the GitHub API. It releases a run only when all of these hold:

- the run is `.github/workflows/cd.yml` of `PavelArs/capital-tracker` on `main`, from a
  `workflow_run` or `workflow_dispatch` event, it is in progress, and its commit is the
  current head of `main`;
- `PavelArs` approved it in the `production` environment;
- the current attempt of the run uploaded the release request after it started (older
  attempts' artifacts are ignored);
- the request holds exactly one receipt (`<commit>-<CI run>.json`, the format of
  `scripts/manual-mvp-receipt.py`) for that commit with pinned GHCR image digests, an
  `existing` installation and the six server-file hashes;
- the CI run it names is a successful `push` run of `ci.yml` on `main` for that commit;
- the agent's own clone, fetched at that commit, has those six files as regular files
  with exactly those hashes.

Each attempt of a deploy run is handled once: a marker under
`/var/lib/capital-tracker-agent/runs/` records it before the runner starts, so a re-run
needs a new approval. A run that is still waiting for approval or comes from another
workflow, branch or repository is ignored. A waiting run whose commit is no longer the head
of `main` gets a `failure` status on its own commit at once, so its job ends instead of
waiting.

After waiting for the server lock, and again between the runner's preflight and deploy,
the agent re-reads the run and `main`: if the job stopped waiting (cancelled, timed out,
re-run) or `main` moved on, it stops before changing anything. If GitHub cannot be reached
for that check, nothing is released. It probes the lock once more after that check, so
a daily backup that started meanwhile makes it wait. That narrows the window, it does not
close it: a backup starting in the moment between that probe and the runner's own lock
still fails the release, and the runner rolls back as usual.

The consequence the owner accepted: the release scripts that run as root come from the
approved commit, not from a copy installed by hand. Whoever controls the owner's GitHub
account and can approve a deployment can therefore run code as root on the server, not
only change the application. Keep two-factor authentication on that account and the
required reviewer on `production`.

Before the runner starts, the agent repeats most of the dispatcher's local checks: the runtime
directory `/var/snap/docker/common/capital-tracker` is root-owned without symlinks or
group/world-writable entries (`.mfa-key` and `operator/` may belong to uid 1000),
`.env.release` and `.backup-key` are root-owned regular files, and the dedicated registry
configuration `/etc/capital-tracker/docker-config` has no plugins of its own. The runner
gets a fixed environment (`DOCKER_CONFIG`, `RELEASE_*`, a clean `PATH`) and the compose
file of the approved commit. If the daily backup holds the server lock, the agent waits
for it instead of failing, with one 40-minute budget counted from its first wait: deploy
starts within about 40 minutes of that (preflight included) or the release is refused.
Two dispatcher checks are not repeated: the Snap Docker plugin tree (read-only Snap files
that only snapd changes) and the content of the PostgreSQL pins (only read for a
`resume-fresh` installation, which the agent refuses).

In `active` mode the agent reports on the commit as the status `production-release`:
`pending` when it starts, then `success` or `failure` with the runner's last line and a
link to the deploy run attempt (`…/actions/runs/<id>/attempts/<n>`), which is how the
waiting job recognises its own result. The full output goes to the journal on the server
(`journalctl -u capital-tracker-deploy-agent`). An outcome GitHub could not take is posted
again by later passes for a day, unless a later attempt of the same commit has an outcome
of its own (all attempts share the status, so the older one would replace it); a release
left open by a stopped pass (for example a reboot) is reported as `failure` and never
started again.

When the unit stops during a release (shutdown, `systemctl stop`, or its two-hour start
timeout), systemd sends SIGTERM to the agent and the runner together. The agent keeps
reading the runner's output until the runner has finished its rollback to the previous
pair, starts nothing new, and records the release as `failure`. The unit is ordered after
Docker, so at shutdown Docker is still running for that rollback; systemd allows it 15
minutes. The agent never starts Docker itself.

Observe mode reads the same runs, including ones that finished before a pass saw them
(the dispatcher's release often ends within a minute of its receipt upload), never posts
a status, never takes the server lock and never starts the runner.

## Files on the server

| Path | Owner, mode | Content |
| --- | --- | --- |
| `/usr/local/libexec/capital-tracker/deploy-agent` | root, 0755 | `scripts/deploy-agent.py` |
| `/etc/systemd/system/capital-tracker-deploy-agent.{service,timer}` | root, 0644 | `deploy/agent/` |
| `/etc/capital-tracker/deploy-agent.json` | root, 0644 | `{"mode": "observe"}` or `{"mode": "active"}` |
| `/etc/capital-tracker/deploy-agent.token` | root, 0600 | the GitHub token |
| `/var/lib/capital-tracker-agent/` | root, 0700 | the agent's clone (`repo/`), run markers, lock |

The installer never touches the dispatcher, its SSH account, sudo rule, receipts, the
runtime directory or the containers.

## Owner setup (once, after this change is on `main`)

1. Create a fine-grained personal access token in GitHub (Settings → Developer settings →
   Personal access tokens → Fine-grained tokens): resource owner `PavelArs`, repository
   access "Only select repositories" with `capital-tracker`, repository permissions
   **Actions: Read-only** and **Commit statuses: Read and write** (GitHub adds Metadata:
   Read-only). Artifact downloads need it even on a public repository. Give it an
   expiry and renew it with `token` below.
2. As root on the server, from a clean checkout of `main`:

   ```sh
   cd /root/capital-tracker && git fetch origin && git checkout --detach origin/main
   bash scripts/deploy-agent-install.sh install
   ```

   It asks for the token (input hidden), installs the agent in observe mode, makes every
   read a release makes (the head of `main`, the newest deploy run with its approvals and
   artifacts, downloading its receipt when there is one, and commit statuses) and enables
   the timer. Writing the status is first tried by the first active release.
3. Approve the next release as usual. The dispatcher deploys it; the journal
   (`journalctl -u capital-tracker-deploy-agent`) should show
   `Observe mode: would release commit …` with the same digests as the deploy run's receipt.

## Switching releases to the agent (step 2)

Do it in this order, so a release never waits for an agent that does not release:

1. As root on the server, from a clean checkout of the `main` commit that has this step,
   refresh the agent (this step changed it) and let it release:

   ```sh
   cd /root/capital-tracker && git fetch origin && git checkout --detach origin/main
   bash scripts/deploy-agent-install.sh update
   bash scripts/deploy-agent-install.sh active
   ```

   Until the variable below is set, an active agent finds no request and changes nothing;
   the dispatcher keeps releasing.
2. In GitHub: Settings → Secrets and variables → Actions → Variables → New repository
   variable `DEPLOY_PULL` with the value `true`.
3. Approve the next release as usual. The deploy job's step "Wait for the server agent's
   release" shows the agent's result, and the journal on the server shows the runner's
   output.

To go back: delete the variable (or set it to anything but `true`), then run
`bash scripts/deploy-agent-install.sh observe`. The dispatcher is untouched until step 3.

## Other commands

Each runs as root from a clean checkout:

```sh
bash scripts/deploy-agent-install.sh token     # replace the token (from standard input)
bash scripts/deploy-agent-install.sh active    # release approved runs (step 2 only)
bash scripts/deploy-agent-install.sh observe   # back to logging only
bash scripts/deploy-agent-install.sh update    # a commit changed scripts/deploy-agent.py or deploy/agent/
systemctl disable --now capital-tracker-deploy-agent.timer   # stop the agent
```

The agent does not update itself. When a release changes `scripts/deploy-agent.py` the
journal says so; run `update` from that commit.

## Limits

- The agent fetches the repository without credentials, so it relies on the repository
  being public. A private repository needs the token to fetch as well (Contents: Read-only).
- Only `existing` installations are released. A fresh installation or an interrupted first
  activation still follows `docs/manual-mvp-release.md`.
- The agent starts a release within about a minute of the approval, not at once.

Verification: `pnpm test:security` runs `tests/security/deploy_agent_test.py` (agent,
against recorded GitHub API shapes with real git, files, archive and lock) and
`tests/security/deploy_agent_installer_test.py` (installer, in a disposable server tree).
The application-uid ownership case needs root; CI runs it with `sudo` in the
Specification and Engineering Gates job.
