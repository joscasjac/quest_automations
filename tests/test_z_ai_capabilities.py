"""Generic runner contracts across live definitions, graph execution and streams."""
import json
import sys
import types
import unittest
from contextlib import nullcontext
from unittest.mock import Mock, patch
from quest_automations.core import ai_contract as contract, chatgpt
from quest_automations.core.definition import DefinitionError, validate
from quest_automations.core.graph import preview_graph, execute_native
from quest_automations import ai_capabilities as service
from quest_automations.ai_setup import STARTERS
from test_chatgpt_followups import frappe

class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.schema=contract.object_schema({'notes':{'type':'string'},'count':{'type':'integer'}})
    def test_every_starter_validates_and_samples_match(self):
        for item in STARTERS:
            definition=contract.definition({key:item[key] for key in contract.DEFINITION_FIELDS})
            contract.validate_value(item['sample_input'],definition['input_schema'])
    def test_strict_shapes_types_enums_and_credential_keys(self):
        contract.validate_value({'notes':'hello','count':2},self.schema)
        for data in [{'notes':'x'}, {'notes':'x','count':True}, {'notes':'x','count':2,'other':'x'}, {'notes':3,'count':2}]:
            with self.subTest(data=data), self.assertRaises(DefinitionError):contract.validate_value(data,self.schema)
        for schema in [{**self.schema,'additionalProperties':True},{**self.schema,'$ref':'https://bad'},contract.object_schema({'password':{'type':'string'}}),{**self.schema,'required':[{}]}]:
            with self.subTest(schema=schema), self.assertRaises(DefinitionError):contract.schema(schema)
        with self.assertRaises(DefinitionError):contract.validate_value('other',{'type':'string','enum':['known']})
    def test_size_depth_and_finite_values_are_bounded(self):
        with self.assertRaises(DefinitionError):contract.parsed({'text':'x'*46000},'Input')
        with self.assertRaises(DefinitionError):contract.parsed({'x':float('nan')},'Input')
        with self.assertRaises(DefinitionError):contract.validate_value(list(range(101)),{'type':'array','items':{'type':'integer'}})
        node={'type':'string'}
        for _ in range(7):node=contract.object_schema({'next':node})
        with self.assertRaises(DefinitionError):contract.schema(node)

class GenericStreamTests(unittest.TestCase):
    def test_generic_output_is_not_forced_into_cancellation_shape(self):
        output={'summary':'Decision recorded.','action_items':['Share assets.']}
        schema=contract.object_schema({'summary':{'type':'string'},'action_items':{'type':'array','items':{'type':'string'}}})
        response=Mock(status_code=200)
        response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.iter_lines.return_value=[b'data: '+json.dumps({'type':'response.output_text.delta','delta':json.dumps(output)}).encode(), b'data: '+json.dumps({'type':'response.completed','response':{'output':[]}}).encode()]
        with patch.object(chatgpt.requests,'post',return_value=response) as post:
            self.assertEqual(chatgpt.structured({'access_token':'test'},'chosen-model',{'notes':'quoted'},'Summarize',schema),output)
            request=post.call_args.kwargs['json']
            self.assertEqual(request['text']['format']['schema'],schema)
            self.assertEqual(request['tools'],[])
            self.assertFalse(request['store'])
            self.assertNotIn('max_output_tokens',request)
        with self.assertRaises(chatgpt.ConnectionError):chatgpt.parse_object('[]')

