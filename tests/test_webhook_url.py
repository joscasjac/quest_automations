import json
import types
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import Mock, patch
from test_native import frappe
from quest_automations import api


class UnifiedWebhookTests(unittest.TestCase):
    def setUp(self):
        self.store=Mock()
        self.store.hook_secret.side_effect=lambda workflow,trigger:'test-secret' if trigger.startswith('test:') else 'live-secret'
        self.store.workflow.return_value={'draft':{'schemaVersion':2,'triggers':[{'id':'fireflies','kind':'incoming_webhook'}]}}
        self.store.sample.return_value={'listening':False,'sample':None}
        self.store.capture.return_value={'captured':True}
        self.store.enqueue.return_value={'id':'run-1','status':'queued'}
        self.request=Mock(method='POST')
        self.request.get_data.return_value=b'{"event":"meeting.summarized","meeting_id":"m-1"}'
        self.headers={}
        self.local=types.SimpleNamespace(response=types.SimpleNamespace(http_status_code=200))
        self.patches=[patch.object(api,'Store',return_value=self.store),
            patch.object(frappe,'utils',types.SimpleNamespace(get_url=lambda:'https://erp.example.com'),create=True),
            patch.object(frappe,'request',self.request,create=True),
            patch.object(frappe,'get_request_header',side_effect=lambda k:self.headers.get(k),create=True),
            patch.object(frappe,'local',self.local,create=True),
            patch.object(frappe,'db',Mock(),create=True),
            patch('quest_automations.jobs.wake')]
        for p in self.patches:p.start()
        self.addCleanup(lambda:[p.stop() for p in reversed(self.patches)])
    def details(self):
        return api.dispatch('api/v1/workflows/wf-1/webhook?triggerId=fireflies')
    def post_url(self,url):
        return api.webhook(**{k:v[0] for k,v in parse_qs(urlsplit(url).query).items()})
    def test_same_url_captures_then_runs_without_headers(self):
        details=self.details()
        self.assertEqual(details['url'],details['testUrl'])
        self.assertNotIn('test=',details['url'])
        self.store.sample.return_value={'listening':True}
        self.assertEqual(self.post_url(details['url']),{'captured':True})
        self.store.enqueue.assert_not_called()
        self.store.sample.return_value={'listening':False}
        self.assertEqual(self.post_url(details['url']),{'runId':'run-1','status':'queued'})
        self.store.enqueue.assert_called_once()
    def test_missing_or_wrong_token_never_captures_or_enqueues(self):
        for token in (None,'wrong'):
            self.assertEqual(api.webhook('wf-1','fireflies',token=token),{'error':'Invalid webhook secret'})
            self.assertEqual(self.local.response.http_status_code,401)
        self.store.sample.assert_not_called();self.store.enqueue.assert_not_called()
    def test_existing_production_header_still_works(self):
        self.headers['X-Automation-Secret']='live-secret'
        self.assertEqual(api.webhook('wf-1','fireflies')['status'],'queued')
    def test_legacy_test_header_only_captures(self):
        self.headers['X-Automation-Secret']='test-secret'
        self.assertEqual(api.webhook('wf-1','fireflies',test='1'),{'captured':True})
        self.store.enqueue.assert_not_called()
    def test_test_query_cannot_change_new_url_credential(self):
        self.store.sample.return_value={'listening':True}
        self.assertEqual(api.webhook('wf-1','fireflies',token='live-secret',test='1'),{'captured':True})
        self.store.hook_secret.assert_called_once_with('wf-1','fireflies')
    def test_token_is_scoped_to_trigger(self):
        self.store.hook_secret.return_value='unused'
        self.store.hook_secret.side_effect=lambda workflow,trigger:'different-trigger-secret'
        self.assertIn('error',api.webhook('wf-1','other',token='live-secret'))
        self.store.enqueue.assert_not_called()
    def test_malformed_or_non_object_payload_never_enqueues(self):
        for payload in (b'not json',b'[]'):
            self.request.get_data.return_value=payload
            self.assertIn('error',api.webhook('wf-1','fireflies',token='live-secret'))
        self.store.enqueue.assert_not_called()
    def test_oversized_payload_rejected(self):
        self.request.get_data.return_value=b' '*(1024*1024+1)
        self.assertIn('error',api.webhook('wf-1','fireflies',token='live-secret'))
        self.store.enqueue.assert_not_called()
    def test_payload_dedup_key_unchanged(self):
        self.post_url(self.details()['url'])
        first=self.store.enqueue.call_args.args[2]
        self.post_url(self.details()['url'])
        self.assertEqual(first,self.store.enqueue.call_args.args[2])
    def test_expired_listener_does_not_allow_draft_execution(self):
        from quest_automations.core.definition import DefinitionError
        self.store.enqueue.side_effect=DefinitionError('Workflow must be published and active')
        self.assertIn('published and active',self.post_url(self.details()['url'])['error'])
        self.store.capture.assert_not_called()
