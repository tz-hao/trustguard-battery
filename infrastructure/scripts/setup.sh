#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

GO_VERSION="1.26.4"
GO_LINUX_AMD64_SHA256="1153d3d50e0ac764b447adfe05c2bcf08e889d42a02e0fe0259bd47f6733ad7f"
FABRIC_VERSION="2.5.16"
FABRIC_LINUX_AMD64_SHA256="18c91e7f2f11b601e6622cc70454d568af897707ee9adf111e9fa91a233881bf"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Unsupported CPU architecture: $ARCH_RAW" >&2
    exit 1
    ;;
esac

if [ "$OS" != "linux" ] && [ "$OS" != "darwin" ]; then
  echo "Unsupported OS: $OS (supported: linux, darwin/macOS)" >&2
  exit 1
fi

sha256_check() {
  local file="$1"
  local expected="$2"
  local actual=""
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  else
    echo "Warning: sha256sum/shasum not found; skipping checksum check for $file" >&2
    return 0
  fi
  if [ "$actual" != "$expected" ]; then
    echo "SHA-256 mismatch for $file: expected $expected, got $actual" >&2
    return 1
  fi
}

download() {
  local url="$1"
  local dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    echo "Error: curl or wget is required to download toolchains." >&2
    exit 1
  fi
}

echo "== 1. Checking Docker, Node.js (>=22), and Python (3.12) =="
"$ROOT/infrastructure/scripts/docker-local.sh" version --format 'Docker Client={{.Client.Version}} Server={{.Server.Version}}'

NODE_BIN="${TRUSTGUARD_NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ] && [ -x "$HOME/.local/bin/node" ]; then
  NODE_BIN="$HOME/.local/bin/node"
fi
if [ -z "$NODE_BIN" ]; then
  echo "Error: Node.js 22.x not found. Install Node.js 22 (recommended: 22.23.1) first." >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" != "22" ]; then
  echo "Error: Node.js v22.x required (found $("$NODE_BIN" -v) at $NODE_BIN)." >&2
  exit 1
fi
echo "Node.js $("$NODE_BIN" -v) ($NODE_BIN)"

PY_BIN="${TRUSTGUARD_PYTHON_BIN:-}"
if [ -z "$PY_BIN" ]; then
  for cand in python3.12 python3; do
    if command -v "$cand" >/dev/null 2>&1; then
      if "$cand" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)" 2>/dev/null; then
        PY_BIN="$(command -v "$cand")"
        break
      fi
    fi
  done
fi
if [ -z "$PY_BIN" ]; then
  echo "Error: Python 3.12 not found. Install Python 3.12 or set TRUSTGUARD_PYTHON_BIN." >&2
  exit 1
fi
echo "$("$PY_BIN" --version) ($PY_BIN)"

mkdir -p "$ROOT/.tools/downloads" "$ROOT/.tools/bin" "$ROOT/.tools/gopath" "$ROOT/.tools/go-build"

echo "== 2. Installing Go ${GO_VERSION} into .tools/go${GO_VERSION} (if missing) =="
if [ ! -x "$ROOT/.tools/go${GO_VERSION}/bin/go" ]; then
  go_tar="$ROOT/.tools/downloads/go${GO_VERSION}.${OS}-${ARCH}.tar.gz"
  download "https://go.dev/dl/go${GO_VERSION}.${OS}-${ARCH}.tar.gz" "$go_tar"
  if [ "${OS}-${ARCH}" = "linux-amd64" ]; then
    sha256_check "$go_tar" "$GO_LINUX_AMD64_SHA256"
  fi
  rm -rf "$ROOT/.tools/go.tmp"
  mkdir -p "$ROOT/.tools/go.tmp"
  tar -xzf "$go_tar" -C "$ROOT/.tools/go.tmp"
  rm -rf "$ROOT/.tools/go${GO_VERSION}"
  mv "$ROOT/.tools/go.tmp/go" "$ROOT/.tools/go${GO_VERSION}"
  rm -rf "$ROOT/.tools/go.tmp"
else
  echo "Go ${GO_VERSION} already present in .tools/go${GO_VERSION}"
fi

echo "== 3. Installing Hyperledger Fabric ${FABRIC_VERSION} CLI & config (if missing) =="
has_fabric=false
for dir in \
  "${FABRIC_SAMPLES:-}" \
  "$ROOT/.tools/fabric" \
  "$ROOT/.tools/fabric-samples" \
  "$(dirname "$ROOT")/fabric-samples" \
  "$HOME/fabric-samples"; do
  if [ -n "$dir" ] && [ -x "$dir/bin/peer" ] && [ -f "$dir/config/core.yaml" ]; then
    echo "Fabric ${FABRIC_VERSION} CLI/config already present at $dir"
    has_fabric=true
    break
  fi
done

if [ "$has_fabric" = false ]; then
  fabric_tar="$ROOT/.tools/downloads/hyperledger-fabric-${OS}-${ARCH}-${FABRIC_VERSION}.tar.gz"
  download "https://github.com/hyperledger/fabric/releases/download/v${FABRIC_VERSION}/hyperledger-fabric-${OS}-${ARCH}-${FABRIC_VERSION}.tar.gz" "$fabric_tar"
  if [ "${OS}-${ARCH}" = "linux-amd64" ]; then
    sha256_check "$fabric_tar" "$FABRIC_LINUX_AMD64_SHA256"
  fi
  mkdir -p "$ROOT/.tools/fabric"
  tar -xzf "$fabric_tar" -C "$ROOT/.tools/fabric"
  echo "Installed Fabric ${FABRIC_VERSION} binaries & config into .tools/fabric"
fi

echo "== 4. Creating Python .venv and installing risk service dependencies =="
if [ ! -x "$ROOT/.venv/bin/python" ]; then
  "$PY_BIN" -m venv "$ROOT/.venv"
fi
if ! "$ROOT/.venv/bin/python" -c "import fastapi, uvicorn, sklearn, networkx, cryptography, pydantic, pytest" 2>/dev/null; then
  "$ROOT/.venv/bin/pip" install --upgrade pip
  "$ROOT/.venv/bin/pip" install -r "$ROOT/services/risk/requirements.lock"
else
  echo "Python .venv dependencies already installed"
fi

echo "== 5. Installing Node.js workspace dependencies and building API & Web =="
if [ ! -d "$ROOT/node_modules" ] || [ ! -x "$ROOT/node_modules/.bin/next" ] || [ ! -x "$ROOT/node_modules/.bin/tsc" ]; then
  PATH="$(dirname "$NODE_BIN"):$PATH" npm ci
else
  echo "Node workspace node_modules already present (skipping npm ci; run 'npm ci' manually if needed)"
fi
PATH="$(dirname "$NODE_BIN"):$PATH" npm run build --workspace @trustguard/api
PATH="$(dirname "$NODE_BIN"):$PATH" npm run build --workspace @trustguard/web

echo "== 6. Running environment verification =="
PATH="$(dirname "$NODE_BIN"):$PATH" npm run check:env

echo
echo "Setup complete! Next step to initialize & start the local 4-org Fabric + TrustGuard platform:"
echo "  .venv/bin/python infrastructure/scripts/bootstrap.py"