class GraphAITests(unittest.TestCase):
    def workflow(self):return {'schemaVersion':2,'name':'AI demo','triggers':[{'id':'manual','kind':'manual'}],'steps':[{'kind':'run_ai_capability','label':'Summarize','configJson':json.dumps({'capability':'meeting-summary','input':{'notes':{'$ref':'trigger.notes'}}})}]}
    def test_preview_never_runs_ai_and_live_action_preserves_typed_inputs(self):
        graph=self.workflow()
        with patch.object(service,'execute',return_value={'data':{'summary':'yes'}}) as execute:
            preview=preview_graph(graph,{'notes':'Quoted'})
            self.assertEqual(preview['status'],'succeeded');execute.assert_not_called()
            result=execute_native(graph['steps'][0],{'trigger':{'notes':'Quoted'},'steps':{}},'run','step')
            execute.assert_called_once_with({'capability':'meeting-summary','input':{'notes':'Quoted'}},'run','step')
            self.assertEqual(result['data']['summary'],'yes')
    def test_customer_email_after_ai_requires_human_review(self):
        graph=self.workflow();email={'kind':'send_email','label':'Email','to':'prospect@example.com','subject':'Draft','body':'{{steps.step_0.data.summary}}'}
        graph['steps'].append(email)
        with self.assertRaisesRegex(DefinitionError,'human review'):validate(graph)
        email['to']='joseph@questmediahub.com';validate(graph)
        email['cc']='prospect@example.com'
        with self.assertRaises(DefinitionError):validate(graph)
    def test_unknown_action_options_are_rejected(self):
        graph=self.workflow();graph['steps'][0]['configJson']=json.dumps({'capability':'meeting-summary','input':{},'tools':['send_email']})
        with self.assertRaises(DefinitionError):validate(graph)

class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.owner=patch.object(service,'frappe',frappe);self.owner.start();self.addCleanup(self.owner.stop)
        self.require=patch.object(service,'require_owner');self.require.start();self.addCleanup(self.require.stop)
        self.definition=contract.definition({key:STARTERS[0][key] for key in contract.DEFINITION_FIELDS})
        self.output={'summary':'Synthetic summary','decisions':[],'action_items':['Share assets'],'open_questions':[]}
        self.doc=types.SimpleNamespace(name='run-one',status='Queued',model='',capability='meeting-summary',
            capability_revision=1,definition_hash=contract.fingerprint(self.definition),definition_snapshot=contract.encoded(self.definition),input_json=contract.encoded({'notes':'quoted'}),output_json='',save=Mock(),check_permission=Mock())
        self.capability=types.SimpleNamespace(name='meeting-summary',enabled=1,published_definition=contract.encoded({'revision':1,'definition':self.definition}),check_permission=Mock())
        self.patches=[patch.object(service,'save'),patch.object(service,'credentials',return_value=({},'chosen-model')),
                      patch.object(service.chatgpt,'structured',return_value=self.output),patch.object(frappe,'db',Mock(),create=True),
                      patch.object(frappe,'cache',types.SimpleNamespace(lock=lambda *a,**k:nullcontext()),create=True)]
        self.started=[p.start() for p in self.patches]
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
    def test_perform_validates_output_and_replay_does_not_call_model(self):
        result=service.perform(self.doc)
        self.assertEqual(result['data'],self.output)
        self.assertEqual(self.doc.model,'chosen-model')
        service.perform(self.doc)
        service.chatgpt.structured.assert_called_once()
        self.assertIn('untrusted evidence',service.chatgpt.structured.call_args.args[3])
    def test_invalid_output_and_provider_error_are_saved_without_downstream_effects(self):
        for error in [None,RuntimeError('secret-provider-response')]:
            self.doc.status='Queued'
            service.chatgpt.structured.side_effect=error
            service.chatgpt.structured.return_value={'unexpected':'x'}
            with self.assertRaises(DefinitionError):service.perform(self.doc)
            self.assertEqual(self.doc.status,'Failed');self.assertNotIn('secret-provider-response',self.doc.notice)
    def test_unpublished_disabled_bad_input_and_revision_mismatch_do_not_call_provider(self):
        config={'capability':'meeting-summary','input':{'notes':'quoted'}}
        frappe.db.exists.return_value=False
        with patch.object(frappe,'get_doc',return_value=self.capability,create=True):
            for change in [{'enabled':0},{'published_definition':''}]:
                with patch.multiple(self.capability,**change),self.assertRaises(DefinitionError):service.execute(config,'wf','step')
            for bad in [{**config,'input':{'other':'x'}},{**config,'revision':99}]:
                with self.assertRaises(DefinitionError):service.execute(bad,'wf','step')
        service.chatgpt.structured.assert_not_called()
    def test_existing_run_identity_rejects_changed_input(self):
        frappe.db.exists.return_value=True
        with patch.object(frappe,'get_doc',return_value=self.doc,create=True),self.assertRaisesRegex(DefinitionError,'different input'):
            service.execute({'capability':'meeting-summary','input':{'notes':'different'}},'wf','step')
    def test_test_mode_only_enqueues_debug_job_and_deduplicates(self):
        frappe.db.exists.return_value=False
        with patch.object(service,'new_run',return_value=self.doc) as create,patch.object(frappe,'enqueue',create=True) as enqueue:
            result=service.test('',self.definition,{'notes':'quoted'},'test-request-123')
            self.assertTrue(result['test_only']);self.assertEqual(create.call_args.args[5],'Test')
            enqueue.assert_called_once();service.chatgpt.structured.assert_not_called()
            frappe.db.exists.return_value=True
            with patch.object(frappe,'get_doc',return_value=self.doc,create=True):
                self.doc.capability=None
                service.test('',self.definition,{'notes':'quoted'},'test-request-123')
                enqueue.assert_called_once()
    def test_protected_history_rejects_forged_json_flags(self):
        from quest_automations.quest_automations.doctype.quest_ai_run.quest_ai_run import QuestAIRun
        with patch('quest_automations.quest_automations.doctype.quest_ai_run.quest_ai_run.require_owner'):
            with self.assertRaises(DefinitionError):QuestAIRun.validate(types.SimpleNamespace(flags={'internal_change':True}))


