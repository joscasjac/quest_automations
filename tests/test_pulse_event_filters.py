"""Lifecycle presets must not mistake initial on_update hooks for decisions."""
from copy import deepcopy
import unittest
from quest_automations.core.pulse_events import PULSE_EVENT_PRESETS
from quest_automations.core.graph import condition_matches, validate_graph, document_fields_changed


class TestPulseLifecyclePresets(unittest.TestCase):
    def condition(self, value):
        return next(row['trigger'] for row in PULSE_EVENT_PRESETS if row['value'] == value)

    def matches(self, name, payload):
        trigger = self.condition(name)
        return document_fields_changed(trigger, payload) and (not trigger.get('condition') or condition_matches(trigger['condition'], {'trigger': payload}))

    def request(self):
        return {'doctype': 'Pulse Request', 'name': 'REQ-1', 'title': 'Initial request', 'status': 'Incoming',
                'reviewer': None, 'duplicate_of': None, 'review_note': None, 'accepted_task': None}

    def test_all_presets_remain_valid_native_graph_triggers(self):
        for preset in PULSE_EVENT_PRESETS:
            with self.subTest(preset=preset['value']):
                validate_graph({'schemaVersion': 2, 'name': 'Preset validation',
                    'triggers': [{'id': 'event', **deepcopy(preset['trigger'])}],
                    'steps': [{'kind': 'noop', 'label': 'Valid action'}]})

    def test_approval_pending_creation_and_repeated_approved_update_do_not_fire(self):
        self.assertFalse(self.matches('pulse_event_approval', {'name': 'APP-1', 'decision': 'Pending'}))
        self.assertFalse(self.matches('pulse_event_approval', {'decision': 'Pending', 'previous': {'name': 'APP-1', 'decision': 'Pending'}}))
        self.assertFalse(self.matches('pulse_event_approval', {'decision': 'Approved', 'previous': {'name': 'APP-1', 'decision': 'Approved'}}))
        self.assertFalse(self.matches('pulse_event_approval', {'decision': 'Rejected', 'previous': {'name': 'APP-1', 'decision': 'Rejected'}}))

    def test_approval_decisions_fire_only_on_pending_to_final_transition(self):
        for decision in ('Approved', 'Rejected'):
            self.assertTrue(self.matches('pulse_event_approval', {'decision': decision, 'previous': {'name': 'APP-1', 'decision': 'Pending'}}))

    def test_request_initial_insert_and_ordinary_title_update_do_not_fire(self):
        request = self.request()
        self.assertFalse(self.matches('pulse_event_request_review', request))
        request['previous'] = self.request(); request['title'] = 'Edited title'
        self.assertFalse(self.matches('pulse_event_request_review', request))
        request['review_note'] = ''
        self.assertFalse(self.matches('pulse_event_request_review', request))

    def test_request_actual_disposition_and_acceptance_fire(self):
        for status in ('Deferred', 'Rejected', 'Duplicate', 'Accepted'):
            request = self.request(); request['previous'] = self.request(); request['status'] = status
            self.assertTrue(self.matches('pulse_event_request_review', request), status)

    def test_nullable_review_fields_assignment_change_and_clear_fire(self):
        for field in ('reviewer', 'duplicate_of', 'review_note', 'accepted_task'):
            for before, after in ((None, 'new value'), ('old value', 'new value'), ('old value', None), ('old value', '')):
                request = self.request(); request['previous'] = self.request()
                request['previous'][field] = before; request[field] = after
                self.assertTrue(self.matches('pulse_event_request_review', request), (field, before, after))
            for unchanged in (None, '', 'same value'):
                request = self.request(); request['previous'] = self.request()
                request['previous'][field] = unchanged; request[field] = unchanged
                self.assertFalse(self.matches('pulse_event_request_review', request), (field, unchanged))

    def test_completed_uses_native_completed_status_and_ignores_done_repeats(self):
        self.assertTrue(self.matches('pulse_event_task_completed', {'status': 'Completed', 'workflow_state': 'Delivered', 'previous': {'status': 'Working'}}))
        self.assertFalse(self.matches('pulse_event_task_completed', {'status': 'Completed', 'previous': {'status': 'Completed'}}))
        self.assertFalse(self.matches('pulse_event_task_completed', {'status': 'Working', 'workflow_state': 'Done', 'previous': {'status': 'Open'}}))

    def test_changed_fields_validation_rejects_invalid_or_unbounded_names(self):
        from quest_automations.core.definition import DefinitionError
        for fields in ([], 'status', ['previous.status'], ['__proto__'], ['status'] * 21):
            with self.subTest(fields=fields), self.assertRaises(DefinitionError):
                validate_graph({'schemaVersion': 2, 'name': 'Invalid changed fields',
                    'triggers': [{'id': 'event', 'kind': 'document_event', 'doctype': 'Task', 'event': 'on_update', 'changedFields': fields}],
                    'steps': [{'kind': 'noop', 'label': 'Valid action'}]})
