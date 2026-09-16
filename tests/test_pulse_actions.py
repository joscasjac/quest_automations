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
            values = {f: {"subject": "Changed"} if f == "fields" else "example" for f in fields}
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
