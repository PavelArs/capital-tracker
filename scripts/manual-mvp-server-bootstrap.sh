#!/usr/bin/env bash
# Run once as root after review. Dedicated fresh-install configuration only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Root setup privileges required'; exit 1; }
account=${1:?Required root runtime account}
postgres_image=${2:?Required scanned PostgreSQL18 image digest}
redis_image=${3:?Required scanned Redis image digest}
receipt=${4:?Required root-reviewed fresh candidate receipt}
[[ $postgres_image =~ ^ghcr\.io/pavelars/capital-tracker-postgres@sha256:[a-f0-9]{64}$ && $redis_image =~ ^redis@sha256:[a-f0-9]{64}$ ]] || { echo 'Pinned reviewed infrastructure images required'; exit 1; }
[[ $account =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || exit 2
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/docker/current/bin
export PATH
export DOCKER_CONFIG=/etc/capital-tracker/docker-config
source_dir=$(cd "$(dirname "$0")/.." && pwd)
# Root-reviewed metadata can precede runtime creation; final single-use dispatcher
# approval follows bootstrap/installation. Never source the receipt or runtime data.
/usr/bin/python3 -I - "$source_dir" "$receipt" "$postgres_image" "$redis_image" <<'PYTHON'
import importlib.util, pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('receipt', root / 'scripts/manual-mvp-receipt.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    commit = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    module.validate_bootstrap_receipt(sys.argv[2], sys.argv[3], sys.argv[4], commit, root)
    module.dispatcher.check_registry_config(module.dispatcher.Config())
except (module.dispatcher.Refusal, KeyError, TypeError, OSError, subprocess.SubprocessError):
    raise SystemExit('Bootstrap receipt validation refused')
PYTHON
[[ $account == root ]] || { echo 'Runtime owner must be root'; exit 1; }
id "$account" >/dev/null
root=/var/snap/docker/common/capital-tracker
domain=capital.pavelars.ru
[[ ! -e /etc/nginx/sites-enabled/capital.pavelars.ru && ! -L /etc/nginx/sites-enabled/capital.pavelars.ru ]] || { echo 'Existing enabled target vhost preserved; inspect before setup'; exit 1; }
# Validate all existing custom destinations before install, writes or edge changes.
# Do not repair ownership or permissions through an untrusted existing ancestor.
/usr/bin/python3 -I - "$root" /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/sites-available/capital.pavelars.ru <<'PYGUARD'
import os, pathlib, stat, sys
ROOT_UID = 0
TRUST_ROOT = pathlib.Path("/")
for name in sys.argv[1:]:
    path = pathlib.Path(name)
    chain = [TRUST_ROOT]
    for part in path.relative_to(TRUST_ROOT).parts:
        chain.append(chain[-1] / part)
    for component in chain:
        try:
            info = os.lstat(component)
        except FileNotFoundError:
            break
        directory = component != path or path != pathlib.Path(sys.argv[4])
        trusted_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
        if not trusted_type or info.st_uid != ROOT_UID or info.st_mode & 0o022:
            raise SystemExit('Refusing untrusted bootstrap path: ' + str(component))
root = pathlib.Path(sys.argv[1])
if root.exists() and any(root.iterdir()):
    raise SystemExit('Existing managed runtime preserved; inspect before retry')
PYGUARD
for tool in docker openssl nginx ss python3; do command -v "$tool" >/dev/null; done
# Do not bootstrap over unexplained owner data or partially completed installation.
containers=$(docker ps -a --format '{{.Names}}')
volumes=$(docker volume ls --format '{{.Name}}')
[[ -z $(grep -E '^capital_tracker_' <<<"$containers" || true) ]] || exit 1
[[ -z $(grep -Ei 'capital|tracker' <<<"$volumes" || true) ]] || exit 1
for file in .env.release .backup-key .mfa-key .owner-password.json; do [[ ! -e "$root/$file" && ! -L "$root/$file" ]] || { echo 'Existing release secrets preserved; inspect before retry'; exit 1; }; done
for port in 3100 3101 3102; do [[ -z $(ss -ltnH "sport = :$port") ]] || { echo 'Dedicated application port occupied'; exit 1; }; done
[[ -f "/etc/letsencrypt/live/$domain/fullchain.pem" && -f "/etc/letsencrypt/live/$domain/privkey.pem" ]] || { echo 'Existing domain TLS certificate unavailable'; exit 1; }
install -d -o "$account" -g "$account" -m 700 "$root"
# Exclusive create. Keys are independent; preserve the unknown existing .env entirely.
/usr/bin/python3 -I - "$root" "$account" "$postgres_image" "$redis_image" <<'PY'
import json, os, pwd, secrets, sys
from pathlib import Path
root=Path(sys.argv[1]); owner=pwd.getpwnam(sys.argv[2])
def private(name, data, uid=owner.pw_uid, gid=owner.pw_gid):
    fd=os.open(root/name, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd,'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
    os.chown(root/name,uid,gid)
private('.mfa-key',secrets.token_bytes(32),1000,1000)
private('.backup-key',secrets.token_hex(64).encode())
password=secrets.token_urlsafe(32)
private('.owner-password.json',json.dumps({'password':password,'confirmation':password}).encode())
private('.env.release',('\n'.join([
 'DB_USERNAME=capital_owner', 'DB_PASSWORD='+secrets.token_hex(32), 'DB_NAME=capital_tracker',
 'POSTGRES_IMAGE='+sys.argv[3], 'POSTGRES_EXPECTED_MAJOR=18', 'POSTGRES_VOLUME_TARGET=/var/lib/postgresql',
 'REDIS_IMAGE='+sys.argv[4],
 'FRONTEND_URL=https://capital.pavelars.ru', 'BACKEND_HOST_PORT=3100','FRONTEND_HOST_PORT=3101',
 'MFA_KEY_FILE='+str(root/'.mfa-key'), 'MFA_KEY_ID=capital-production-1',
 'TRUSTED_PROXY_IPS=[]', 'OWNER_EMAIL=owner@capital.pavelars.ru',
 'BACKGROUND_JOBS_ENABLED=false','DISPLAY_FX_ENABLED=false','']) ).encode())
PY
install -d -o 1000 -g 1000 -m 700 "$root/operator"
# Preserve the old inactive target vhost; never modify apex or other service configurations.
site=/etc/nginx/sites-available/capital.pavelars.ru
if [[ -f $site ]]; then cp -p "$site" "$root/capital-vhost-before.conf"; fi
sed -e "s/<your-domain>/$domain/g" -e 's/127.0.0.1:3000/127.0.0.1:3100/g' -e 's/127.0.0.1:3001/127.0.0.1:3101/g' "$source_dir/deploy/nginx.conf" > "$site"
ln -s "$site" /etc/nginx/sites-enabled/capital.pavelars.ru
if ! nginx -t; then
  unlink /etc/nginx/sites-enabled/capital.pavelars.ru
  [[ ! -f "$root/capital-vhost-before.conf" ]] || cp -p "$root/capital-vhost-before.conf" "$site"
  echo 'Nginx validation refused; previous edge retained, new secret files preserved for inspection'
  exit 1
fi
systemctl reload nginx
echo 'Dedicated domain and fresh release secrets prepared. Retrieve independent keys through protected operator storage; no secret values were printed'
