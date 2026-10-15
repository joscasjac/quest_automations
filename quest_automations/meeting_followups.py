"""Cancellation drafts, contextual AI and explicit, transactional human approval."""
import hashlib
import html
import json
import frappe
from .chatgpt_connection import OWNER, require_owner, credentials
from .core import chatgpt

DOCTYPE = 'Quest Meeting Followup'
SENDER = 'notifications@noreply.questmediahub.com'

def save_internal(doc):
    from .protected_changes import internal_change
    with internal_change():
        doc.save()

def meeting_current(doc):
    event = frappe.get_doc('Event', doc.event)
    event.check_permission('read')
    uid = event.get('custom_cal_booking_uid')
    matches = uid == doc.booking_uid if uid else '<p>Booking: ' + doc.booking_uid + '</p>' in (event.description or '')
    if not matches or event.status != 'Cancelled':
        frappe.throw('This cancellation is no longer current. Review the meeting before following up.')
    return event

def recipient_for(event):
    if event.reference_doctype not in ('CRM Lead', 'Contact') or not event.reference_docname:
        frappe.throw('The meeting must link to a CRM Lead or Contact.')
    person = frappe.get_doc(event.reference_doctype, event.reference_docname)
    person.check_permission('read')
    if event.reference_doctype == 'CRM Lead':
        address = person.email
    else:
        emails = person.get('email_ids') or []
        primary = [row.email_id for row in emails if row.is_primary]
        addresses = list(dict.fromkeys(row.email_id for row in emails if row.email_id))
        address = primary[0] if len(primary) == 1 else addresses[0] if len(addresses) == 1 else ''
    from frappe.utils import validate_email_address
    address = validate_email_address(address or '', throw=True).strip().lower()
    if address == OWNER or address == 'joscasjac24@gmail.com' or address.endswith('@questmediahub.com'):
        frappe.throw('Internal bookings do not receive customer cancellation follow-ups.')
    return address, person

def queue_draft(name):
    frappe.enqueue('quest_automations.meeting_followups.generate_draft', name=name, queue='long',
                   timeout=240, enqueue_after_commit=True, job_id='quest-followup:' + name, deduplicate=True)

def create_task(doc):
    url = frappe.utils.get_url('/app/quest-meeting-followup/' + doc.name)
    task = frappe.get_doc({'doctype': 'CRM Task', 'title': 'Review cancelled meeting: ' + doc.booking_uid,
        'assigned_to': OWNER, 'status': 'Todo', 'priority': 'Medium',
        'reference_doctype': 'Event', 'reference_docname': doc.event,
        'description': '<p>Review the meeting context and proposed follow-up. Send only after Joseph approves.</p><p><a href="' + html.escape(url, quote=True) + '">Review follow-up</a></p>'}).insert()
    doc.task = task.name
    save_internal(doc)

def context_for(doc, event, person):
    context = {'recipient': doc.recipient, 'cancellation_reason': doc.cancellation_reason,
               'meeting': {'id': event.name, 'subject': event.subject, 'starts_on': str(event.starts_on),
                           'description': str(event.description or '')[:12000]},
               'crm': {key: person.get(key) for key in ('doctype', 'name', 'first_name', 'last_name', 'full_name', 'organization', 'status', 'job_title')}}
    filters = {'reference_doctype': event.reference_doctype, 'reference_docname': event.reference_docname}
    context['notes'] = frappe.get_list('FCRM Note', filters=filters, fields=['name', 'title', 'content'], order_by='modified desc', limit_page_length=12)
    context['notes'] = [{**n, 'content': str(n.get('content') or '')[:5000]} for n in context['notes']]
    if frappe.db.exists('DocType', 'Quest Website Inquiry'):
        context['inquiries'] = frappe.get_list('Quest Website Inquiry', filters={'email': doc.recipient},
            fields=['name', 'project_type', 'message', 'company'], order_by='creation desc', limit_page_length=3)
        context['inquiries'] = [{**q, 'message': str(q.get('message') or '')[:5000]} for q in context['inquiries']]
    # Cap the total context while preserving the meeting, person and newest notes.
    while len(json.dumps(context, default=str)) > 45000 and context['notes']:
        context['notes'].pop()
    return context

