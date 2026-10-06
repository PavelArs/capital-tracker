#!/usr/bin/env bash
# Sets up one self-hosted GitHub Actions runner for this repository inside its own
# dedicated LXD container or VM (docs/self-hosted-runner.md). Run as root there:
#   bash self-hosted-runner-setup.sh ghrunner-1 ci
#   bash self-hosted-runner-setup.sh ghrunner-deploy deploy
# Role ci takes every CI job; role deploy takes only the deploy, never a CI job.
# It asks for the registration token (Settings -> Actions -> Runners -> New
# self-hosted runner) without echoing it; the token is never written to disk.
set -euo pipefail

name=${1:?usage: self-hosted-runner-setup.sh <runner-name> <ci|deploy>}
role=${2:?usage: self-hosted-runner-setup.sh <runner-name> <ci|deploy>}
[[ $role == ci || $role == deploy ]] || { echo 'role must be ci or deploy' >&2; exit 1; }
repo_url=https://github.com/PavelArs/capital-tracker
node_version=26.10.0
playwright_version=1.63.0

[[ $(id -u) -eq 0 ]] || { echo 'run as root' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'needs x86-64' >&2; exit 1; }

# 0. IPv4 only. Where the container gets an IPv6 address but no working IPv6 route, Node's
#    dual-stack connect waits on IPv6 for every download (Playwright gives up after five
#    seconds), while curl falls back to IPv4 at once.
printf 'net.ipv6.conf.all.disable_ipv6 = 1\nnet.ipv6.conf.default.disable_ipv6 = 1\n' \
  > /etc/sysctl.d/90-no-ipv6.conf
sysctl -p /etc/sysctl.d/90-no-ipv6.conf

# 1. Packages and Docker Engine (buildx and compose plugins included).
apt-get update
# libatomic1: Node.js 26 (the setup script and every job's setup-node) links against it.
apt-get install -y ca-certificates git jq zstd curl tar xz-utils python3 libatomic1
# The deploy downloads the candidate and tags releases with gh, and dispatches over SSH.
# gh comes from GitHub's own apt repository, as on GitHub's runners, so its version
# does not depend on the Ubuntu release.
if [[ $role == deploy ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL -o /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg
  chmod 0644 /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update
  apt-get install -y gh openssh-client
fi
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version
docker buildx version

# 2. The runner user with Docker access. A CI runner also gets sudo for exactly one
#    test command; the deploy runner gets no sudo at all.
id ci >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ci
usermod -aG docker ci
if [[ $role == ci ]]; then
  cat > /etc/sudoers.d/ci-runner <<'EOF'
ci ALL=(root) NOPASSWD: /usr/bin/python3 -B -m unittest discover -s tests/security -p manual_mvp_dispatch_flow_test.py -k test_application_uid_is_accepted_only_at_delegated_paths
EOF
  chmod 0440 /etc/sudoers.d/ci-runner
  visudo -cf /etc/sudoers.d/ci-runner
fi

# 3. Chromium's system libraries for the Playwright version the repository pins (CI only).
if [[ $role == ci ]]; then
  if [[ ! -x /opt/node-v$node_version-linux-x64/bin/node ]]; then
    curl -fsSL "https://nodejs.org/dist/v$node_version/node-v$node_version-linux-x64.tar.xz" | tar -xJ -C /opt
  fi
  PATH=/opt/node-v$node_version-linux-x64/bin:$PATH npx -y "playwright@$playwright_version" install-deps chromium
fi

# 4. Runner download, checked against the SHA-256 published in its release notes.
release=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest)
version=$(jq -r .tag_name <<<"$release" | sed 's/^v//')
expected=$(jq -r .body <<<"$release" | sed -n 's/.*BEGIN SHA linux-x64 -->\([0-9a-f]\{64\}\)<!-- END SHA linux-x64.*/\1/p')
[[ -n $expected ]] || { echo 'runner checksum not found in the release notes' >&2; exit 1; }
archive=actions-runner-linux-x64-$version.tar.gz
runner_dir=/home/ci/actions-runner
sudo -u ci mkdir -p "$runner_dir"
cd "$runner_dir"
sudo -u ci curl -fsSL -o "$archive" "https://github.com/actions/runner/releases/download/v$version/$archive"
echo "$expected  $archive" | sha256sum -c -
sudo -u ci tar xzf "$archive"
rm "$archive"

# 5. Registration as the ci user, then a system service.
read -rsp "Registration token for $name: " token
echo
# The role label keeps CI jobs (label ci) and the deploy (label deploy) on separate runners.
sudo -u ci ./config.sh --url "$repo_url" --token "$token" --name "$name" --labels "$role" --unattended --replace
unset token
./svc.sh install ci
./svc.sh start
./svc.sh status

# 6. Weekly disk cleanup of old images and build cache.
cat > /etc/cron.weekly/docker-ci-prune <<'EOF'
#!/bin/sh
docker image prune --force && docker builder prune --force --filter until=168h
EOF
chmod 0755 /etc/cron.weekly/docker-ci-prune

echo "$name is installed; check Settings -> Actions -> Runners for Idle."
