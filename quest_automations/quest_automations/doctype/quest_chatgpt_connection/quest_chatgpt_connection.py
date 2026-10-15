import frappe
from frappe.model.document import Document

class QuestChatGPTConnection(Document):
    def validate(self):
        from quest_automations.chatgpt_connection import require_owner
        require_owner()
        from quest_automations.protected_changes import is_internal_change
        if not is_internal_change():
            frappe.throw('Use the connection buttons to change ChatGPT settings.')
