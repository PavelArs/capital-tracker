#!/usr/bin/env bash
# Root setup of the pull release agent (docs/pull-release-agent.md).
# Run as root from a clean Git checkout of the reviewed commit:
#   install   install the agent and its timer in observe mode; asks once for the GitHub token
#   token     replace the GitHub token (read from standard input, never an argument)
#   observe   check and log what would be released, release nothing (the mode after install)
#   active    release owner-approved deploy runs
#   update    refresh the agent and its systemd units from this checkout, keeping mode and token
# It never touches the release dispatcher, its SSH principal, sudo rule, receipts,
# the application runtime directory or its containers.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run as root' >&2; exit 1; }
source=$(cd "$(dirname "$0")/.." && pwd -P)
libexec=/usr/local/libexec/capital-tracker
agent=$libexec/deploy-agent
etc=/etc/capital-tracker
config=$etc/deploy-agent.json
token=$etc/deploy-agent.token
state=/var/lib/capital-tracker-agent
units=/etc/systemd/system
unit=capital-tracker-deploy-agent
clone_url=https://github.com/PavelArs/capital-tracker.git

usage() {
  echo 'Usage: deploy-agent-install.sh install | token | observe | active | update' >&2
  exit 2
}

clean_checkout() {
  local changes
  changes=$(git -C "$source" status --porcelain --untracked-files=no) || { echo 'Run this from a Git checkout of the repository' >&2; exit 1; }
  [[ -z $changes ]] || { echo 'Checkout has local changes' >&2; exit 1; }
}

# Staged copies (the token among them) never outlive the script.
staged=''
trap 'rm -f "$staged"' EXIT

# Never write through a link: each file is staged beside its target, then renamed over it.
publish() {
  local from=$1 to=$2 mode=$3
  [[ ! -L $to && ! -L $to.next ]] || { echo "Refusing symlink at $to" >&2; exit 1; }
  install -o root -g root -m "$mode" "$from" "$to.next"
  mv -T "$to.next" "$to"
}

install_files() {
  install -d -o root -g root -m 0755 "$libexec" "$etc"
  publish "$source/scripts/deploy-agent.py" "$agent" 0755
  publish "$source/deploy/agent/$unit.service" "$units/$unit.service" 0644
  publish "$source/deploy/agent/$unit.timer" "$units/$unit.timer" 0644
  systemctl daemon-reload
}

set_mode() {
  staged=$(mktemp)
  printf '{"mode": "%s"}\n' "$1" >"$staged"
  publish "$staged" "$config" 0644
  rm -f "$staged"
  echo "Agent mode: $1"
}

read_token() {
  local value
  if [[ -t 0 ]]; then printf 'Paste the fine-grained GitHub token (input hidden): ' >&2; fi
  IFS= read -rs value || true
  if [[ -t 0 ]]; then echo >&2; fi
  [[ $value =~ ^github_pat_[A-Za-z0-9_]{20,255}$ ]] || { echo 'Expected one fine-grained GitHub token (github_pat_...)' >&2; exit 1; }
  staged=$(mktemp)
  printf '%s\n' "$value" >"$staged"
  publish "$staged" "$token" 0600
  rm -f "$staged"
  echo 'Token saved'
}

# The agent refuses symlinks too; refuse them here before changing anything.
refuse_links() {
  local path
  for path in "$agent" "$config" "$token" "$state" "$state/repo" "$units/$unit.service" "$units/$unit.timer"; do
    [[ ! -L $path ]] || { echo "Refusing symlink at $path" >&2; exit 1; }
  done
}

require_installed() {
  [[ -f $agent && -f $config && -f $token ]] || { echo 'The agent is not installed; run install first' >&2; exit 1; }
}

case ${1:-} in
  install | token | observe | active | update) refuse_links ;;
esac

case ${1:-} in
  install)
    [[ $# == 1 ]] || usage
    clean_checkout
    for tool in /usr/bin/python3 git systemctl install mktemp; do
      command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
    done
    install_files
    [[ -f $config ]] || set_mode observe
    [[ -f $token ]] || read_token
    install -d -o root -g root -m 0700 "$state"
    if [[ ! -d $state/repo/.git ]]; then
      git init -q "$state/repo"
      git -C "$state/repo" remote add origin "$clone_url"
    fi
    /usr/bin/python3 -I "$agent" check
    systemctl enable --now "$unit.timer"
    echo "Installed from commit $(git -C "$source" rev-parse HEAD). Follow it with: journalctl -fu $unit"
    ;;
  token)
    [[ $# == 1 ]] || usage
    require_installed
    read_token
    /usr/bin/python3 -I "$agent" check
    ;;
  observe | active)
    [[ $# == 1 ]] || usage
    require_installed
    set_mode "$1"
    ;;
  update)
    [[ $# == 1 ]] || usage
    require_installed
    clean_checkout
    install_files
    echo "Updated the agent from commit $(git -C "$source" rev-parse HEAD)"
    ;;
  *)
    usage
    ;;
esac