def generate_draft(name):
    frappe.set_user(OWNER)
    with frappe.cache.lock('quest-followup:' + name, timeout=300, blocking_timeout=1):
        doc = frappe.get_doc(DOCTYPE, name)
        if doc.status not in ('Waiting for ChatGPT', 'Draft failed'):
            return
        try:
            bundle, model = credentials()
            event = meeting_current(doc)
            address, person = recipient_for(event)
            if address != doc.recipient:
                frappe.throw('CRM email changed. Review the cancellation record before generating a draft.')
            context = context_for(doc, event, person)
            draft = chatgpt.generate(bundle, model, context)
            doc.reload()
            meeting_current(doc)
            if doc.status not in ('Waiting for ChatGPT', 'Draft failed'):
                return
            doc.model = model
            doc.recommendation = draft['recommendation']
            doc.rationale = draft['rationale']
            doc.subject = draft['subject']
            doc.body = draft['body']
            doc.evidence = '\n'.join(draft['evidence'])
            doc.status = 'No follow-up' if draft['recommendation'] == 'no_follow_up' else 'Needs review'
            doc.last_error = ''
            save_internal(doc)
            url = frappe.utils.get_url('/app/quest-meeting-followup/' + name)
            message = '<p>A meeting was cancelled. A follow-up task and AI recommendation are ready.</p>'
            message += '<p><b>Recommended next step:</b> ' + html.escape(draft['recommendation']) + '</p><p>' + html.escape(draft['rationale']) + '</p>'
            message += '<p><b>To:</b> ' + html.escape(address) + '<br><b>Subject:</b> ' + html.escape(doc.subject) + '</p>'
            message += '<div style="white-space:pre-wrap">' + html.escape(doc.body) + '</div>'
            message += '<p><a href="' + html.escape(url, quote=True) + '">Review draft and approve sending</a></p><p>Opening this link does not send the email.</p>'
            frappe.sendmail(recipients=[OWNER], sender=SENDER, subject='Review cancellation follow-up: ' + event.subject[:90],
                message=message, reference_doctype=DOCTYPE, reference_name=name, delayed=True)
            doc.notification_queued = 1
            save_internal(doc)
        except Exception as error:
            frappe.db.rollback()
            doc = frappe.get_doc(DOCTYPE, name)
            if doc.status in ('Waiting for ChatGPT', 'Draft failed'):
                doc.status = 'Waiting for ChatGPT' if isinstance(error, chatgpt.ConnectionError) and 'Connect ChatGPT' in str(error) else 'Draft failed'
                doc.last_error = str(error)[:300] if isinstance(error, chatgpt.ConnectionError) else 'Draft could not be prepared. Review CRM permissions, meeting state and email settings; nothing was sent.'
                save_internal(doc)
            # No raw provider errors or CRM context in logs or error snapshots.

def draft_hash(doc):
    return hashlib.sha256(json.dumps([doc.recipient, doc.subject, doc.body, doc.recommendation], ensure_ascii=False).encode()).hexdigest()

@frappe.whitelist(methods=['POST'])
def review(name):
    require_owner()
    doc = frappe.get_doc(DOCTYPE, name)
    doc.check_permission('read')
    return {'recipient': doc.recipient, 'subject': doc.subject, 'body': doc.body, 'hash': draft_hash(doc),
            'can_send': doc.status == 'Needs review' and doc.recommendation != 'no_follow_up'}

@frappe.whitelist(methods=['POST'])
def approve_and_send(name, expected_hash):
    require_owner()
    # Database lock makes approval, communication and queued mail one transaction.
    frappe.db.sql('select name from `tabQuest Meeting Followup` where name=%s for update', (name,))
    doc = frappe.get_doc(DOCTYPE, name)
    doc.check_permission('write')
    if doc.status == 'Queued':
        return {'status': 'Queued', 'communication': doc.sent_communication}
    if doc.status != 'Needs review' or doc.recommendation == 'no_follow_up':
        frappe.throw('This draft is not available for sending.')
    if not (doc.subject or '').strip() or not (doc.body or '').strip():
        frappe.throw('The approved email needs a subject and message.')
    import hmac
    if not hmac.compare_digest(draft_hash(doc), str(expected_hash)):
        frappe.throw('The draft changed. Review the current recipient and message again.')
    event = meeting_current(doc)
    address, _ = recipient_for(event)
    if address != doc.recipient:
        frappe.throw('The CRM email changed. Review the recipient before approving.')
    if not frappe.db.exists('Email Account', {'email_id': SENDER, 'enable_outgoing': 1}):
        frappe.throw('The notifications email account must be enabled before sending.')
    body = '<div style="white-space:pre-wrap">' + html.escape(doc.body) + '</div>'
    communication = frappe.get_doc({'doctype': 'Communication', 'communication_type': 'Communication',
        'communication_medium': 'Email', 'sent_or_received': 'Sent', 'subject': doc.subject,
        'content': body, 'sender': SENDER, 'recipients': doc.recipient,
        'reference_doctype': event.reference_doctype, 'reference_name': event.reference_docname}).insert()
    frappe.sendmail(recipients=[doc.recipient], sender=SENDER, subject=doc.subject, message=body,
        communication=communication.name, reference_doctype=DOCTYPE, reference_name=name, delayed=True)
    doc.status = 'Queued'
    doc.sent_communication = communication.name
    doc.approved_by = OWNER
    doc.approved_at = frappe.utils.now_datetime()
    save_internal(doc)
    if doc.task:
        task = frappe.get_doc('CRM Task', doc.task)
        task.status = 'Done'
        task.save()
    return {'status': 'Queued', 'communication': communication.name}

@frappe.whitelist(methods=['POST'])
def dismiss(name):
    require_owner()
    frappe.db.sql('select name from `tabQuest Meeting Followup` where name=%s for update', (name,))
    doc = frappe.get_doc(DOCTYPE, name)
    if doc.status == 'Queued':
        frappe.throw('This message has already been queued.')
    doc.status = 'Dismissed'
    save_internal(doc)
    if doc.task:
        task = frappe.get_doc('CRM Task', doc.task)
        task.status = 'Done'
        task.save()
    return {'status': 'Dismissed'}

@frappe.whitelist(methods=['POST'])
def retry_pending(name=None):
    require_owner()
    filters = {'status': ['in', ['Waiting for ChatGPT', 'Draft failed']]}
    if name:
        filters['name'] = name
    rows = frappe.get_list(DOCTYPE, filters=filters, pluck='name', limit_page_length=20)
    for identifier in rows:
        queue_draft(identifier)
    return {'queued': len(rows)}
