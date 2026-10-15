import json
import sys
import time
import types
import unittest
from unittest.mock import Mock, patch
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from quest_automations.core import chatgpt

frappe = types.ModuleType('frappe')
frappe.whitelist = lambda **kwargs: lambda fn: fn
frappe.session = types.SimpleNamespace(user='joseph@questmediahub.com')
frappe.PermissionError = PermissionError
frappe.get_roles = lambda: ['System Manager']
frappe.throw = lambda message, *args: (_ for _ in ()).throw(PermissionError(message))
frappe.db = Mock()
frappe.sendmail = Mock()
frappe.get_doc = Mock()
frappe.utils = types.SimpleNamespace(now_datetime=lambda: 'now')
sys.modules['frappe'] = frappe
from quest_automations import meeting_followups as followups
document_module = types.ModuleType('frappe.model.document')
document_module.Document = object
sys.modules['frappe.model.document'] = document_module
from quest_automations.quest_automations.doctype.quest_meeting_followup.quest_meeting_followup import QuestMeetingFollowup
from quest_automations.quest_automations.doctype.quest_chatgpt_connection.quest_chatgpt_connection import QuestChatGPTConnection

class ProtectedStateTests(unittest.TestCase):
    def test_json_flags_cannot_authorize_connection_changes(self):
        forged = types.SimpleNamespace(flags=types.SimpleNamespace(connection_change=True))
        with self.assertRaises(PermissionError):
            QuestChatGPTConnection.validate(forged)

    def test_json_flags_cannot_approve_or_change_recipient(self):
        previous = types.SimpleNamespace(get=lambda field: 'Needs review')
        forged = types.SimpleNamespace(flags=types.SimpleNamespace(automation_change=True),
            get_doc_before_save=lambda: previous, is_new=lambda: False,
            meta=types.SimpleNamespace(fields=[types.SimpleNamespace(fieldname='status', label='Status', fieldtype='Select')]),
            get=lambda field: 'Queued')
        with self.assertRaises(PermissionError):
            QuestMeetingFollowup.validate(forged)

class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        claims = {'iss': chatgpt.ISSUER, 'sub': 'account-one', 'aud': 'oaiapp_quest', 'nonce': 'nonce-one', 'exp': time.time() + 300}
        self.bundle = {'client_id': 'oaiapp_quest', 'ext_agent_host_id': 'urn:uuid:cloud', 'nonce': 'nonce-one',
            'access_token': 'test-access', 'refresh_token': 'test-refresh', 'id_token': jwt.encode(claims, self.key, algorithm='RS256'),
            'scopes': list(chatgpt.SCOPES)}
        self.metadata = patch.object(chatgpt, 'request_json', return_value={'issuer': chatgpt.ISSUER, 'jwks_uri': chatgpt.ISSUER + '/jwks'})
        self.jwks = patch('jwt.PyJWKClient')
        self.metadata.start()
        self.jwks.start().return_value.get_signing_key_from_jwt.return_value = types.SimpleNamespace(key=self.key.public_key())
        self.addCleanup(self.metadata.stop)
        self.addCleanup(self.jwks.stop)

    def test_valid_signature_account_nonce_and_scopes(self):
        self.assertEqual(chatgpt.validate_registration(self.bundle, 'urn:uuid:cloud')['subject'], 'account-one')

    def test_wrong_host_nonce_account_and_audience_rejected(self):
        for update, host, subject in [({}, 'other-host', None), ({'nonce': 'wrong'}, 'urn:uuid:cloud', None), ({}, 'urn:uuid:cloud', 'other-account'), ({'client_id': 'other-client'}, 'urn:uuid:cloud', None), ({'scopes': ['openid']}, 'urn:uuid:cloud', None)]:
            with self.subTest(update=update), self.assertRaises(chatgpt.ConnectionError):
                chatgpt.validate_registration({**self.bundle, **update}, host, subject)

