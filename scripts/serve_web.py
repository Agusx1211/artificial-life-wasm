#!/usr/bin/env python3
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
import sys
from threading import Thread


ROOT_DIR = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT_DIR / "web"


class IsolatedRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Origin-Agent-Cluster", "?1")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    https_port = int(sys.argv[2]) if len(sys.argv) > 2 else 8443
    cert_path = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    key_path = Path(sys.argv[4]) if len(sys.argv) > 4 else None
    handler = partial(IsolatedRequestHandler, directory=str(WEB_DIR))
    http_server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    http_server.daemon_threads = True
    servers = [http_server]

    if cert_path and key_path:
        https_server = ThreadingHTTPServer(("0.0.0.0", https_port), handler)
        https_server.daemon_threads = True

        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(certfile=str(cert_path), keyfile=str(key_path))
        https_server.socket = ssl_context.wrap_socket(
            https_server.socket,
            server_side=True,
        )
        servers.append(https_server)

    print(f"Serving {WEB_DIR} on http://0.0.0.0:{port}/")
    if len(servers) > 1:
        print(f"Serving {WEB_DIR} on https://0.0.0.0:{https_port}/")

    for server in servers[1:]:
        Thread(target=server.serve_forever, daemon=True).start()

    try:
        http_server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
