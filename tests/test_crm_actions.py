import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from test_native import frappe

from quest_automations.core.definition import validate, DefinitionError, CRM_ACTIONS, PULSE_ACTIONS
from quest_automations.core.engine import execute_action, preview

ROOT = Path(__file__).parents[1]


def workflow(kind, config):
    return {"schemaVersion": 1, "name": "CRM automation", "trigger": {"kind": "manual"},
            "steps": [{"id": "work", "kind": kind, "config": config}]}


def sample(fields):
    return {f: "CRM Lead" if f == "doctype" else "example" for f in fields}


def stub_module(**result):
    module = types.ModuleType("crm_conversations.api.automation")
    module.execute = Mock(return_value=result)
    return module


class CrmActionsTests(unittest.TestCase):
    def test_every_action_validates_and_previews_without_executing(self):
        module = stub_module()
        with patch.dict(sys.modules, {"crm_conversations.api.automation": module}):
            for action, fields in CRM_ACTIONS.items():
                result = preview(workflow(action, sample(fields)), {})
                self.assertTrue(result["dryRun"])
                self.assertEqual(result["steps"][0]["status"], "would_execute", action)
                self.assertEqual(result["steps"][0]["kind"], action)
        module.execute.assert_not_called()

    def test_kinds_are_prefixed_and_do_not_collide(self):
        for action in CRM_ACTIONS:
            self.assertTrue(action.startswith("crm_"), action)
        self.assertFalse(set(CRM_ACTIONS) & set(PULSE_ACTIONS))
        # Existing ERPNext graph actions stay separate.
        for legacy in ("send_email", "create_note", "create_task"):
            self.assertNotIn(legacy, CRM_ACTIONS)

    def test_missing_required_values_rejected(self):
        with self.assertRaises(DefinitionError):
            validate(workflow("crm_send_whatsapp", {"doctype": "CRM Lead", "name": "LEAD-1"}))
        with self.assertRaises(DefinitionError):
            validate(workflow("crm_add_note", {"doctype": "CRM Deal", "title": "Missing record"}))

    def test_target_must_be_a_crm_lead_or_deal(self):
        with self.assertRaises(DefinitionError):
            validate(workflow("crm_add_comment", {"doctype": "Opportunity", "name": "OPP-1", "content": "Hi"}))
        validate(workflow("crm_add_comment", {"doctype": "CRM Deal", "name": "DEAL-1", "content": "Hi"}))
        # Mapped references are resolved at run time.
        validate(workflow("crm_add_comment", {"doctype": {"$ref": "trigger.doctype"}, "name": {"$ref": "trigger.name"}, "content": "Hi"}))

    def test_execution_delegates_to_crm_conversations(self):
        module = stub_module(name="WA-1", status="queued")
        config = {"doctype": "CRM Lead", "name": "LEAD-1", "message": "Hello", "phone": "+15550100"}
        with patch.dict(sys.modules, {"crm_conversations.api.automation": module}):
            result = execute_action("crm_send_whatsapp", config, "run", "step")
        module.execute.assert_called_once_with("send_whatsapp", config)
        self.assertEqual(result["name"], "WA-1")

    def test_missing_app_raises_definition_error(self):
        with patch.dict(sys.modules, {"crm_conversations": None, "crm_conversations.api": None, "crm_conversations.api.automation": None}):
            with self.assertRaisesRegex(DefinitionError, "Install CRM Conversations on this site to use CRM actions"):
                execute_action("crm_add_note", {"doctype": "CRM Lead", "name": "LEAD-1", "title": "T"}, "run", "step")

    def test_unknown_crm_kind_is_rejected(self):
        with self.assertRaises(DefinitionError):
            execute_action("crm_delete_everything", {}, "run", "step")
        with self.assertRaises(DefinitionError):
            validate(workflow("crm_delete_everything", {}))

    def test_builder_catalog_and_dispatch_prefix_match_server_catalog(self):
        builder = json.loads((ROOT / 'frontend/src/adapter/crmCatalog.json').read_text())
        self.assertEqual(set(builder), set(CRM_ACTIONS))
        for action, required in CRM_ACTIONS.items():
            self.assertEqual(list(required), builder[action]['required'], action)
            self.assertTrue(builder[action]['label'].startswith('CRM: '), action)
            self.assertFalse(set(required) & set(builder[action]['optional']), action)
            self.assertEqual(set(required) | set(builder[action]['optional']), set(builder[action]['types']), action)
        self.assertEqual(builder['crm_send_whatsapp']['label'], 'CRM: send whatsapp')
        picker = (ROOT / 'frontend/src/app/Workflows.tsx').read_text()
        self.assertIn('...CRM_ACTION_LIBRARY', picker)
        self.assertIn('if(isCrmOperation(kind))return createCrmStep(kind)', picker)
        editor = (ROOT / 'frontend/src/adapter/ErpFields.tsx').read_text()
        self.assertIn('<CrmActionFields key={operation} operation={operation}', editor)

    def test_builder_catalog_matches_crm_conversations_contract(self):
        builder = json.loads((ROOT / 'frontend/src/adapter/crmCatalog.json').read_text())
        optional = {'crm_send_whatsapp': {'phone'}, 'crm_send_sms': {'phone'},
                    'crm_send_email': {'recipients', 'cc', 'bcc', 'sender'}, 'crm_add_note': {'content'},
                    'crm_add_task': {'description', 'status', 'priority', 'due_date', 'assigned_to'},
                    'crm_add_comment': set(), 'crm_describe_operations': set(),
                    'crm_log_call': {'type', 'status', 'duration', 'phone', 'transcript', 'recording_url', 'note'},
                    'crm_get_conversation': {'limit', 'channels'}}
        self.assertEqual({k: set(v['optional']) for k, v in builder.items()}, optional)

    def test_every_action_is_usable_in_current_graph_builder(self):
        from quest_automations.core.graph import validate_graph, preview_graph
        module = stub_module()
        with patch.dict(sys.modules, {"crm_conversations.api.automation": module}):
            for action, fields in CRM_ACTIONS.items():
                values = {f: "CRM Deal" if f == "doctype" else "{{trigger.name}}" if f == "name" else "example" for f in fields}
                graph = {'schemaVersion': 2, 'name': 'CRM catalog acceptance',
                         'triggers': [{'id': 'manual', 'kind': 'manual'}],
                         'steps': [{'kind': 'erpnext', 'label': action, 'operation': action,
                                    'configJson': json.dumps(values)}]}
                self.assertEqual(validate_graph(graph)['steps'][0]['operation'], action)
                with patch('quest_automations.core.graph.erp_method') as send:
                    result = preview_graph(graph, {'name': 'DEAL-1'})
                    send.assert_not_called()
                self.assertEqual(result['status'], 'succeeded', (action, result))
                self.assertEqual(result['steps'][0]['output'], 'Preview: would execute erpnext')
        module.execute.assert_not_called()

    def test_graph_run_executes_through_delegate_with_rendered_fields(self):
        from quest_automations.core.graph import process
        module = stub_module(name="NOTE-1")
        graph = {'schemaVersion': 2, 'name': 'CRM run', 'triggers': [{'id': 'deal', 'kind': 'document_event', 'doctype': 'CRM Deal', 'event': 'on_update'}],
                 'steps': [{'kind': 'erpnext', 'label': 'Note', 'operation': 'crm_add_note',
                            'configJson': json.dumps({'doctype': 'CRM Deal', 'name': '{{trigger.name}}', 'title': 'Stage {{trigger.status}}'})}]}
        validate(graph)
        run = {'id': 'run', 'definition': graph, 'input': {'name': 'DEAL-7', 'status': 'Won'}, 'outputs': {}, 'logs': [], 'cursor': 0, 'status': 'running'}
        with patch.dict(sys.modules, {"crm_conversations.api.automation": module}):
            process(run)
        self.assertEqual(run['status'], 'succeeded', run)
        module.execute.assert_called_once_with('add_note', {'doctype': 'CRM Deal', 'name': 'DEAL-7', 'title': 'Stage Won'})

    def test_generator_reproduces_committed_catalog(self):
        sys.path.insert(0, str(ROOT / 'scripts'))
        try:
            from generate_crm_frontend_catalog import build
        finally:
            sys.path.pop(0)
        builder = json.loads((ROOT / 'frontend/src/adapter/crmCatalog.json').read_text())
        allowed = {k.removeprefix('crm_'): tuple(v['required']) + tuple(v['optional']) for k, v in builder.items()}
        self.assertEqual(build(CRM_ACTIONS, allowed), builder)
