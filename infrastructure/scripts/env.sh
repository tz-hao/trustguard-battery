#!/usr/bin/env bash
# Source this file; changes apply to this shell only.
TRUSTGUARD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export TRUSTGUARD_ROOT
export FABRIC_SAMPLES=/home/milli/projects/fabric-samples
export PATH="$TRUSTGUARD_ROOT/.tools/go1.26.4/bin:$TRUSTGUARD_ROOT/.tools/bin:$FABRIC_SAMPLES/bin:$PATH"
export GOPATH="$TRUSTGUARD_ROOT/.tools/gopath"
export GOCACHE="$TRUSTGUARD_ROOT/.tools/go-build"
export GOTOOLCHAIN=local
export FABRIC_CFG_PATH="$FABRIC_SAMPLES/config"
export CONTAINER_CLI="$TRUSTGUARD_ROOT/infrastructure/scripts/docker-local.sh"
export CONTAINER_CLI_COMPOSE="$CONTAINER_CLI compose"
export TEST_NETWORK_HOME="$FABRIC_SAMPLES/test-network"
export CHANNEL_NAME=trustguardchannel
export CHAINCODE_NAME=basic
