"""Private model configuration is only loaded for the API process, without secrets in errors."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infrastructure/scripts"))
import business_services


def test_ai_configuration_absent_or_allowlisted(tmp_path, monkeypatch):
    monkeypatch.setattr(business_services, "RUNTIME", tmp_path)
    assert business_services.ai_environment() == {}
    values = {"TRUSTGUARD_AI_ENABLED": "true", "DEEPSEEK_API_KEY_FILE": "/private/key", "DEEPSEEK_MODEL": "deepseek-flash"}
    (tmp_path / "ai-environment.json").write_text(json.dumps(values))
    assert business_services.ai_environment() == values


@pytest.mark.parametrize("content", ['not-json', '[]', '{"TRUSTGUARD_AI_ENABLED":true}', '{"TRUSTGUARD_DATABASE_URL":"secret"}', '{"DEEPSEEK_API_KEY":"secret"}'])
def test_ai_configuration_rejects_injection_without_echoing_values(tmp_path, monkeypatch, content):
    monkeypatch.setattr(business_services, "RUNTIME", tmp_path)
    (tmp_path / "ai-environment.json").write_text(content)
    with pytest.raises(RuntimeError) as captured:
        business_services.ai_environment()
    assert "secret" not in str(captured.value)