class PublishingTests(unittest.TestCase):
    def setUp(self):
        self.definition=contract.definition({key:STARTERS[0][key] for key in contract.DEFINITION_FIELDS})
        self.doc=types.SimpleNamespace(modified='2026-10-15 10:00:00',published_definition='',published_revision=0,
            get=lambda key:self.definition[key],check_permission=Mock())
    def test_publish_rejects_stale_edits_and_snapshots_saved_definition(self):
        with patch.object(service,'require_owner'),patch.object(service,'frappe',frappe),patch.object(frappe,'get_doc',return_value=self.doc,create=True),patch.object(service,'save'):
            with self.assertRaisesRegex(DefinitionError,'changed'):service.publish('summary','stale')
            first=service.publish('summary',self.doc.modified)
            self.assertEqual(first['revision'],1)
            self.assertEqual(json.loads(self.doc.published_definition)['definition'],self.definition)
            second=service.publish('summary',self.doc.modified)
            self.assertTrue(second['unchanged']);self.assertEqual(second['revision'],1)
    def test_runner_access_requires_owner(self):
        from quest_automations.chatgpt_connection import require_owner
        from test_chatgpt_followups import frappe as auth_frappe
        with patch.object(auth_frappe.session,'user','other-manager@example.com'),self.assertRaises(PermissionError):require_owner()
    def test_capability_publication_cannot_be_forged_through_document_fields(self):
        from quest_automations.quest_automations.doctype.quest_ai_capability.quest_ai_capability import QuestAICapability
        values={**self.definition,'capability_key':'meeting-summary','published_revision':99,'published_definition':'forged','last_published_at':None}
        previous=types.SimpleNamespace(capability_key='meeting-summary',get=lambda key:0 if key=='published_revision' else '')
        doc=types.SimpleNamespace(capability_key='meeting-summary',get=lambda key:values[key],is_new=lambda:False,get_doc_before_save=lambda:previous)
        with self.assertRaisesRegex(DefinitionError,'Publish'):QuestAICapability.validate(doc)
