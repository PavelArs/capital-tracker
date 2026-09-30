#!/usr/bin/env bash
# Privileged operator setup for the restricted manual MVP release identity.
# Run as root from the reviewed Git checkout of the commit being released:
#   install PUBLIC_KEY_FILE   create/refresh the Capital-only SSH principal and root-owned files
#   approve RECEIPT_FILE      install an owner-reviewed CI receipt for this checkout's commit
# It never adds the principal to the docker group, changes shared deploy rights,
# reads application secrets or starts containers.
set -Eeuo pipefail
umask 022
[[ $(id -u) == 0 ]] || { echo 'Run as root'; exit 1; }
source=$(cd "$(dirname "$0")/.." && pwd -P)
user=capital-release
home=/var/lib/capital-release
libexec=/usr/local/libexec/capital-tracker
release=$libexec/release
dispatcher=$libexec/manual-mvp-dispatcher
receipts=/etc/capital-tracker/release-receipts
sudoers=/etc/sudoers.d/capital-release
files=(
  scripts/manual-mvp-release.sh:manual-mvp-release.sh
  scripts/manual-mvp-inventory.sh:manual-mvp-inventory.sh
  scripts/normalize-release-snapshot.awk:normalize-release-snapshot.awk
  docker-compose.yml:docker-compose.yml
  deploy/manual-mvp-infrastructure-pins.json:manual-mvp-infrastructure-pins.json
)

# Check every existing component before changing accounts or publishing authorization.
# Only custom installation paths are checked: system interpreter symlinks are valid.
validate_paths() {
  /usr/bin/python3 -I - "$@" <<'PYGUARD'
import os, pathlib, stat, sys
ROOT_UID = 0
TRUST_ROOT = pathlib.Path("/")
required = sys.argv[1] == 'required'
for entry in sys.argv[2:]:
    kind, name = entry.split(':', 1)
    path = pathlib.Path(name)
    if not path.is_absolute() or (path != TRUST_ROOT and TRUST_ROOT not in path.parents):
        raise SystemExit('Refusing invalid installation path: ' + name)
    chain = [TRUST_ROOT]
    for part in path.relative_to(TRUST_ROOT).parts:
        chain.append(chain[-1] / part)
    for component in chain:
        try:
            info = os.lstat(component)
        except FileNotFoundError:
            if required:
                raise SystemExit('Refusing missing installation path: ' + str(component))
            break
        directory = component != path or kind == 'd'
        trusted_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
        if not trusted_type or info.st_uid != ROOT_UID or info.st_mode & 0o022:
            raise SystemExit('Refusing untrusted installation path: ' + str(component))
PYGUARD
}

installation_paths=(
  "d:$home" "d:$home/.ssh" "d:$libexec" "d:$release" "d:$receipts"
  "f:$home/.ssh/authorized_keys" "f:$home/.ssh/authorized_keys.next" "f:$home/.ssh/authorized_keys2"
  "f:$dispatcher" "f:$dispatcher.next" "f:$sudoers" "f:$sudoers.next"
)
for pair in "${files[@]}"; do
  installation_paths+=("f:$release/${pair#*:}" "f:$release/${pair#*:}.next")
done

# -I isolates Python from the current directory, PYTHON* variables and user site.
validate_receipt() {
  /usr/bin/python3 -I - "$dispatcher" "$1" <<'PY'
import importlib.machinery, importlib.util, sys
loader = importlib.machinery.SourceFileLoader('dispatcher', sys.argv[1])
spec = importlib.util.spec_from_loader('dispatcher', loader)
d = importlib.util.module_from_spec(spec)
loader.exec_module(d)
with open(sys.argv[2], 'rb') as handle:
    data = handle.read(65537)
if len(data) > 65536:
    raise SystemExit('receipt too large')
receipt = d.parse_json(data)
request = {'version': 1, 'operation': 'deploy', 'commit': receipt.get('commit'), 'runId': receipt.get('runId')}
if not (d._full(d.COMMIT, request['commit']) and d._full(d.RUN_ID, request['runId'])):
    raise SystemExit('malformed receipt identity')
d.validate_receipt(request, receipt)
for key in ('commit', 'runId', 'installation', 'backend', 'frontend', 'postgres', 'redis'):
    print('{}={}'.format(key, receipt[key]))
for name, digest in sorted(receipt['files'].items()):
    print('file.{}={}'.format(name, digest))
PY
}

