"""Guard tests ensuring chaincode error codes and core enums stay in sync with the web frontend."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHAINCODE_DOMAIN = ROOT / "chaincode" / "domain"
WEB_TYPES = ROOT / "apps" / "web" / "src" / "lib" / "types.ts"


def _extract_chaincode_error_codes() -> set[str]:
    codes: set[str] = set()
    pattern = re.compile(r'fail\("([A-Z0-9_]+)"')
    for go_file in CHAINCODE_DOMAIN.glob("*.go"):
        if go_file.name.endswith("_test.go"):
            continue
        codes.update(pattern.findall(go_file.read_text(encoding="utf-8")))
    return codes


def _extract_frontend_error_codes() -> set[str]:
    content = WEB_TYPES.read_text(encoding="utf-8")
    match = re.search(r"export const ERROR_DESCRIPTIONS: Record<string, string> = \{(.*?)\n\};", content, re.S)
    assert match, "ERROR_DESCRIPTIONS map not found in apps/web/src/lib/types.ts"
    return set(re.findall(r"^\s+([A-Z0-9_]+):", match.group(1), re.M))


def test_all_chaincode_error_codes_have_frontend_descriptions() -> None:
    chaincode_codes = _extract_chaincode_error_codes()
    frontend_codes = _extract_frontend_error_codes()
    missing = sorted(chaincode_codes - frontend_codes)
    assert not missing, (
        "Chaincode error codes missing from apps/web/src/lib/types.ts ERROR_DESCRIPTIONS "
        "(add clear Chinese descriptions for each):\n" + "\n".join(missing)
    )