class StreamTests(unittest.TestCase):
    def run_stream(self, events):
        response = Mock(status_code=200)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.iter_lines.return_value = [b'data: ' + json.dumps(e).encode() for e in events]
        with patch.object(chatgpt.requests, 'post', return_value=response) as post:
            result = chatgpt.generate({'access_token': 'test'}, 'chosen-model', {'cancellation_reason': 'quoted data'})
            self.assertFalse(post.call_args.kwargs['json']['store'])
            self.assertTrue(post.call_args.kwargs['json']['stream'])
            self.assertEqual(post.call_args.kwargs['json']['model'], 'chosen-model')
            self.assertEqual(post.call_args.kwargs['json']['input'],
                [{'role': 'user', 'content': json.dumps({'cancellation_reason': 'quoted data'})}])
            self.assertNotIn('max_output_tokens', post.call_args.kwargs['json'])
            return result

    def test_partial_and_limit_failure_never_count_as_completed(self):
        for events in [[], [{'type': 'response.output_text.delta', 'delta': '{}'}], [{'type': 'response.failed'}], [{'type': 'response.incomplete'}]]:
            with self.subTest(events=events), self.assertRaises(chatgpt.ConnectionError):
                self.run_stream(events)

    def test_completed_valid_draft(self):
        draft = {'recommendation': 'clarify', 'rationale': 'Scope is unclear.', 'subject': 'A quick question', 'body': 'What would be most useful?', 'evidence': ['CRM Lead lead-one']}
        event = {'type': 'response.completed', 'response': {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(draft)}]}]}}
        self.assertEqual(self.run_stream([event]), draft)

    def test_completed_fenced_draft_is_validated(self):
        draft = {'recommendation': 'clarify', 'rationale': 'Scope is unclear.', 'subject': 'A quick question', 'body': 'What would be most useful?', 'evidence': ['CRM Lead lead-one']}
        for fence in ['```json\n', '```\n']:
            self.assertEqual(chatgpt.parse_draft(fence + json.dumps(draft) + '\n```'), draft)
        with self.assertRaises(chatgpt.ConnectionError):
            chatgpt.parse_draft('Here is a draft: ' + json.dumps(draft))

class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.doc = types.SimpleNamespace(name='followup', recipient='prospect@example.com', subject='Question', body='Hello',
            recommendation='clarify', status='Needs review', task=None, event='event-one', sent_communication=None,
            check_permission=Mock(), save=Mock(), flags=types.SimpleNamespace())
        self.event = types.SimpleNamespace(reference_doctype='CRM Lead', reference_docname='lead-one', status='Cancelled',
            custom_cal_booking_uid='uid-one', get=lambda field: 'uid-one')
        self.doc.booking_uid = 'uid-one'
        frappe.sendmail.reset_mock()
        frappe.get_doc.reset_mock()
        frappe.get_doc.side_effect = lambda *args: types.SimpleNamespace(name='comm-one', insert=lambda: types.SimpleNamespace(name='comm-one')) if isinstance(args[0], dict) else self.doc
        frappe.db.exists.return_value = True
        self.current = patch.object(followups, 'meeting_current', return_value=self.event)
        self.recipient = patch.object(followups, 'recipient_for', return_value=(self.doc.recipient, None))
        self.current.start(); self.recipient.start()
        self.addCleanup(self.current.stop); self.addCleanup(self.recipient.stop)

    def test_approval_queues_once_even_if_clicked_twice(self):
        digest = followups.draft_hash(self.doc)
        self.assertEqual(followups.approve_and_send('followup', digest)['status'], 'Queued')
        followups.approve_and_send('followup', digest)
        frappe.sendmail.assert_called_once()
        self.assertEqual(frappe.sendmail.call_args.kwargs['recipients'], ['prospect@example.com'])
        self.assertEqual(frappe.sendmail.call_args.kwargs['sender'], followups.SENDER)

    def test_stale_preview_wrong_owner_and_no_followup_cannot_send(self):
        digest = followups.draft_hash(self.doc)
        self.doc.body = 'Edited after preview'
        with self.assertRaisesRegex(PermissionError, 'draft changed'):
            followups.approve_and_send('followup', digest)
        with patch.object(frappe.session, 'user', 'another-manager@example.com'), self.assertRaises(PermissionError):
            followups.approve_and_send('followup', followups.draft_hash(self.doc))
        self.doc.recommendation = 'no_follow_up'
        with self.assertRaises(PermissionError):
            followups.approve_and_send('followup', followups.draft_hash(self.doc))
        frappe.sendmail.assert_not_called()

    def test_changed_recipient_or_meeting_blocks_send(self):
        with patch.object(followups, 'recipient_for', return_value=('changed@example.com', None)), self.assertRaisesRegex(PermissionError, 'CRM email changed'):
            followups.approve_and_send('followup', followups.draft_hash(self.doc))
        with patch.object(followups, 'meeting_current', side_effect=PermissionError('no longer current')), self.assertRaises(PermissionError):
            followups.approve_and_send('followup', followups.draft_hash(self.doc))
        frappe.sendmail.assert_not_called()

if __name__ == '__main__':
    unittest.main()
