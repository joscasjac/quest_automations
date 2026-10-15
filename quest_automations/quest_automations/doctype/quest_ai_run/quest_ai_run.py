from frappe.model.document import Document
from quest_automations.chatgpt_connection import require_owner
from quest_automations.core.definition import require
from quest_automations.protected_changes import is_internal_change

class QuestAIRun(Document):
    def validate(self):
        require_owner()
        require(is_internal_change(), 'AI run history is maintained by the runner and cannot be edited directly.')
