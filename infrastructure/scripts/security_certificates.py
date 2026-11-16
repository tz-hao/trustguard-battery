#!/usr/bin/env python3
"""Issue only new disposable local test identities; append one test-only TLS revocation."""
import argparse
import json
from datetime import datetime,timedelta,timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization

from business_certificates import issue,save_key,save_cert,write
from business_network import RUNTIME


def issuer(folder):
    return serialization.load_pem_private_key((folder/'ca.key').read_bytes(),password=None),x509.load_pem_x509_certificate((folder/'ca.crt').read_bytes())


def prepare(name):
    target=RUNTIME/'security'/name
    if target.exists():raise RuntimeError('Existing test identities retained; choose a new test name')
    target.mkdir(parents=True,mode=0o700)
    now=datetime.now(timezone.utc)
    for kind in ['expired-client','revoked-client']:
        authority=issuer(RUNTIME/'api-client-ca')
        options={'not_before':authority[1].not_valid_before_utc+timedelta(seconds=1),'not_after':now-timedelta(seconds=30)} if kind.startswith('expired') else {}
        key,cert=issue(authority,name+'-'+kind,'api-client',client=True,**options)
        save_key(target/(kind+'.key'),key);save_cert(target/(kind+'.crt'),cert)
    authority=issuer(RUNTIME/'organizations/lab/enrollment-ca')
    key,cert=issue(authority,name+'-expired-inspector','client',role='inspector',not_before=authority[1].not_valid_before_utc+timedelta(seconds=1),not_after=now-timedelta(seconds=30))
    save_key(target/'expired-inspector.key',key);save_cert(target/'expired-inspector.crt',cert)
    print('Prepared new local certificate rejection fixtures')


def revoke(name):
    target=RUNTIME/'security'/name
    cert=x509.load_pem_x509_certificate((target/'revoked-client.crt').read_bytes())
    key,ca=issuer(RUNTIME/'api-client-ca')
    file=RUNTIME/'api-client-ca/ca.crl'
    old=x509.load_pem_x509_crl(file.read_bytes())
    if any(entry.serial_number==cert.serial_number for entry in old):
        print('Test-only certificate already revoked');return
    now=datetime.now(timezone.utc)
    builder=x509.CertificateRevocationListBuilder().issuer_name(ca.subject).last_update(now-timedelta(seconds=5)).next_update(now+timedelta(days=30))
    for entry in old:builder=builder.add_revoked_certificate(entry)
    entry=x509.RevokedCertificateBuilder().serial_number(cert.serial_number).revocation_date(now).build()
    updated=builder.add_revoked_certificate(entry).sign(key,hashes.SHA256())
    file.write_bytes(updated.public_bytes(serialization.Encoding.PEM))
    print('Appended test-only client serial to local API CRL; business identities retained')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','revoke']);parser.add_argument('name')
    args=parser.parse_args()
    if not __import__('re').fullmatch('[a-z0-9-]{1,50}',args.name):raise RuntimeError('Invalid local test name')
    (prepare if args.action=='prepare' else revoke)(args.name)
