#!/usr/bin/env bash
# Log in to Docker Hub when the repository has credentials for it, so image pulls count
# against the free account's limit instead of the shared runner address's anonymous one.
# Without credentials (a fork, or secrets not added yet) this is a no-op.
set -euo pipefail

if [ -z "${DOCKERHUB_USERNAME:-}" ] || [ -z "${DOCKERHUB_TOKEN:-}" ]; then
  echo 'No Docker Hub credentials configured: pulling anonymously.'
  exit 0
fi
printf '%s' "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
