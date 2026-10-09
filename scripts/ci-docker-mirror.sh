#!/usr/bin/env bash
# Route Docker Hub pulls on GitHub-hosted runners through a public pull-through mirror.
# Hosted runners share egress addresses, so anonymous Docker Hub pulls hit the rate limit.
# Images stay pinned by digest: a mirror serves the same bytes or the pull fails.
set -euo pipefail

config=/etc/docker/daemon.json
mirror=https://mirror.gcr.io

current='{}'
if [ -s "$config" ]; then
  current="$(cat "$config")"
fi
printf '%s' "$current" \
  | jq --arg mirror "$mirror" '. + {"registry-mirrors": [$mirror]}' \
  | sudo tee "$config" >/dev/null
sudo systemctl restart docker
docker info --format '{{json .RegistryConfig.Mirrors}}' | grep -q "$mirror"
