import json
from frappe.model.document import Document
from quest_automations.chatgpt_connection import require_owner
from quest_automations.core import ai_contract as contract
from quest_automations.protected_changes import is_internal_change

class QuestAICapability(Document):
    def validate(self):
        require_owner()
        contract.require(isinstance(self.capability_key, str) and contract.KEY.fullmatch(self.capability_key), 'Use a lowercase capability key with letters, digits, underscores or hyphens.')
        definition = contract.definition({key:self.get(key) for key in contract.DEFINITION_FIELDS})
        previous = self.get_doc_before_save()
        if self.is_new():
            self.published_revision = 0
            self.published_definition = ''
            self.last_published_at = None
        elif previous:
            contract.require(self.capability_key == previous.capability_key, 'Capability keys cannot be changed.')
            if not is_internal_change():
                for key in ('published_revision','published_definition','last_published_at'):
                    contract.require(self.get(key) == previous.get(key), 'Use Publish to change the live capability.')
        self.input_schema = contract.encoded(definition['input_schema'])
        self.output_schema = contract.encoded(definition['output_schema'])
        if self.sample_input:
            sample = contract.parsed(self.sample_input, 'Sample input')
            contract.validate_value(sample, definition['input_schema'])
            self.sample_input = contract.encoded(sample)
        published = json.loads(self.published_definition)['definition'] if self.published_definition else None
        self.status = 'Published' if published == definition else 'Unpublished changes' if published else 'Draft'
