import frappe
from frappe.model.document import Document

class QuestMeetingFollowup(Document):
    def validate(self):
        from quest_automations.chatgpt_connection import require_owner
        from quest_automations.meeting_followups import meeting_current, recipient_for
        from quest_automations.protected_changes import is_internal_change
        require_owner()
        previous = self.get_doc_before_save()
        if self.is_new():
            if not self.booking_uid or len(self.booking_uid) > 100:
                frappe.throw('Provide a valid Cal.com booking UID.')
            event = meeting_current(self)
            self.recipient, _ = recipient_for(event)
            self.status = 'Waiting for ChatGPT'
            self.subject = self.body = self.rationale = self.evidence = self.recommendation = self.model = ''
            self.playbook_snapshot = ''
            self.notification_queued = 0
            self.sent_communication = self.approved_by = self.approved_at = self.task = None
        elif not is_internal_change() and previous:
            editable = {'subject', 'body', 'modified', 'modified_by', '_user_tags', '_comments', '_assign', '_liked_by'}
            for field in self.meta.fields:
                if field.fieldtype not in ('Section Break', 'Column Break', 'Tab Break', 'HTML', 'Button') and field.fieldname not in editable:
                    current_value = self.get(field.fieldname)
                    previous_value = previous.get(field.fieldname)
                    # Link names may be numeric in the database but strings in
                    # the form payload. Compare identity without changing it.
                    if field.fieldtype == 'Link':
                        current_value = '' if current_value is None else str(current_value)
                        previous_value = '' if previous_value is None else str(previous_value)
                    if current_value != previous_value:
                        frappe.throw('Use the follow-up actions to change ' + field.label + '.')
            if previous.status != 'Needs review' and (self.subject != previous.subject or self.body != previous.body):
                frappe.throw('Only drafts awaiting review can be edited.')
        if self.subject and ('\n' in self.subject or '\r' in self.subject or len(self.subject) > 140):
            frappe.throw('Provide a single-line email subject up to 140 characters.')
        if self.body and len(self.body) > 12000:
            frappe.throw('The draft must be under 12,000 characters.')

    def after_insert(self):
        from quest_automations.meeting_followups import create_task, queue_draft
        create_task(self)
        queue_draft(self.name)
