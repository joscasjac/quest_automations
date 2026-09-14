"""Hourly Fireflies import. Runs as the workflow publisher; no elevated CRM writes."""
from datetime import datetime, timedelta, timezone
import hashlib
import html
import json
import re
import frappe
from .core.definition import DefinitionError

SETTINGS = 'Fireflies CRM Settings'
RECEIPT = 'Fireflies Meeting Sync'
QUERY = '''query Meetings($from: DateTime!, $to: DateTime!, $skip: Int!) {
 transcripts(fromDate: $from, toDate: $to, limit: 50, skip: $skip) {
  id title date organizer_email participants transcript_url
  meeting_attendees { name email }
  summary { overview action_items }
 }
}'''


def email(value):
    value = str(value or '').strip().lower()
    return value if re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', value) else ''


def iso(value):
    parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise DefinitionError('Fireflies start time must include a timezone')
    return parsed.astimezone(timezone.utc)


def externals(meeting, domains, internal_emails):
    internal = set(internal_emails)
    attendees = {}
    for row in meeting.get('meeting_attendees') or []:
        address = email(row.get('email'))
        if address:
            attendees[address] = str(row.get('name') or '').strip()
    for value in meeting.get('participants') or []:
        address = email(value)
        if address:
            attendees.setdefault(address, '')
    def external(address):
        host = address.rsplit('@', 1)[1]
        return address not in internal and not any(host == d or host.endswith('.' + d) for d in domains)
    return [{'email': a, 'name': n} for a, n in sorted(attendees.items()) if external(a)]


def tasks_from_summary(value):
    """Preserve provider prose; never infer an owner or a deadline from names."""
    text = str(value or '').strip()
    if not text:
        return []
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    bullets = [re.sub(r'^(?:[-*•]|\d+[.)])\s+', '', line) for line in lines
               if re.match(r'^(?:[-*•]|\d+[.)])\s+', line)]
    # Unstructured/owner-grouped prose stays together as a review task.
    return list(dict.fromkeys(bullets)) if bullets else [text]


def require_access():
    if frappe.session.user == 'Guest' or 'System Manager' not in frappe.get_roles():
        frappe.throw('System Manager access is required', frappe.PermissionError)


def find_reference(person, owner, lead_status):
    contacts = frappe.get_list('Contact', filters=[['Contact Email', 'email_id', '=', person['email']]],
                               fields=['name'], distinct=True, limit_page_length=2)
    leads = frappe.get_list('CRM Lead', filters={'email': person['email']}, fields=['name'], limit_page_length=2)
    if len(contacts) > 1 or len(leads) > 1:
        raise DefinitionError('Multiple CRM records match an attendee; resolve duplicates before retrying')
    if contacts:
        contact = contacts[0]['name']
        deals = frappe.get_list('CRM Deal', filters=[['CRM Contacts', 'contact', '=', contact]],
                                fields=['name'], distinct=True, limit_page_length=2)
        if len(deals) == 1:
            return ('CRM Deal', deals[0]['name']), False
        return ('Contact', contact), False
    if leads:
        return ('CRM Lead', leads[0]['name']), False
    parts = (person['name'] or person['email'].split('@')[0]).split(maxsplit=1)
    lead = frappe.get_doc({'doctype': 'CRM Lead', 'first_name': parts[0],
                           'last_name': parts[1] if len(parts) > 1 else '', 'email': person['email'],
                           'status': lead_status, 'lead_owner': owner}).insert()
    return ('CRM Lead', lead.name), True


