#!/usr/bin/env bash
# Fixed read-only deployment-identity inventory. Never emit runtime values.
set -Eeuo pipefail
root=${RELEASE_ROOT:-/opt/capital-tracker}
printf 'runtime_directory=%s\n' "$root"
printf 'deployment_user=%s\n' "$(id -un)"
printf 'project_directory_writable=%s\n' "$(test -w "$root" && echo yes || echo no)"
printf 'existing_env_readable=%s\n' "$(test -r "$root/.env" && echo yes || echo no)"
printf 'noninteractive_sudo=%s\n' "$(sudo -n true >/dev/null 2>&1 && echo yes || echo no)"
if [[ -r "$root/.env" ]]; then
  echo 'existing_setting_names:'
  sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$root/.env" | sort -u
fi
if docker info >/dev/null 2>&1; then
  echo 'docker_access=yes'
  echo 'application_container_metadata:'
  docker ps -a --format '{{.Names}} {{.Status}}' | grep -E '^capital_tracker_' || true
  echo 'application_volume_names:'
  docker volume ls --format '{{.Name}}' | grep -Ei 'capital|tracker' || true
else
  echo 'docker_access=no'
fi
printf 'capital_vhost_enabled=%s\n' "$(test -L /etc/nginx/sites-enabled/capital.pavelars.ru && echo yes || echo no)"
