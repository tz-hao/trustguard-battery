#!/usr/bin/env bash
set -euo pipefail
# Explicit adapter to the local Windows Docker Desktop engine. No global context change.
exec '/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe' --context desktop-linux "$@"
