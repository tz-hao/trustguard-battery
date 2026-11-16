#!/usr/bin/env bash
# Source this file; changes apply to this shell only.
TRUSTGUARD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export TRUSTGUARD_ROOT

if [ -z "${FABRIC_SAMPLES:-}" ]; then
  for candidate in \
    "$TRUSTGUARD_ROOT/.tools/fabric-samples" \
    "$(dirname "$TRUSTGUARD_ROOT")/fabric-samples" \
    "$HOME/fabric-samples"; do
    if [ -d "$candidate" ]; then
      export FABRIC_SAMPLES="$candidate"
      break
    fi
  done
fi

FABRIC_BIN_DIR=""
FABRIC_CFG_DIR=""
if [ -d "$TRUSTGUARD_ROOT/.tools/fabric/bin" ] && [ -d "$TRUSTGUARD_ROOT/.tools/fabric/config" ]; then
  FABRIC_BIN_DIR="$TRUSTGUARD_ROOT/.tools/fabric/bin"
  FABRIC_CFG_DIR="$TRUSTGUARD_ROOT/.tools/fabric/config"
elif [ -n "${FABRIC_SAMPLES:-}" ] && [ -d "$FABRIC_SAMPLES/bin" ]; then
  FABRIC_BIN_DIR="$FABRIC_SAMPLES/bin"
  if [ -d "$FABRIC_SAMPLES/config" ]; then
    FABRIC_CFG_DIR="$FABRIC_SAMPLES/config"
  fi
fi

for dir in \
  "$TRUSTGUARD_ROOT/.venv/bin" \
  "$TRUSTGUARD_ROOT/.tools/go1.26.4/bin" \
  "$TRUSTGUARD_ROOT/.tools/bin" \
  "$FABRIC_BIN_DIR"; do
  if [ -n "$dir" ] && [ -d "$dir" ]; then
    case ":$PATH:" in
      *":$dir:"*) ;;
      *) export PATH="$dir:$PATH" ;;
    esac
  fi
done

export GOPATH="${GOPATH:-$TRUSTGUARD_ROOT/.tools/gopath}"
export GOCACHE="${GOCACHE:-$TRUSTGUARD_ROOT/.tools/go-build}"
if [ -x "$TRUSTGUARD_ROOT/.tools/go1.26.4/bin/go" ]; then
  export GOTOOLCHAIN="${GOTOOLCHAIN:-local}"
fi
if [ -n "$FABRIC_CFG_DIR" ]; then
  export FABRIC_CFG_PATH="$FABRIC_CFG_DIR"
fi
export CONTAINER_CLI="$TRUSTGUARD_ROOT/infrastructure/scripts/docker-local.sh"
export CONTAINER_CLI_COMPOSE="$CONTAINER_CLI compose"
if [ -n "${FABRIC_SAMPLES:-}" ] && [ -d "$FABRIC_SAMPLES/test-network" ]; then
  export TEST_NETWORK_HOME="$FABRIC_SAMPLES/test-network"
fi
export CHANNEL_NAME="${CHANNEL_NAME:-trustguardchannel}"
export CHAINCODE_NAME="${CHAINCODE_NAME:-basic}"