def sync_meeting(meeting, settings, internal_emails):
    identifier = str(meeting.get('id') or '')
    if not identifier or len(identifier) > 200:
        raise DefinitionError('Fireflies returned an invalid meeting ID')
    receipt_name = 'FF-' + hashlib.sha256(identifier.encode()).hexdigest()[:40]
    if frappe.db.exists(RECEIPT, receipt_name):
        return {'duplicate': 1}
    domains = [d.strip().lower() for d in settings.internal_domains.splitlines() if d.strip()]
    people = externals(meeting, domains, internal_emails)
    summary = meeting.get('summary') or {}
    if people and not (summary.get('overview') or summary.get('action_items')):
        return {'awaiting_summary': 1}
    if not meeting.get('meeting_attendees') and not meeting.get('participants'):
        return {'missing_attendees': 1}
    actions = tasks_from_summary(summary.get('action_items'))
    if len(people) > 50 or len(actions) > 50:
        raise DefinitionError('Meeting exceeds 50 external attendees or action items; review manually')
    frappe.db.savepoint('fireflies_meeting')
    try:
        receipt = frappe.get_doc({'doctype': RECEIPT, 'meeting_id': identifier,
                                   'meeting_title': str(meeting.get('title') or 'Meeting')[:140],
                                   'status': 'Skipped internal' if not people else 'Synced'})
        receipt.insert(set_name=receipt_name)
        refs, lead_count, note_ids, task_ids = [], 0, [], []
        for person in people:
            ref, created = find_reference(person, settings.task_owner, settings.lead_status)
            lead_count += int(created)
            if ref not in refs:
                refs.append(ref)
        if refs:
            title = str(meeting.get('title') or 'Meeting')
            content = '<p><strong>Fireflies meeting:</strong> ' + html.escape(title) + '</p>'
            content += '<p>Recording: ' + html.escape(str(meeting.get('transcript_url') or '')) + '</p>'
            content += '<p>Meeting ID: ' + html.escape(identifier) + '</p>'
            content += '<pre>' + html.escape(str(summary.get('overview') or '')) + '</pre>'
            content += '<h4>Action items</h4><pre>' + html.escape(str(summary.get('action_items') or '')) + '</pre>'
            content += '<p>External attendees: ' + html.escape(', '.join(p['email'] for p in people)) + '</p>'
            for doctype, name in refs:
                note = frappe.get_doc({'doctype': 'FCRM Note', 'title': ('Meeting: ' + title)[:140],
                                        'content': content, 'reference_doctype': doctype, 'reference_docname': name}).insert()
                note_ids.append(note.name)
            # Shared meeting tasks are created once, linked to a deterministic primary reference.
            primary = sorted(refs, key=lambda r: (r[0] != 'CRM Deal', r[0], r[1]))[0]
            for action in actions:
                task = frappe.get_doc({'doctype': 'CRM Task', 'title': action[:140],
                                        'description': '<pre>' + html.escape(action) + '</pre><p>From meeting: ' + html.escape(title) + '</p>',
                                        'status': 'Todo', 'priority': 'Medium', 'assigned_to': settings.task_owner,
                                        'reference_doctype': primary[0], 'reference_docname': primary[1]}).insert()
                task_ids.append(task.name)
        receipt.result_json = json.dumps({'references': refs, 'notes': note_ids, 'tasks': task_ids})
        receipt.save()
        return {'synced': int(bool(refs)), 'internal': int(not people), 'leads': lead_count,
                'notes': len(note_ids), 'tasks': len(task_ids)}
    except Exception:
        frappe.db.rollback(save_point='fireflies_meeting')
        raise


def sync(config):
    require_access()
    settings = frappe.get_single(SETTINGS)
    settings.check_permission('write')
    if not settings.enabled:
        raise DefinitionError('Enable and configure Fireflies CRM Settings before publishing')
    if not settings.internal_domains or not settings.task_owner or not settings.start_after or not settings.lead_status:
        raise DefinitionError('Complete internal domains, task owner, lead status and start time in Fireflies CRM Settings')
    token = settings.get_password('api_key', raise_exception=False)
    if not token:
        raise DefinitionError('Configure the Fireflies API key in Fireflies CRM Settings')
    start = iso(settings.start_after)
    now = datetime.now(timezone.utc)
    if start > now:
        raise DefinitionError('Fireflies start time cannot be in the future')
    window = json.loads(settings.scan_window or '{}')
    if not window:
        # Seven-day overlap catches asynchronously generated summaries. Receipt IDs deduplicate rescans.
        previous = iso(settings.last_scan_end) if settings.last_scan_end else start
        window = {'from': max(start, previous - timedelta(days=7)).isoformat(), 'to': now.isoformat(), 'skip': 0}
    from .core.transport import request
    response = request('https://api.fireflies.ai/graphql', headers={'Authorization': 'Bearer ' + token},
                       body={'query': QUERY, 'variables': window})['body']
    if not isinstance(response, dict) or response.get('errors') or not isinstance((response.get('data') or {}).get('transcripts'), list):
        raise DefinitionError('Fireflies API did not return meetings; check API access and quota')
    meetings = response['data']['transcripts']
    if len(meetings) > 50:
        raise DefinitionError('Fireflies returned more meetings than requested')
    internal = {email(u.get('email') or u['name']) for u in frappe.get_list('User',
                filters={'enabled': 1, 'user_type': 'System User'}, fields=['name', 'email'], limit_page_length=10000)}
    counts = {}
    for meeting in meetings:
        for key, value in sync_meeting(meeting, settings, internal).items():
            counts[key] = counts.get(key, 0) + value
    if len(meetings) == 50:
        window['skip'] += 50
        settings.scan_window = json.dumps(window)
    else:
        settings.scan_window = ''
        settings.last_scan_end = window['to']
    settings.save()
    return {'meetings_checked': len(meetings), 'more_pages_pending': len(meetings) == 50, **counts}
