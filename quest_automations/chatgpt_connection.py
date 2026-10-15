"""Owner-scoped ChatGPT plan connection for this private ERPNext agent."""
import json
import time
import uuid
import frappe
from .core import chatgpt

OWNER = 'joseph@questmediahub.com'
CONNECTION = 'Quest ChatGPT Connection'

def require_owner():
    if frappe.session.user != OWNER or 'System Manager' not in frappe.get_roles():
        frappe.throw('Only Joseph can manage this connection and approve follow-ups.', frappe.PermissionError)

def has_permission(doc=None, ptype=None, user=None, **kwargs):
    return (user or frappe.session.user) == OWNER

def permission_query(user=None):
    return '' if (user or frappe.session.user) == OWNER else '1=0'

def save_connection(doc):
    from .protected_changes import internal_change
    with internal_change():
        doc.save()

@frappe.whitelist(methods=['POST'])
def sign_in_options():
    require_owner()
    doc = frappe.get_single(CONNECTION)
    if not doc.host_id:
        doc.host_id = 'urn:uuid:' + str(uuid.uuid4())
        doc.status = 'Disconnected'
        save_connection(doc)
    return {'host_id': doc.host_id, 'client_id': doc.client_id or '', 'account_email': doc.account_email or ''}

@frappe.whitelist(methods=['POST'])
def import_registration(registration):
    require_owner()
    if not isinstance(registration, str) or len(registration) > 50000:
        frappe.throw('Provide the protected registration file produced by the sign-in helper.')
    with frappe.cache.lock('quest-chatgpt:' + frappe.local.site, timeout=90, blocking_timeout=2):
        doc = frappe.get_single(CONNECTION)
        if not doc.host_id:
            frappe.throw('Prepare sign-in first.')
        try:
            bundle = chatgpt.validate_registration(json.loads(registration), doc.host_id, doc.account_subject, doc.client_id)
            available = chatgpt.models(bundle)
            if not available:
                raise chatgpt.ConnectionError('This account has no available ChatGPT models for the connection.')
        except (ValueError, chatgpt.ConnectionError) as error:
            frappe.throw(str(error) if isinstance(error, chatgpt.ConnectionError) else 'Invalid registration file.')
        except Exception:
            frappe.throw('Registration could not be verified. Start a fresh sign-in attempt.')
        doc.credential_bundle = json.dumps(bundle)
        doc.client_id = bundle['client_id']
        doc.account_subject = bundle['subject']
        doc.account_email = bundle['email']
        doc.model = doc.model if doc.model in [m['slug'] for m in available] else next((m['slug'] for m in available if m['slug'] == 'gpt-6.1-sol'), available[0]['slug'])
        doc.status = 'Connected'
        doc.last_error = ''
        save_connection(doc)
    return {'status': doc.status, 'account_email': doc.account_email, 'model': doc.model, 'models': available}

def credentials():
    require_owner()
    with frappe.cache.lock('quest-chatgpt:' + frappe.local.site, timeout=90, blocking_timeout=2):
        doc = frappe.get_single(CONNECTION)
        if doc.status != 'Connected':
            raise chatgpt.ConnectionError('Connect ChatGPT in Quest ChatGPT Connection first.')
        raw = doc.get_password('credential_bundle', raise_exception=False)
        if not raw:
            raise chatgpt.ConnectionError('ChatGPT credentials are missing. Reconnect.')
        bundle = json.loads(raw)
        if float(bundle.get('expires_at', 0)) <= time.time() + 120:
            bundle = chatgpt.refresh(bundle)
            doc.credential_bundle = json.dumps(bundle)
            save_connection(doc)
            # Persist rotating tokens before releasing the refresh lock.
            frappe.db.commit()
        return bundle, doc.model

@frappe.whitelist(methods=['POST'])
def available_models():
    bundle, selected = credentials()
    return {'models': chatgpt.models(bundle), 'selected': selected}

@frappe.whitelist(methods=['POST'])
def select_model(model):
    bundle, _ = credentials()
    if model not in [m['slug'] for m in chatgpt.models(bundle)]:
        frappe.throw('Choose a model available to your connected ChatGPT account.')
    doc = frappe.get_single(CONNECTION)
    doc.model = model
    save_connection(doc)
    return {'model': model}

@frappe.whitelist(methods=['POST'])
def disconnect():
    require_owner()
    confirmed = True
    with frappe.cache.lock('quest-chatgpt:' + frappe.local.site, timeout=90, blocking_timeout=2):
        doc = frappe.get_single(CONNECTION)
        raw = doc.get_password('credential_bundle', raise_exception=False)
        if raw:
            try:
                bundle = json.loads(raw)
                metadata = chatgpt.request_json('GET', chatgpt.ISSUER + '/.well-known/openid-configuration')
                from urllib.parse import urlsplit
                endpoint = metadata.get('revocation_endpoint', '')
                parsed = urlsplit(endpoint)
                if parsed.scheme != 'https' or parsed.hostname != 'auth.openai.com' or parsed.username or parsed.password:
                    raise chatgpt.ConnectionError('Unexpected revocation endpoint.')
                response = chatgpt.requests.post(endpoint, data={'token': bundle['refresh_token'], 'token_type_hint': 'refresh_token',
                    'client_id': bundle['client_id']}, timeout=30, allow_redirects=False)
                confirmed = response.status_code == 200
            except Exception:
                confirmed = False
        doc.credential_bundle = ''
        doc.status = 'Disconnected'
        doc.last_error = '' if confirmed else 'Local connection cleared. Remote revocation unconfirmed; disconnect in ChatGPT Settings.'
        save_connection(doc)
    return {'status': 'Disconnected', 'revocation_confirmed': confirmed}