case ${1:-} in
  install)
    key=${2:?Public key file}
    validate_paths existing "${installation_paths[@]}"
    for tool in /usr/bin/python3 sudo visudo sshd useradd usermod install git; do command -v "$tool" >/dev/null; done
    [[ $(wc -l <"$key") -le 1 ]] || { echo 'Exactly one public key is required'; exit 1; }
    public=$(tr -d '\n' <"$key")
    [[ $public =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*(\ [A-Za-z0-9@._-]+)?$ ]] || { echo 'An ED25519 public key is required'; exit 1; }
    if id "$user" >/dev/null 2>&1; then
      entry=$(getent passwd "$user")
      [[ $(cut -d: -f6 <<<"$entry") == "$home" && $(cut -d: -f7 <<<"$entry") == /bin/sh ]] \
        || { echo "Refusing: existing $user has an unexpected home or shell"; exit 1; }
    else
      useradd --system --user-group --home-dir "$home" --no-create-home --shell /bin/sh "$user"
    fi
    # '*' disables password login without marking the account locked for public keys.
    usermod -p '*' "$user"
    for group in $(id -nG "$user"); do
      [[ $group == "$user" ]] || { echo "Refusing: $user belongs to $group"; exit 1; }
    done
    install -d -o root -g root -m 0755 "$home" "$home/.ssh" "$libexec" "$release" /etc/capital-tracker
    install -d -o root -g root -m 0700 "$receipts"
    validate_paths required "d:$home/.ssh" "d:$release" "d:$receipts"
    install -o root -g root -m 0755 "$source/scripts/manual-mvp-dispatcher.py" "$dispatcher.next"
    validate_paths required "f:$dispatcher.next"
    mv -T "$dispatcher.next" "$dispatcher"
    for pair in "${files[@]}"; do
      install -o root -g root -m 0644 "$source/${pair%%:*}" "$release/${pair#*:}.next"
      validate_paths required "f:$release/${pair#*:}.next"
      mv -T "$release/${pair#*:}.next" "$release/${pair#*:}"
      validate_paths required "f:$release/${pair#*:}"
    done
    validate_paths required "f:$dispatcher"
    # Root owns the home and key file, so the principal cannot add keys or options.
    rm -f "$home/.ssh/authorized_keys.next" "$home/.ssh/authorized_keys2"
    staged=$(mktemp)
    printf 'restrict,command="sudo -n %s" %s\n' "$dispatcher" "$public" >"$staged"
    install -o root -g root -m 0644 "$staged" "$home/.ssh/authorized_keys.next"
    rm -f "$staged"
    validate_paths required "f:$home/.ssh/authorized_keys.next"
    mv -T "$home/.ssh/authorized_keys.next" "$home/.ssh/authorized_keys"
    validate_paths required "f:$home/.ssh/authorized_keys"
    # Empty argument list: sudo refuses any argument appended to the dispatcher.
    staged=$(mktemp)
    {
      printf 'Defaults:%s env_reset, !requiretty, secure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\n' "$user"
      printf '%s ALL=(root) NOPASSWD: %s ""\n' "$user" "$dispatcher"
    } >"$staged"
    visudo -cf "$staged" >/dev/null
    # sudo ignores sudoers.d names containing a dot, so the staged name is inert.
    install -o root -g root -m 0440 "$staged" "$sudoers.next"
    rm -f "$staged"
    validate_paths required "f:$sudoers.next"
    mv -T "$sudoers.next" "$sudoers"
    validate_paths required "f:$sudoers"
    # The dispatcher refuses runtime inputs that another account could replace.
    if [[ -d /opt/capital-tracker ]]; then
      find /opt/capital-tracker \( -type l -o ! -user root -o -perm /022 \) -print \
        | sed 's/^/Will be refused until root-owned, not a link and not group\/world writable: /' | head -50
    fi
    for path in /opt/capital-tracker/.env /opt/capital-tracker/.env.release /opt/capital-tracker/.backup-key; do
      [[ -e $path ]] || echo "Not yet present (required before preflight/deploy): $path"
    done
    sshd -T 2>/dev/null | grep -Ei '^(allowusers|allowgroups) ' || true
    echo "Installed $user with forced dispatcher; confirm any AllowUsers/AllowGroups above permit it."
    sha256sum "$dispatcher" "$release"/*
    ;;
  approve)
    file=${2:?Receipt file}
    validate_paths existing "${installation_paths[@]}"
    validate_paths required "f:$dispatcher" "d:$release" "d:$receipts"
    head=$(git -C "$source" rev-parse HEAD)
    [[ -z $(git -C "$source" status --porcelain --untracked-files=no) ]] || { echo 'Checkout has local changes'; exit 1; }
    # Validate and install the same private copy, never a second read of the original.
    staged="$receipts/.pending-$$"
    validate_paths existing "f:$staged"
    install -o root -g root -m 0600 "$file" "$staged"
    validate_paths required "f:$staged"
    trap 'rm -f "$staged"' EXIT
    summary=$(validate_receipt "$staged")
    printf '%s\n' "$summary"
    commit=$(sed -n 's/^commit=//p' <<<"$summary")
    run=$(sed -n 's/^runId=//p' <<<"$summary")
    [[ $commit == "$head" ]] || { echo "Receipt commit differs from reviewed checkout $head"; exit 1; }
    for pair in "${files[@]}"; do
      name=${pair#*:}
      expected=$(sha256sum "$source/${pair%%:*}" | cut -d' ' -f1)
      installed=$(sha256sum "$release/$name" 2>/dev/null | cut -d' ' -f1 || true)
      [[ $expected == "$installed" ]] || echo "Server file $name differs from this checkout; run install first"
    done
    validate_paths existing "f:$receipts/$commit-$run.json"
    mv -T "$staged" "$receipts/$commit-$run.json"
    validate_paths required "f:$receipts/$commit-$run.json"
    trap - EXIT
    echo "Approved single-use receipt for commit $commit run $run"
    ;;
  *)
    echo 'Usage: manual-mvp-dispatcher-install.sh install PUBLIC_KEY_FILE | approve RECEIPT_FILE'
    exit 2
    ;;
esac
