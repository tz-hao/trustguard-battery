"""Guard tests that block accidental commits of personal paths, real server IPs, or private keys."""

from __future__ import annotations

import ipaddress
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKIP_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".tar",
    ".gz",
    ".zip",
    ".woff",
    ".woff2",
    ".pyc",
}

SKIP_PREFIXES = (
    "chaincode/vendor/",
    "node_modules/",
    ".tools/",
    ".venv/",
    "infrastructure/runtime/",
)

# Matches concrete /home/<user>/, C:\Users\<user>\, or //wsl.localhost/<distro>
# while ignoring angle-bracket placeholders like <repo-root> or <wsl-distro>.
PERSONAL_PATH_PATTERNS = [
    (
        re.compile(r"(?<![A-Za-z0-9_])/home/[a-zA-Z0-9._-]+/"),
        "hardcoded Linux home directory (replace with `<repo-root>`, `$HOME`, or a relative path)",
    ),
    (
        re.compile(r"[A-Za-z]:\\Users\\[a-zA-Z0-9._-]+\\"),
        "hardcoded Windows user directory (replace with `%USERPROFILE%` or a placeholder)",
    ),
    (
        re.compile(r"(?:\\\\|//)wsl\.localhost[/\\](?!<)[a-zA-Z0-9._-]+"),
        "hardcoded WSL distribution name (replace with `<wsl-distro>` or a CLI flag)",
    ),
]

PUBLIC_URL_IP_RE = re.compile(r"https?://(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:/|[\"'\s)`]|$)")
PRIVATE_KEY_HEADER_RE = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")


def _tracked_text_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    files: list[Path] = []
    for raw in result.stdout.split(b"\0"):
        if not raw:
            continue
        rel = raw.decode("utf-8", errors="replace")
        if rel.startswith(SKIP_PREFIXES):
            continue
        if rel == "tests/test_repo_hygiene.py":
            continue
        path = ROOT / rel
        if not path.is_file() or path.suffix.lower() in SKIP_EXTENSIONS:
            continue
        # Skip multi-megabyte generated HTML snapshots (e.g. embedded image bundles)
        if path.stat().st_size > 2 * 1024 * 1024:
            continue
        files.append(path)
    return files


def _is_disallowed_public_ip(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return not (addr.is_loopback or addr.is_private or addr.is_link_local or addr.is_reserved)


def test_no_personal_paths_or_public_server_ips_in_tracked_files() -> None:
    violations: list[str] = []
    for path in _tracked_text_files():
        rel = path.relative_to(ROOT).as_posix()
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for lineno, line in enumerate(content.splitlines(), start=1):
            for pattern, guidance in PERSONAL_PATH_PATTERNS:
                if pattern.search(line):
                    violations.append(f"{rel}:{lineno}: {guidance}")
            for match in PUBLIC_URL_IP_RE.finditer(line):
                ip = match.group(1)
                if _is_disallowed_public_ip(ip):
                    violations.append(
                        f"{rel}:{lineno}: hardcoded public IP `{ip}` (replace with `<deployment-host>` or an environment variable)"
                    )
            if PRIVATE_KEY_HEADER_RE.search(line):
                violations.append(
                    f"{rel}:{lineno}: private key material detected (keep keys in ignored runtime directories only)"
                )

    assert not violations, "Repository hygiene check failed:\n" + "\n".join(violations[:25])
