"""Fail-closed mTLS launcher. Never use an unauthenticated public uvicorn listener."""
import os
import ssl

import uvicorn


def main():
    required = ("TRUSTGUARD_TLS_CERT", "TRUSTGUARD_TLS_KEY", "TRUSTGUARD_GATEWAY_CLIENT_CA")
    if any(not os.environ.get(name) for name in required):
        raise RuntimeError("risk service requires server TLS and dedicated Gateway client CA")
    config = uvicorn.Config(
        "trustguard_risk.app:app", host="127.0.0.1", port=18000,
        ssl_certfile=os.environ[required[0]], ssl_keyfile=os.environ[required[1]],
        ssl_ca_certs=os.environ[required[2]], ssl_cert_reqs=ssl.CERT_REQUIRED,
        ssl_version=ssl.PROTOCOL_TLS_SERVER, access_log=False,
    )
    config.load()
    crl = os.environ.get("TRUSTGUARD_GATEWAY_CLIENT_CRL")
    if not crl:
        raise RuntimeError("Gateway workload CRL required")
    config.ssl.load_verify_locations(cafile=crl)
    config.ssl.verify_flags |= ssl.VERIFY_CRL_CHECK_LEAF
    uvicorn.Server(config).run()


if __name__ == "__main__":
    main()
