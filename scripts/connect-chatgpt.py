#!/usr/bin/env python3
"""One-time loopback SIWC login; protected output is imported into the private cloud agent."""
import argparse
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import secrets
import sys
import time
from urllib.parse import parse_qs, urlencode, urlsplit
import certifi

# PyJWT fetches signing keys with urllib. macOS Python installations may not
# have a system CA path; use the same maintained roots as requests, with TLS
# verification fully enabled. This only affects the local sign-in helper.
os.environ['SSL_CERT_FILE'] = certifi.where()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quest_automations.core import chatgpt

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host-id', required=True)
    parser.add_argument('--client-id', default='')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if not args.host_id.startswith('urn:uuid:'):
        raise SystemExit('Use the host ID from ERPNext ChatGPT connection settings.')
    state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
    result = {}

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # authorization codes and tokens never enter HTTP logs

        def do_GET(self):
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query)
            if parsed.path != '/auth/callback' or not secrets.compare_digest(query.get('state', [''])[0], state):
                self.send_error(400, 'Invalid sign-in callback')
                return
            if result:
                self.send_error(409, 'Sign-in already completed')
                return
            if query.get('error'):
                result['error'] = 'Sign-in was declined or not available for this account.'
            else:
                client = query.get('client_id', [args.client_id])[0]
                code = query.get('code', [''])[0]
                if not code or not client or client == 'dynamic_agent_client' or args.client_id and client != args.client_id:
                    result['error'] = 'ChatGPT returned an incomplete or mismatched registration.'
                else:
                    phase = 'code_exchange'
                    try:
                        tokens = chatgpt.request_json('POST', chatgpt.TOKEN_URL, data={
                            'grant_type': 'authorization_code', 'client_id': client, 'code': code,
                            'code_verifier': verifier, 'redirect_uri': redirect, 'resource': chatgpt.RESOURCE})
                        bundle = {**tokens, 'client_id': client, 'ext_agent_host_id': args.host_id,
                            'nonce': nonce, 'scopes': tokens.get('scope', '').split(),
                            'expires_at': time.time() + int(tokens.get('expires_in', 3600))}
                        phase = 'identity_validation'
                        bundle = chatgpt.validate_registration(bundle, args.host_id)
                        phase = 'protected_file_write'
                        target = Path(args.output)
                        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                        # Refuse overwrite; use a fresh output per sign-in attempt.
                        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                        with os.fdopen(fd, 'w') as stream:
                            json.dump(bundle, stream)
                        result['ok'] = True
                    except Exception as error:
                        print('SIGN_IN_DIAGNOSTIC=' + phase + ':' + type(error).__name__, flush=True)
                        result['error'] = 'Sign-in could not be verified or saved. Start a fresh attempt; no credentials were printed.'
            content = ('ChatGPT connection ready. Return to ERPNext and import the protected registration file.' if result.get('ok') else result['error']).encode()
            self.send_response(200 if result.get('ok') else 400)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(content)

    with HTTPServer(('127.0.0.1', 0), Callback) as server:
        redirect = 'http://127.0.0.1:%s/auth/callback' % server.server_address[1]
        parameters = {'client_id': args.client_id or 'dynamic_agent_client', 'ext_agent_host_id': args.host_id,
            'response_type': 'code', 'redirect_uri': redirect, 'scope': ' '.join(sorted(chatgpt.SCOPES)),
            'resource': chatgpt.RESOURCE, 'state': state, 'nonce': nonce, 'code_challenge_method': 'S256',
            'code_challenge': base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')}
        if not args.client_id:
            parameters['agent_name_hint'] = 'Quest Automations'
        print('SIGN_IN_URL=' + chatgpt.ISSUER + '/api/accounts/authorize?' + urlencode(parameters), flush=True)
        server.timeout = 2
        deadline = time.monotonic() + 900
        while not result and time.monotonic() < deadline:
            server.handle_request()
    if not result.get('ok'):
        raise SystemExit(result.get('error', 'Sign-in timed out.'))
    print('SIGN_IN_COMPLETE', flush=True)

if __name__ == '__main__':
    main()
