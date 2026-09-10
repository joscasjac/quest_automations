"""Bounded HTTP transport with DNS pinning and no redirect following."""
import http.client
import ipaddress
import json
import os
import socket
import ssl
from urllib.parse import urlsplit, quote
from .definition import DefinitionError


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, port, address):
        super().__init__(host, port, timeout=20, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address, self.port), timeout=self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


def request(url, method='POST', headers=None, body=None, trusted=False, raw_body=None):
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.fragment or not parsed.hostname:
        raise DefinitionError('Use a URL without embedded credentials or a fragment')
    local_test = os.environ.get('AUTOMATIONS_ALLOW_LOCAL_TEST_HTTP') == '1'
    if parsed.scheme != 'https' and not (local_test and parsed.scheme == 'http'):
        raise DefinitionError('Webhook destinations must use HTTPS')
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
    address = addresses[0][4][0]
    if not trusted:
        for item in addresses:
            ip = ipaddress.ip_address(item[4][0])
            if not ip.is_global and not (local_test and ip.is_loopback):
                raise DefinitionError('Webhook destination must resolve to a public address')
    connection = PinnedHTTPS(parsed.hostname, port, address) if parsed.scheme == 'https' else http.client.HTTPConnection(address, port, timeout=20)
    payload = raw_body if raw_body is not None else json.dumps(body, allow_nan=False).encode() if body is not None else None
    outgoing_headers = {'Accept': 'application/json', **(headers or {})}
    if payload is not None:
        outgoing_headers.setdefault('Content-Type', 'application/json')
    # Set the original host while connecting to the checked address.
    outgoing_headers['Host'] = parsed.netloc
    path = (parsed.path or '/') + ('?' + parsed.query if parsed.query else '')
    try:
        connection.request(method, path, payload, outgoing_headers)
        response = connection.getresponse()
        data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise RuntimeError('Response exceeds 1 MB; delivery may have succeeded')
        if not 200 <= response.status < 300:
            raise RuntimeError(f'Remote HTTP {response.status}; inspect destination before retrying')
        try:
            content = json.loads(data)
        except (ValueError, UnicodeError):
            content = data.decode('utf-8', errors='replace')
        return {'status': response.status, 'body': content}
    finally:
        connection.close()


# Frappe-hosted builds use the current site and user directly.
from ..native import erp_request,erp_method,erp_doctypes,erp_metadata,erp_email_accounts,erp_files
