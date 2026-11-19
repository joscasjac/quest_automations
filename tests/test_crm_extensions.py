"""The "Added from the CRM" trigger and steps, live context and exit rules other apps add.

Portable: the extension module is a fake; the real one (crm_campaigns.automation) is tested on a site."""
import json
import types
import unittest
from unittest.mock import patch

from quest_automations.core import extensions
from quest_automations.core.definition import DefinitionError
from quest_automations.core.graph import process, validate_graph


def fake_extension(stop=None):
    module = types.ModuleType('fake_crm')
    module.ACTIONS = {'crm_send_sms': {'label': 'CRM: send SMS', 'required': ['body'], 'optional': [], 'types': {'body': 'string'}}}
    module.calls = []

    def validate(operation, config):
        if not config.get('body'):
            raise ValueError('Write the SMS.')

    def execute(operation, config, context, run_id, step_id):
        module.calls.append((operation, config, step_id))
        return {'recipient': 'R-1', 'status': 'Sent'}

    def enrich(context, run):
        for key, out in run['outputs'].items():
            if isinstance(out, dict) and out.get('recipient'):
                context['steps'][key] = {**out, 'replied': True}

    module.validate, module.execute, module.enrich = validate, execute, enrich
    module.stop_reason = lambda run: stop
    module.finished = lambda run: module.calls.append(('finished', run['status']))
    return module


def definition(steps, trigger=None):
    return {'schemaVersion': 2, 'name': 'CRM flow', 'triggers': [trigger or {'id': 'crm', 'kind': 'crm', 'doctype': 'CRM Lead', 'exit': {'onReply': True}}], 'steps': steps}


SMS = {'kind': 'erpnext', 'label': 'Text them', 'operation': 'crm_send_sms', 'configJson': json.dumps({'body': 'Hola {{trigger.first_name}}, de {{ organization }}'})}


class Store:
    def __init__(self):
        self.checkpoints = []

    def checkpoint(self, run, status, delay=0, error=None):
        run['status'] = status
        self.checkpoints.append((status, error))


class CrmExtensionTests(unittest.TestCase):
    def test_crm_trigger_and_extension_step_validate(self):
        fake = fake_extension()
        with patch.object(extensions, 'modules', return_value=[fake]):
            validate_graph(definition([SMS]))
            with self.assertRaises(DefinitionError):
                validate_graph(definition([{**SMS, 'configJson': json.dumps({'body': ''})}]))
            with self.assertRaises(DefinitionError):
                validate_graph(definition([SMS], {'id': 'crm', 'kind': 'crm', 'doctype': 'Customer'}))
            with self.assertRaises(DefinitionError):
                validate_graph(definition([SMS], {'id': 'crm', 'kind': 'crm', 'doctype': 'CRM Lead', 'exit': {'onReply': 'yes'}}))
        with self.assertRaises(DefinitionError):  # without the app that provides it, the step is unknown
            validate_graph(definition([SMS]))

    def test_step_runs_with_rendered_and_raw_config_and_conditions_read_live_data(self):
        fake = fake_extension()
        steps = [SMS, {'kind': 'if_else', 'label': 'Replied?', 'branches': [{'name': 'Yes', 'field': 'steps.step_0.replied', 'operator': 'is', 'value': 'true', 'steps': [{'kind': 'log', 'label': 'Hot', 'message': 'hot'}]}], 'elseLabel': 'No', 'elseSteps': []}]
        run = {'id': 'run-1', 'definition': definition(steps), 'input': {'doctype': 'CRM Lead', 'name': 'L-1', 'first_name': 'Ana'}, 'outputs': {}, 'logs': [], 'cursor': 0, 'status': 'running'}
        with patch.object(extensions, 'modules', return_value=[fake]):
            process(run, Store())
        operation, config, step_id = fake.calls[0]
        # merge fields the run knows are filled; the record's own {{ organization }} is left for the CRM
        self.assertEqual((operation, config['body'], config['_label'], config['_raw']['body'], step_id), ('crm_send_sms', 'Hola Ana, de {{ organization }}', 'Text them', 'Hola {{trigger.first_name}}, de {{ organization }}', 'step_0'))
        self.assertEqual([l['output'] for l in run['logs'] if l['label'] == 'Replied?'], ['Yes'])
        self.assertEqual(run['status'], 'succeeded')
        self.assertEqual(fake.calls[-1], ('finished', 'succeeded'))

    def test_exit_rule_cancels_before_the_next_step(self):
        fake = fake_extension(stop='Replied')
        run = {'id': 'run-2', 'definition': definition([SMS]), 'input': {'doctype': 'CRM Lead', 'name': 'L-1'}, 'outputs': {}, 'logs': [], 'cursor': 0, 'status': 'running'}
        store = Store()
        with patch.object(extensions, 'modules', return_value=[fake]):
            process(run, store)
        self.assertEqual(store.checkpoints[-1], ('canceled', 'Replied'))
        self.assertEqual(run['exit_reason'], 'Replied')
        self.assertFalse([c for c in fake.calls if c[0] == 'crm_send_sms'])

    def test_preview_never_runs_extension_steps(self):
        fake = fake_extension()
        run = {'id': 'preview', 'definition': definition([SMS]), 'input': {'doctype': 'CRM Lead', 'name': 'L-1', 'first_name': 'Ana'}, 'outputs': {}, 'logs': [], 'cursor': 0, 'status': 'running'}
        with patch.object(extensions, 'modules', return_value=[fake]):
            process(run, preview=True)
        self.assertEqual(fake.calls, [])

    def test_sales_managers_edit_but_code_needs_system_manager(self):
        from quest_automations import api, store

        with patch.object(api.frappe, 'get_roles', return_value=['Sales Manager'], create=True), patch.object(store.frappe, 'get_roles', return_value=['Sales Manager'], create=True):
            self.assertTrue(api.has_access())
            store.check_author(definition([SMS]))
            with self.assertRaises(DefinitionError):
                store.check_author(definition([{'kind': 'custom_code', 'label': 'x', 'code': 'return 1'}]))
            with self.assertRaises(DefinitionError):
                store.check_author(definition([{'kind': 'if_else', 'label': 'b', 'branches': [{'name': 'a', 'field': 'x', 'operator': 'is', 'value': '', 'steps': [{'kind': 'api_request', 'label': 'r', 'configJson': '{}'}]}], 'elseLabel': 'e'}]))
        with patch.object(api.frappe, 'get_roles', return_value=['Sales User'], create=True):
            self.assertFalse(api.has_access())


if __name__ == '__main__':
    unittest.main()
