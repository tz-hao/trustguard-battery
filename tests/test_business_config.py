import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infrastructure/scripts"))
from business_network import configtx, compose, ORGANIZATIONS


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
