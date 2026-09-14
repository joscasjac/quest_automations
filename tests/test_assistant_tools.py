"""FAC-to-editor API contracts using the existing offline Frappe harness."""
import importlib
import sys
import types
import unittest
from unittest.mock import Mock, patch

from test_native import frappe, api

base = types.ModuleType("frappe_assistant_core.core.base_tool")
base.BaseTool = object
with patch.dict(sys.modules, {"frappe_assistant_core.core.base_tool": base}):
    module = importlib.import_module("quest_automations.assistant_tools.automations")


class AssistantToolsTests(unittest.TestCase):
    def setUp(self):
        self.tool = module.QuestAutomations()
        self.request = patch.object(frappe, "request", types.SimpleNamespace(method="POST"), create=True)
        self.request.start()
        self.addCleanup(self.request.stop)

    def test_create_only_saves_draft(self):
        definition = {"schemaVersion": 2}
        with patch.object(api, "Store") as store:
            store.return_value.save.return_value = {"id": "wf-1", "revision": 1}
            result = self.tool.execute({"operation": "create", "definition": definition})
            self.assertEqual(result["revision"], 1)
            store.return_value.save.assert_called_once_with(definition)
            store.return_value.publish.assert_not_called()

    def test_update_forwards_revision(self):
        with patch.object(api, "Store") as store:
            self.tool.execute({"operation": "update", "workflow_id": "wf-1", "definition": {}, "revision": 3})
            store.return_value.save.assert_called_once_with({}, "wf-1", 3)

    def test_preview_uses_saved_definition_and_sample(self):
        with patch.object(api, "Store") as store, patch.object(api, "preview", return_value={"ok": True}) as preview:
            store.return_value.workflow.return_value = {"draft": {"steps": []}}
            self.tool.execute({"operation": "test", "workflow_id": "wf-1", "input": {"title": "Meeting"}})
            preview.assert_called_once_with({"steps": []}, {"title": "Meeting"})
            store.return_value.enqueue.assert_not_called()

    def test_guest_and_non_manager_rejected_before_dispatch(self):
        for user, roles in [("Guest", ["System Manager"]), ("sales@example.com", ["Sales User"])]:
            with self.subTest(user=user), patch.object(frappe.session, "user", user), patch.object(frappe, "get_roles", return_value=roles), patch.object(api, "dispatch") as dispatch:
                with self.assertRaises(PermissionError):
                    self.tool.execute({"operation": "list"})
                dispatch.assert_not_called()

    def test_rejects_arbitrary_routes_and_missing_revision(self):
        cases = [
            {"operation": "delete"}, {"operation": "run"},
            {"operation": "get", "workflow_id": "../other"},
            {"operation": "get", "workflow_id": "wf-1?bad=1"},
            {"operation": "get", "workflow_id": "%2e%2e"},
            {"operation": "publish", "workflow_id": "wf-1"},
            {"operation": "publish", "workflow_id": "wf-1", "revision": True},
            {"operation": "list", "path": "anything"},
        ]
        for args in cases:
            with self.subTest(args=args), patch.object(api, "dispatch") as dispatch:
                with self.assertRaises(ValueError):
                    self.tool.execute(args)
                dispatch.assert_not_called()

    def test_capture_and_sample_use_selected_trigger(self):
        with patch.object(api, "Store") as store:
            self.tool.execute({"operation": "listen", "workflow_id": "wf-1", "trigger_id": "fathom"})
            store.return_value.listen.assert_called_once_with("wf-1", "fathom")
            self.tool.execute({"operation": "webhook_sample", "workflow_id": "wf-1", "trigger_id": "fireflies"})
            store.return_value.sample.assert_called_once_with("wf-1", "fireflies")

    def test_api_errors_remain_errors(self):
        with patch.object(api, "dispatch", return_value={"error": "Revision conflict: reload"}):
            self.assertIn("error", self.tool.execute({"operation": "publish", "workflow_id": "wf-1", "revision": 1}))

    def test_publish_routes_explicit_revision_and_pause_does_not_publish(self):
        with patch.object(api, "dispatch", return_value={}) as dispatch:
            self.tool.execute({"operation": "publish", "workflow_id": "wf-1", "revision": 4})
            dispatch.assert_called_once_with(path="api/v1/workflows/wf-1/publish", method="POST", body={"revision": 4})
        with patch.object(api, "Store") as store:
            self.tool.execute({"operation": "pause", "workflow_id": "wf-1"})
            store.return_value.pause.assert_called_once_with("wf-1")
            store.return_value.publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
