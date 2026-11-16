#!/usr/bin/env bash
set -euo pipefail

if [ -n "${TRUSTGUARD_DOCKER_BIN:-}" ]; then
  if [ -n "${TRUSTGUARD_DOCKER_CONTEXT:-}" ]; then
    exec "$TRUSTGUARD_DOCKER_BIN" --context "$TRUSTGUARD_DOCKER_CONTEXT" "$@"
  fi
  exec "$TRUSTGUARD_DOCKER_BIN" "$@"
fi

win_docker="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"
if command -v docker >/dev/null 2>&1; then
  if [ ! -x "$win_docker" ]; then
    exec docker "$@"
  fi
  if command -v timeout >/dev/null 2>&1; then
    if timeout 2 docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
      exec docker "$@"
    fi
  elif docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
    exec docker "$@"
  fi
fi

if [ -x "$win_docker" ]; then
  exec "$win_docker" --context desktop-linux "$@"
fi

echo "Error: Docker CLI not found or daemon unavailable. Install Docker or set TRUSTGUARD_DOCKER_BIN." >&2
exit 1
