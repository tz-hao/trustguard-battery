import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infrastructure/scripts"))
from business_network import configtx, compose, ORGANIZATIONS
import toolchain


def test_orderer_block_writer_is_an_orderer_member():
    profile = configtx()["Profiles"]["BatteryChannel"]
    orderer = profile["Orderer"]["Organizations"][0]
    assert orderer["Policies"]["Writers"]["Rule"] == "OR('BatteryOrdererMSP.member')"
    assert profile["Orderer"]["Policies"]["BlockValidation"]["Rule"] == "ANY Writers"
    assert profile["Application"]["Policies"]["Endorsement"]["Rule"] == "MAJORITY Endorsement"
    assert {org["ID"] for org in profile["Application"]["Organizations"]} == set(ORGANIZATIONS.values())


def test_new_resources_are_separate_and_host_ports_are_loopback_only():
    config = compose()
    names = [service["container_name"] for service in config["services"].values()]
    assert len(names) == len(set(names))
    assert not {"peer0.org1.example.com", "peer0.org2.example.com", "orderer.example.com", "chainmon-postgres"} & set(names)
    ports = [port for service in config["services"].values() for port in service.get("ports", [])]
    assert all(port["host_ip"] == "127.0.0.1" for port in ports)
    assert len({port["published"] for port in ports}) == len(ports)


def test_minio_image_override_drops_custom_entrypoint(monkeypatch):
    default_cfg = compose()
    assert default_cfg["services"]["minio"]["image"] == "trustguard/minio:2025-10-15"
    assert default_cfg["services"]["minio"]["entrypoint"] == ["/minio"]

    monkeypatch.setenv("TRUSTGUARD_MINIO_IMAGE", "minio/minio:RELEASE.2025-09-07T16-13-09Z")
    custom_cfg = compose()
    assert custom_cfg["services"]["minio"]["image"] == "minio/minio:RELEASE.2025-09-07T16-13-09Z"
    assert "entrypoint" not in custom_cfg["services"]["minio"]


def test_toolchain_resolves_custom_fabric_samples_env(tmp_path, monkeypatch):
    samples = tmp_path / "custom-fabric"
    (samples / "bin").mkdir(parents=True)
    (samples / "config").mkdir(parents=True)
    peer = samples / "bin/peer"
    peer.write_text("#!/bin/sh\n")
    peer.chmod(0o755)
    (samples / "config/core.yaml").write_text("peer: {}\n")

    monkeypatch.setenv("FABRIC_SAMPLES", str(samples))
    assert toolchain.resolve_fabric_root() == samples
    assert toolchain.fabric_bin("peer") == str(peer)
    assert toolchain.fabric_config_dir() == samples / "config"
