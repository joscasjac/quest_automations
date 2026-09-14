import copy
import json
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from test_native import frappe
from quest_automations import fireflies as ff
from quest_automations.core.definition import DefinitionError, validate


class FirefliesTests(unittest.TestCase):
    def setUp(self):
        self.rows = {}
        self.fail = None
        self.matches = {}
        self.settings = types.SimpleNamespace(internal_domains='questmediahub.com',
            task_owner='joseph@questmediahub.com', lead_status='New')
        self.meeting = {'id':'m-1', 'title':'Client <script>meeting</script>',
            'organizer_email':'joseph@questmediahub.com',
            'meeting_attendees':[{'name':'Client Person','email':'client@example.org'}],
            'summary':{'overview':'Discuss <script>work</script>', 'action_items':'- Send proposal\n- Schedule review'}}
        outer = self
        class Doc:
            def __init__(self, values): self.__dict__.update(values)
            def insert(self, set_name=None):
                if self.doctype == outer.fail: raise RuntimeError('Simulated insert failure')
                self.name = set_name or str(len(outer.rows)+1)
                key = (self.doctype, self.name)
                if key in outer.rows: raise RuntimeError('Duplicate')
                outer.rows[key] = self
                return self
            def save(self): return self
        def savepoint(name): self.snapshot = copy.deepcopy(self.rows)
        def rollback(**kw): self.rows = self.snapshot
        db = Mock()
        db.exists.side_effect = lambda dt, name: (dt,name) in self.rows
        db.savepoint.side_effect = savepoint
        db.rollback.side_effect = rollback
        self.patches = [patch.object(frappe,'db',db,create=True),
            patch.object(frappe,'get_doc',side_effect=Doc,create=True),
            patch.object(frappe,'get_list',side_effect=lambda dt, **kw:self.matches.get(dt,[]),create=True)]
        for p in self.patches: p.start()
        self.addCleanup(lambda: [p.stop() for p in reversed(self.patches)])

    def run_meeting(self): return ff.sync_meeting(self.meeting,self.settings,{'joseph@questmediahub.com'})
    def docs(self, dt): return [v for (kind,_),v in self.rows.items() if kind==dt]
    def test_new_lead_notes_tasks_and_html_escape(self):
        result = self.run_meeting()
        self.assertEqual((result['leads'],result['notes'],result['tasks']), (1,1,2))
        note = self.docs('FCRM Note')[0]
        self.assertNotIn('<script>',note.content)
        self.assertEqual(note.reference_doctype,'CRM Lead')
        self.assertEqual(self.docs('CRM Task')[0].assigned_to,self.settings.task_owner)
    def test_repeated_meeting_is_noop(self):
        self.run_meeting(); count=len(self.rows)
        self.assertEqual(self.run_meeting(),{'duplicate':1})
        self.assertEqual(len(self.rows),count)
    def test_internal_domains_and_users(self):
        self.meeting['participants']=['one@questmediahub.com','two@sub.questmediahub.com','staff@gmail.com']
        self.meeting['meeting_attendees']=[]
        self.assertEqual(ff.externals(self.meeting,['questmediahub.com'],{'staff@gmail.com'}),[])
    def test_external_organizer_is_included(self):
        self.meeting['organizer_email']='client@example.org'
        self.assertEqual(self.run_meeting()['leads'],1)
    def test_unique_deal_receives_notes(self):
        self.matches={'Contact':[{'name':'C-1'}],'CRM Deal':[{'name':'D-1'}]}
        self.assertEqual(self.run_meeting()['leads'],0)
        self.assertEqual(self.docs('FCRM Note')[0].reference_docname,'D-1')
    def test_multiple_deals_fall_back_to_contact(self):
        self.matches={'Contact':[{'name':'C-1'}],'CRM Deal':[{'name':'D-1'},{'name':'D-2'}]}
        self.run_meeting()
        self.assertEqual(self.docs('FCRM Note')[0].reference_doctype,'Contact')
    def test_ambiguous_contacts_roll_back(self):
        self.matches={'Contact':[{'name':'C-1'},{'name':'C-2'}]}
        with self.assertRaises(DefinitionError): self.run_meeting()
        self.assertEqual(self.rows,{})
    def test_failed_task_rolls_back_and_retry_is_complete(self):
        self.fail='CRM Task'
        with self.assertRaises(RuntimeError): self.run_meeting()
        self.assertEqual(self.rows,{})
        self.fail=None
        self.assertEqual(self.run_meeting()['tasks'],2)
    def test_missing_summary_can_be_retried(self):
        self.meeting['summary']=None
        self.assertEqual(self.run_meeting(),{'awaiting_summary':1})
        self.assertEqual(self.rows,{})
    def test_missing_attendees_can_be_retried(self):
        self.meeting['meeting_attendees']=[]
        self.assertEqual(self.run_meeting(),{'missing_attendees':1})
        self.assertEqual(self.rows,{})
    def test_unstructured_actions_are_one_review_task(self):
        self.assertEqual(ff.tasks_from_summary('Joseph\nSend proposal tomorrow'),['Joseph\nSend proposal tomorrow'])
    def test_example_and_secret_config_rejection(self):
        definition=json.loads((Path(__file__).parent.parent/'examples/fireflies-crm.json').read_text())
        validate(definition)
        definition['steps'][0]['configJson']='{"api_key":"must-not-store-here"}'
        with self.assertRaises(DefinitionError): validate(definition)
    def test_guest_denied(self):
        with patch.object(frappe.session,'user','Guest'),self.assertRaises(PermissionError): ff.require_access()
    def test_null_api_data_does_not_advance_cursor(self):
        settings=Mock(enabled=1,internal_domains='questmediahub.com',task_owner='owner',lead_status='New',start_after='2026-01-01T00:00:00Z',scan_window='',last_scan_end='')
        settings.get_password.return_value='test-token'
        with patch.object(frappe,'get_single',return_value=settings,create=True),patch('quest_automations.core.transport.request',return_value={'body':{'data':None}}):
            with self.assertRaises(DefinitionError): ff.sync({})
        settings.save.assert_not_called()
    def test_full_page_keeps_fixed_window_for_next_run(self):
        settings=Mock(enabled=1,internal_domains='questmediahub.com',task_owner='owner',lead_status='New',start_after='2026-01-01T00:00:00Z',scan_window='',last_scan_end='')
        settings.get_password.return_value='test-token'
        with patch.object(frappe,'get_single',return_value=settings,create=True),patch('quest_automations.core.transport.request',return_value={'body':{'data':{'transcripts':[self.meeting]*50}}}),patch.object(ff,'sync_meeting',return_value={'duplicate':1}):
            self.assertTrue(ff.sync({})['more_pages_pending'])
        self.assertEqual(json.loads(settings.scan_window)['skip'],50)
        self.assertEqual(settings.last_scan_end,'')
        settings.save.assert_called_once()
