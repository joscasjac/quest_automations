"""Visual graph behavior using native record operations at the boundary."""
import json
from copy import deepcopy
from pathlib import Path
from unittest import TestCase
from unittest.mock import Mock, patch
from test_native import frappe
from quest_automations.core.graph import process, validate_graph, preview_graph, render
from quest_automations.core.definition import DefinitionError
from quest_automations import native_actions

class VisualGraphTests(TestCase):
    def run_flow(self,definition,payload,records=None,fail_task=False):
        records=deepcopy(records or []);initial=deepcopy(records);db=Mock();db.rollback.side_effect=lambda **kw:records.__setitem__(slice(None),deepcopy(initial))
        def search(config):
            return [{k:r.get(k) for k in config['fields']} for r in records if r['doctype']==config['doctype'] and all(r.get(f)==v for f,op,v in config['filters'])]
        def write(doctype,name=None,fields=None,action=None):
            if doctype=='CRM Task' and fail_task:raise ValueError('Task rejected')
            doc={'doctype':doctype,**fields,'name':'new-'+str(len(records))};records.append(doc);return doc
        run={'id':'test','definition':definition,'input':payload,'outputs':{},'logs':[],'cursor':0,'status':'running'}
        validate_graph(definition)
        with patch.object(frappe,'db',db,create=True),patch.object(native_actions,'find_documents',side_effect=search),patch('quest_automations.core.engine.erp_request',side_effect=write):process(run)
        return run,records,db
    def workflow(self):return json.loads((Path(__file__).parents[1]/'examples/fathom-visual-workflow.json').read_text())
    def payload(self):return {'recording_id':123,'title':'Meeting <x>','url':'https://fathom.video/share/example','calendar_invitees':[{'name':'Ada Client','email':'ada@client.test'},{'name':'Owner','email':'owner@example.com'}],'default_summary':{'markdown_formatted':'Summary <script>'},'action_items':[{'description':'Send proposal','completed':False},{'description':'Already done','completed':True}]}
    def test_new_lead_note_and_task_use_same_record(self):
        run,docs,db=self.run_flow(self.workflow(),self.payload());self.assertEqual(run['status'],'succeeded',run.get('error'));self.assertEqual([r['doctype'] for r in docs],['CRM Lead','FCRM Note','CRM Task'])
        self.assertEqual(docs[0]['email'],'ada@client.test');self.assertEqual(docs[1]['reference_docname'],docs[0]['name']);self.assertEqual(docs[2]['reference_docname'],docs[0]['name']);self.assertIn('&lt;script&gt;',docs[1]['content']);db.rollback.assert_not_called()
    def test_contact_then_existing_lead_then_new_lead(self):
        p=self.payload();p['calendar_invitees']=[{'email':'contact@client.test'},{'email':'lead@client.test'},{'email':'new@client.test'}]
        existing=[{'doctype':'Contact Email','parenttype':'Contact','parent':'C1','email_id':'contact@client.test'},{'doctype':'CRM Lead','name':'L1','email':'lead@client.test'}]
        run,docs,_=self.run_flow(self.workflow(),p,existing);self.assertEqual(run['status'],'succeeded',run.get('error'))
        notes=[r for r in docs if r['doctype']=='FCRM Note'];self.assertEqual(len(notes),3);self.assertEqual([r['reference_docname'] for r in notes[:2]],['C1','L1']);self.assertEqual(len([r for r in docs if r['doctype']=='CRM Lead']),2)
    def test_duplicate_delivery_and_internal_meeting_write_nothing(self):
        p=self.payload();_,docs,_=self.run_flow(self.workflow(),p);run,again,_=self.run_flow(self.workflow(),p,docs);self.assertEqual(run['status'],'succeeded');self.assertEqual(docs,again)
        p['calendar_invitees_domains_type']='only_internal';run,docs,_=self.run_flow(self.workflow(),p);self.assertEqual(docs,[])
    def test_duplicate_attendees_actions_and_contact_links(self):
        p=self.payload();p['calendar_invitees']*=2;p['action_items']*=2
        run,docs,_=self.run_flow(self.workflow(),p);self.assertEqual(len(docs),3)
        p['calendar_invitees']=[{'email':'a@client.test'},{'email':'b@client.test'}];existing=[{'doctype':'Contact Email','parenttype':'Contact','parent':'C1','email_id':e} for e in ['a@client.test','b@client.test']]
        run,docs,_=self.run_flow(self.workflow(),p,existing);self.assertEqual(len([r for r in docs if r['doctype']=='FCRM Note']),1)
    def test_failure_rolls_back_lead_note_and_outputs(self):
        run,docs,db=self.run_flow(self.workflow(),self.payload(),fail_task=True);self.assertEqual(run['status'],'failed');self.assertEqual(docs,[]);self.assertEqual(run['outputs'],{});self.assertEqual(run['cursor'],0);db.rollback.assert_called_once();self.assertIn('rolled_back',[l['status'] for l in run['logs']])
    def test_ambiguous_match_fails_without_creating_records(self):
        existing=[{'doctype':'CRM Lead','name':n,'email':'ada@client.test'} for n in ['L1','L2']]
        run,docs,_=self.run_flow(self.workflow(),self.payload(),existing);self.assertEqual(run['status'],'failed');self.assertEqual(docs,existing)
    def test_empty_actions_and_missing_optional_summary(self):
        p=self.payload();p['action_items']=[];run,docs,_=self.run_flow(self.workflow(),p);self.assertEqual(run['status'],'succeeded');self.assertEqual(len(docs),2)
        p=self.payload();p.pop('default_summary');run,docs,_=self.run_flow(self.workflow(),p);self.assertEqual(run['status'],'succeeded');self.assertEqual(len(docs),3)
    def test_invalid_lists_and_unready_content_fail(self):
        for key,value in [('calendar_invitees','bad'),('action_items','bad')]:
            p=self.payload();p[key]=value;run,docs,_=self.run_flow(self.workflow(),p);self.assertEqual(run['status'],'failed');self.assertEqual(docs,[])
        p=self.payload();p['action_items']=[];p.pop('default_summary');run,docs,_=self.run_flow(self.workflow(),p);self.assertEqual(run['status'],'failed')
    def test_loop_limits_boundaries_and_transaction_validation(self):
        d=self.workflow();d['steps']=[{'kind':'end_loop','label':'End'}]
        with self.assertRaises(DefinitionError):validate_graph(d)
        d=self.workflow();d['steps'].insert(1,{'kind':'wait','label':'Wait','durationMinutes':1})
        with self.assertRaises(DefinitionError):validate_graph(d)
        p=self.payload();p['calendar_invitees']=[{'email':f'a{i}@client.test'} for i in range(51)];run,docs,_=self.run_flow(self.workflow(),p);self.assertEqual(run['status'],'failed');self.assertEqual(docs,[])
    def test_preview_never_reads_or_writes_native_records(self):
        with patch.object(native_actions,'find_documents') as search,patch('quest_automations.core.engine.erp_request') as write:
            result=preview_graph(self.workflow(),{'calendar_invitees_domains_type':'only_internal'})
        self.assertEqual(result['status'],'succeeded');search.assert_not_called();write.assert_not_called()
    def test_item_and_shared_field_references_keep_types(self):
        self.assertEqual(render({'$ref':'items.attendee.email'},{'items':{'attendee':{'email':'a@b.test'}}}),'a@b.test')
        self.assertEqual(render({'$ref':'variables.list'},{'variables':{'list':[1,2]}}),[1,2])
    def test_external_preview_stops_before_dependent_conditions(self):
        result=preview_graph(self.workflow(),self.payload())
        self.assertEqual(result['status'],'failed')
        self.assertIn('live CRM results are unavailable',result['error'])
        self.assertNotIn('Meeting already imported',[l['label'] for l in result['steps']])
    def test_nested_repeats_collect_without_item_alias_leak(self):
        d={'schemaVersion':2,'name':'Nested repeat','triggers':[{'id':'manual','kind':'manual'}],'steps':[
            {'kind':'for_each','label':'Outer','list':'{{trigger.rows}}','itemName':'outer','maxItems':10,'collect':{'inner':'{{steps.step_1.items}}'}},
            {'kind':'for_each','label':'Inner','list':'{{items.outer.children}}','itemName':'inner','maxItems':10,'collect':{'value':'{{items.inner.value}}'}},
            {'kind':'end_loop','label':'End inner'}, {'kind':'end_loop','label':'End outer'}]}
        run,_,_=self.run_flow(d,{'rows':[{'children':[1,2]},{'children':[]},{'children':[3]}]})
        self.assertEqual(run['status'],'succeeded',run.get('error'))
        self.assertEqual(run['outputs']['step_0']['items'],[{'inner':[{'value':1},{'value':2}]},{'inner':[]},{'inner':[{'value':3}]}]);self.assertEqual(run['items'],{})
