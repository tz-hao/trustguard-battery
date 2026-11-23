"""Windows loopback SSH tunnel; use existing keys and explicitly trusted hosts."""
from __future__ import annotations

import argparse
import json
import select
import socketserver
import sys
import threading
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-directory', type=Path)
    parser.add_argument('--distribution', help='WSL distribution for a Linux --key-file path')
    parser.add_argument('--packages', type=Path)
    parser.add_argument('--known-hosts', type=Path)
    parser.add_argument('--key-file', type=Path, required=True)
    parser.add_argument('--host', required=True, help='SSH server hostname or IP address')
    parser.add_argument('--user', default='root')
    parser.add_argument('--listen-port', type=int, default=13130)
    args = parser.parse_args()
    if args.runtime_directory:
        args.packages = args.packages or args.runtime_directory / 'ssh-runtime'
        args.known_hosts = args.known_hosts or args.runtime_directory / 'trustguard-known-hosts'
    key_path = args.key_file.as_posix()
    if args.distribution and key_path.startswith('/') and not key_path.startswith('//'):
        args.key_file = Path(f'//wsl.localhost/{args.distribution}{key_path}')
    if not (args.packages and args.known_hosts):
        parser.error('provide --runtime-directory or both --packages and --known-hosts')
    if not 1024 <= args.listen_port <= 65535:
        parser.error('listen-port must be between 1024 and 65535')
    sys.path.insert(0, str(args.packages.resolve()))
    import paramiko

    class Connection:
        def __init__(self):
            self.client = None
            self.lock = threading.Lock()

        def get(self):
            with self.lock:
                if self.client:
                    transport = self.client.get_transport()
                    if transport and transport.is_active() and transport.is_authenticated():
                        return transport
                    self.client.close()
                    self.client = None
                client = paramiko.SSHClient()
                client.load_system_host_keys(str(args.known_hosts))
                client.set_missing_host_key_policy(paramiko.RejectPolicy())
                try:
                    key = paramiko.Ed25519Key.from_private_key_file(str(args.key_file))
                    client.connect(args.host, username=args.user, pkey=key,
                                   look_for_keys=False, allow_agent=False,
                                   timeout=10, auth_timeout=10, banner_timeout=10)
                    transport = client.get_transport()
                    transport.set_keepalive(30)
                except Exception:
                    client.close()
                    raise
                self.client = client
                return transport

        def close(self):
            with self.lock:
                if self.client:
                    self.client.close()
                    self.client = None

    connection = Connection()

    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            channel = None
            try:
                channel = connection.get().open_channel(
                    'direct-tcpip', ('127.0.0.1', 3100), self.client_address, timeout=15)
                self.request.settimeout(60)
                while True:
                    ready, _, _ = select.select([self.request, channel], [], [], 1)
                    if self.request in ready:
                        data = self.request.recv(65536)
                        if not data:
                            break
                        channel.sendall(data)
                    if channel in ready:
                        data = channel.recv(65536)
                        if not data:
                            break
                        self.request.sendall(data)
            except Exception as error:
                # Do not log requests, responses, keys or authentication details.
                print(json.dumps({'event': 'connection_closed', 'type': type(error).__name__}), flush=True)
            finally:
                if channel is not None:
                    channel.close()

    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    try:
        connection.get()
        with Server(('127.0.0.1', args.listen_port), Handler) as server:
            print(json.dumps({'event': 'ready', 'url': f'http://127.0.0.1:{args.listen_port}'}), flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        print(json.dumps({'event': 'startup_failed', 'type': type(error).__name__}), flush=True)
        raise SystemExit(1)
    finally:
        connection.close()


if __name__ == '__main__':
    main()
