"""Live, data-only drafting policy. Transport and approval remain compiled code."""
import hashlib
import json
from urllib.parse import urlsplit
import frappe
from .chatgpt_connection import require_owner, credentials
from .core import chatgpt

DOCTYPE = 'Quest Followup Playbook'
FIELDS = ('instructions', 'booking_url', 'signature', 'review_intro')
DEFAULTS = {
    'instructions': "Write a warm, concise email. If they still want to meet, help them reschedule. Ask a useful question when context is missing. Draft a commercial proposal only when CRM evidence establishes enough scope. Respect requests not to be contacted.",
    'booking_url': 'https://questmediahub.com/schedule',
    'signature': 'Best regards,\nJoseph\nQuest Media Hub',
    'review_intro': 'A cancelled meeting needs your review. Read the context, edit the email if needed, then approve the exact message.'
}

def validate(values):
    if not isinstance(values, dict) or set(values) - set(FIELDS):
        raise ValueError('Use only the supported playbook fields.')
    result = {key: values.get(key, DEFAULTS[key]) for key in FIELDS}
    for key, maximum in [('instructions', 8000), ('booking_url', 500), ('signature', 1000), ('review_intro', 1000)]:
        if not isinstance(result[key], str) or len(result[key]) > maximum or not result[key].strip():
            raise ValueError('Provide a valid ' + key.replace('_', ' ') + '.')
        result[key] = result[key].strip()
    url = urlsplit(result['booking_url'])
    if url.scheme != 'https' or not url.hostname or url.username or url.password or '\n' in result['booking_url'] or '\r' in result['booking_url']:
        raise ValueError('The booking link must be an HTTPS URL without credentials.')
    return result

def snapshot(values):
    values = validate(values)
    digest = hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()[:16]
    return {**values, 'revision': digest}

def current():
    require_owner()
    doc = frappe.get_single(DOCTYPE)
    return snapshot({key: doc.get(key) or DEFAULTS[key] for key in FIELDS})

@frappe.whitelist(methods=['POST'])
def preview(values, scenario):
    """Unsaved-policy sandbox: AI only; no meeting, task, notification or send."""
    require_owner()
    if isinstance(values, str):
        values = json.loads(values)
    if not isinstance(scenario, str) or not scenario.strip() or len(scenario) > 12000:
        frappe.throw('Provide a test scenario under 12,000 characters.')
    try:
        policy = snapshot(values)
    except ValueError as error:
        frappe.throw(str(error))
    bundle, model = credentials()
    context = {'test_scenario': scenario, 'booking_page': policy['booking_url'], 'signature': policy['signature']}
    return {'draft': chatgpt.generate(bundle, model, context, guidance=policy['instructions']),
            'revision': policy['revision'], 'model': model, 'sent': False}
