"""Store the API credential from the administrator's SSH terminal on the deployment host."""
import getpass
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

DIRECTORY = Path('/etc/trustguard-deepseek')
DROPIN = Path('/etc/systemd/system/trustguard-api.service.d/40-deepseek.conf')


def save(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(data.encode())
        tmp.flush()
        os.fsync(tmp.fileno())
    os.replace(tmp.name, path)


def main():
    if os.geteuid() != 0 or sys.argv[1:] not in (['store'], ['activate']):
        sys.exit('Run as root with store or activate.')
    os.umask(0o077)
    DIRECTORY.mkdir(mode=0o700, exist_ok=True)
    path = DIRECTORY / 'api.key'
    if sys.argv[1] == 'store':
        if not sys.stdin.isatty():
            sys.exit('Use an interactive SSH terminal.')
        key = getpass.getpass('DeepSeek API Key (hidden): ').strip()
        if not re.fullmatch(r'[!-~]{8,4096}', key):
            sys.exit('Invalid key format.')
        save(path, key)
        print('Credential stored on the server.')
        return
    if not path.is_file() or path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        sys.exit('Secure credential file required.')
    DROPIN.parent.mkdir(mode=0o755, exist_ok=True)
    save(DROPIN, '[Service]\nLoadCredential=deepseek.key:/etc/trustguard-deepseek/api.key\n'
         'Environment=DEEPSEEK_API_KEY_FILE=%d/deepseek.key\nEnvironment=TRUSTGUARD_AI_ENABLED=true\n'
         'Environment=TRUSTGUARD_AI_ALLOW_REAL_DATA=false\nEnvironment=DEEPSEEK_MODEL=deepseek-flash\n'
         'Environment=TRUSTGUARD_AI_DAILY_LIMIT=10\n')
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'restart', 'trustguard-api'], check=True)
    print('Credential installed for trustguard-api. No model call was made.')


if __name__ == '__main__':
    main()
