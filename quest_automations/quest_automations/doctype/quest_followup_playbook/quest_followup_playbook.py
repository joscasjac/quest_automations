import frappe
from frappe.model.document import Document
from quest_automations.followup_playbook import FIELDS, validate
from quest_automations.chatgpt_connection import require_owner

class QuestFollowupPlaybook(Document):
    def validate(self):
        require_owner()
        try:
            values = validate({key: self.get(key) for key in FIELDS})
        except ValueError as error:
            frappe.throw(str(error))
        for key, value in values.items():
            self.set(key, value)
