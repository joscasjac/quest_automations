import sys
import types
import unittest
from unittest.mock import Mock, patch
from test_native import frappe

from quest_automations.core.definition import validate, DefinitionError, PULSE_ACTIONS
from quest_automations.core.engine import execute_action, preview


def workflow(kind, config):
    return {"schemaVersion": 1, "name": "Pulse automation", "trigger": {"kind": "manual"},
            "steps": [{"id": "work", "kind": kind, "config": config}]}


class PulseActionsTests(unittest.TestCase):
    def test_every_action_validates_and_previews_without_executing(self):
        for action, fields in PULSE_ACTIONS.items():
            values = {f: {"subject": "Changed"} if f == "fields" else [{"fieldname":"custom_example","show_in_form":1}] if f == "rules" else ["TASK-1"] if f == "tasks" else False if f == "is_done" else "example" for f in fields}
            result = preview(workflow(action, values), {})
            self.assertTrue(result["dryRun"])
            self.assertEqual(result["steps"][0]["kind"], action)

    def test_missing_required_values_rejected(self):
        with self.assertRaises(DefinitionError):
            validate(workflow("pulse_create_task", {"subject": "Missing project"}))

    def test_execution_delegates_to_bounded_pulse_api(self):
        module = types.ModuleType("pulse.api.automation")
        module.execute = Mock(return_value={"name": "TASK-1"})
        with patch.dict(sys.modules, {"pulse.api.automation": module}):
            result = execute_action("pulse_create_task", {"project": "PROJ-1", "subject": "Task"}, "run", "step")
        module.execute.assert_called_once_with("create_task", {"project": "PROJ-1", "subject": "Task"})
        self.assertEqual(result["name"], "TASK-1")

    def test_builder_catalog_and_dispatch_prefix_match_server_catalog(self):
        import json
        from pathlib import Path
        source = (Path(__file__).parents[1] / 'frontend/src/adapter/ErpFields.tsx').read_text()
        start = source.index('= ', source.index('const pulseActions:')) + 2
        builder = json.JSONDecoder().raw_decode(source[start:])[0]
        self.assertEqual(set(builder), set(PULSE_ACTIONS))
        for action, required in PULSE_ACTIONS.items():
            self.assertTrue(action.startswith('pulse_'), action)
            self.assertTrue(set(required).issubset(builder[action]['fields']), action)

    def test_every_action_is_usable_in_current_graph_builder(self):
        import json
        from quest_automations.core.graph import validate_graph, preview_graph
        for action, fields in PULSE_ACTIONS.items():
            values = {f: {'subject': 'Changed'} if f == 'fields' else [] if f == 'rules'
                      else ['TASK-1'] if f == 'tasks' else False if f == 'is_done' else 'example'
                      for f in fields}
            graph = {'schemaVersion': 2, 'name': 'Pulse catalog acceptance',
                     'triggers': [{'id': 'manual', 'kind': 'manual'}],
                     'steps': [{'kind': 'erpnext', 'label': action, 'operation': action,
                                'configJson': json.dumps(values)}]}
            self.assertEqual(validate_graph(graph)['steps'][0]['operation'], action)
            with patch('quest_automations.core.graph.erp_method') as send:
                result = preview_graph(graph, {})
                send.assert_not_called()
            self.assertNotEqual(result.get('status'), 'needs_attention', action)

    def test_event_presets_validate_and_completion_requires_a_transition(self):
        from quest_automations.core.pulse_events import PULSE_EVENT_PRESETS
        from quest_automations.core.graph import validate_graph, condition_matches
        for preset in PULSE_EVENT_PRESETS:
            graph = {'schemaVersion':2,'name':preset['title'],
                     'triggers':[{**preset['trigger'],'id':'event'}],
                     'steps':[{'kind':'log','label':'Observed','message':'Event received'}]}
            validate_graph(graph)
        completed = next(p for p in PULSE_EVENT_PRESETS if p['value']=='pulse_event_task_completed')['trigger']['condition']
        self.assertTrue(condition_matches(completed,{'trigger':{'status':'Completed','previous':{'status':'Working'}}}))
        self.assertFalse(condition_matches(completed,{'trigger':{'status':'Completed','previous':{'status':'Completed'}}}))
