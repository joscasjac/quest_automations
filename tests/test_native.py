"""Adapter contract tests; real Frappe installation smoke test is also required."""
import sys,types,unittest,json
from unittest.mock import Mock,patch
frappe=types.ModuleType('frappe');frappe.whitelist=lambda **kw:lambda fn:fn
frappe.as_json=lambda v:json.dumps(v,default=str)
frappe.session=types.SimpleNamespace(user='manager@example.com')
frappe.PermissionError=PermissionError
frappe.get_roles=lambda:['System Manager']
frappe.throw=lambda msg,*args:(_ for _ in ()).throw(PermissionError(msg))
sys.modules['frappe']=frappe
from quest_automations import native,api
from quest_automations.core.graph import execute_native

class NativeTests(unittest.TestCase):
    def test_guest_cannot_use_editor_api(self):
        with patch.object(frappe.session,'user','Guest'),self.assertRaises(PermissionError):api.require_access()
    def test_reader_cannot_use_editor_api(self):
        with patch.object(frappe,'get_roles',return_value=['Accounts User']),self.assertRaises(PermissionError):api.require_access()
    def test_get_document_checks_read_permission(self):
        doc=Mock();doc.as_dict.return_value={'name':'T-1'}
        with patch.object(frappe,'get_doc',return_value=doc,create=True):
            self.assertEqual(native.erp_request('Task','T-1'),{'name':'T-1'});doc.check_permission.assert_called_once_with('read')
    def test_update_keeps_normal_validation(self):
        doc=Mock()
        with patch.object(frappe,'get_doc',return_value=doc,create=True):
            native.erp_request('Task','T-1',{'subject':'Example'});doc.check_permission.assert_called_once_with('write');doc.save.assert_called_once_with()
    def test_email_uses_current_site_account(self):
        with patch.object(frappe,'get_list',return_value=[{'email_id':'sender@example.com'}],create=True),patch.object(frappe,'get_attr',return_value=Mock(return_value={'name':'COMM-1'}),create=True) as resolve:
            output=execute_native({'kind':'send_email','sender':'sender@example.com','to':'recipient@example.com','subject':'Test','body':'Body'},{'trigger':{},'steps':{}},'run','step')
            self.assertEqual(output,{'name':'COMM-1'});resolve.assert_called_once_with('frappe.core.doctype.communication.email.make')
    def test_js_runs_in_packaged_layout(self):
        from quest_automations.core.javascript import execute_code
        self.assertEqual(execute_code('return {value: input.value * 2};',{'trigger':{'value':3},'steps':{}}),{'value':6})

if __name__=='__main__':unittest.main()

class StoreContractTests(unittest.TestCase):
    def setUp(self):
        import copy
        from quest_automations import store
        self.module=store;self.data={}
        def put(name,kind,value,parent=None):self.data[name]=(kind,copy.deepcopy(value),parent)
        def load(name,lock=False):return copy.deepcopy(self.data[name][1])
        def names(kind,filters=None,order='modified desc',limit=200):
            return [name for name,(k,v,p) in self.data.items() if k==kind and (not filters or all((p if f=='parent_record' else v.get(f))==expected for f,expected in filters.items()))][:limit or None]
        db=Mock();db.exists.side_effect=lambda dt,name:name in self.data
        db.get_value.side_effect=lambda dt,name,field,**kw: 'configured-secret' if field=='secret' else json.dumps(self.data[name][1]) if field=='payload' and name in self.data else self.data[name][0] if name in self.data else None
        self.patches=[patch.object(store,'put',side_effect=put),patch.object(store,'load',side_effect=load),patch.object(store,'names',side_effect=names),patch.object(frappe,'db',db,create=True),patch.object(frappe,'delete_doc',side_effect=lambda dt,name,**kw:self.data.pop(name,None),create=True)]
        for p in self.patches:p.start()
        self.store=store.Store()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
    def definition(self):return {'schemaVersion':2,'name':'Native test','triggers':[{'id':'manual','kind':'manual'}],'steps':[{'kind':'log','label':'Log','message':'Hello'}]}
    def test_save_publish_and_event_deduplication(self):
        row=self.store.save(self.definition());self.store.publish(row['id'],row['revision'])
        first=self.store.enqueue(row['id'],{'name':'Example'},'event-1','manual','manual')
        second=self.store.enqueue(row['id'],{'name':'Example'},'event-1','manual','manual')
        self.assertEqual(first['id'],second['id']);self.assertEqual(first['run_as'],'manager@example.com')
        self.assertEqual(len(self.store.runs(row['id'])),1)
    def test_revision_conflict_preserves_draft(self):
        from quest_automations.core.definition import DefinitionError
        row=self.store.save(self.definition())
        with self.assertRaises(DefinitionError):self.store.save({**self.definition(),'name':'Conflict'},row['id'],999)
        self.assertEqual(self.store.workflow(row['id'])['draft']['name'],'Native test')
    def test_published_snapshot_survives_later_edits(self):
        row=self.store.save(self.definition());self.store.publish(row['id'],1)
        self.store.save({**self.definition(),'name':'Edited draft'},row['id'],1)
        run=self.store.enqueue(row['id'],{},'event','manual','manual')
        self.assertEqual(run['definition']['name'],'Native test')

    def test_empty_action_draft_is_saved_but_cannot_publish(self):
        from quest_automations.core.definition import DefinitionError
        row=self.store.save({**self.definition(),'steps':[]})
        self.assertEqual(row['draft']['steps'],[])
        with self.assertRaises(DefinitionError):self.store.publish(row['id'],1)
    def test_delete_workflow_removes_all_children_and_secret_record(self):
        row=self.store.save(self.definition());identifier=row['id']
        for kind in ('Run','Sample','Schedule','Version'):
            self.module.put(kind,kind,{'id':kind,'status':'queued'},identifier)
        result=self.store.delete(identifier,1)
        self.assertTrue(result['deleted']);self.assertEqual(self.data,{})
    def test_delete_trigger_invalidates_secret_and_cleans_pending_data(self):
        from quest_automations.core.definition import DefinitionError
        d=self.definition();d['triggers'].append({'id':'hook','kind':'incoming_webhook'})
        row=self.store.save(d);identifier=row['id'];self.store.publish(identifier,1)
        run=self.store.enqueue(identifier,{},'event','incoming_webhook','hook')
        self.store.listen(identifier,'hook')
        self.module.put(self.module.identity('schedule',identifier,'hook'),'Schedule',{'trigger_id':'hook'},identifier)
        self.store.delete_trigger(identifier,'hook',1)
        self.assertEqual(self.store.run(run['id'])['status'],'canceled')
        self.assertFalse(self.store.sample(identifier,'hook')['listening'])
        self.assertNotIn(self.module.identity('sample',identifier,'hook'),self.data)
        self.assertNotIn(self.module.identity('schedule',identifier,'hook'),self.data)
        self.assertEqual([t['id'] for t in self.store.workflow(identifier)['published']['triggers']],['manual'])
        with self.assertRaises(DefinitionError):self.store.hook_secret(identifier,'hook')
        with self.assertRaises(DefinitionError):self.store.hook_secret(identifier,'test:hook')
    def test_delete_last_trigger_pauses_published_workflow(self):
        row=self.store.save(self.definition());self.store.publish(row['id'],1)
        result=self.store.delete_trigger(row['id'],'manual',1)
        self.assertEqual(result['draft']['triggers'],[])
        self.assertEqual(result['status'],'paused');self.assertIsNone(result['published'])
    def test_stale_delete_does_not_remove_records(self):
        from quest_automations.core.definition import DefinitionError
        row=self.store.save(self.definition())
        with self.assertRaises(DefinitionError):self.store.delete(row['id'],999)
        self.assertIn(row['id'],self.data)

    def test_reusing_deleted_trigger_id_does_not_restore_old_secret(self):
        d=self.definition();d['triggers'].append({'id':'hook','kind':'incoming_webhook'})
        row=self.store.save(d);identifier=row['id']
        with patch.object(frappe,'get_doc',return_value=Mock(get_password=Mock(return_value='test-root-secret')),create=True):
            old=self.store.hook_secret(identifier,'hook')
            self.store.delete_trigger(identifier,'hook',1)
            self.store.save(d,identifier,2)
            self.assertNotEqual(old,self.store.hook_secret(identifier,'hook'))

    def test_event_chain_prevents_self_and_cross_workflow_loops(self):
        from quest_automations.core.definition import DefinitionError
        row=self.store.save(self.definition());self.store.publish(row['id'],1)
        with self.assertRaises(DefinitionError):
            self.store.enqueue(row['id'],{},'self','manual','manual',ancestry=[row['id']])
        with self.assertRaises(DefinitionError):
            self.store.enqueue(row['id'],{},'cycle','manual','manual',ancestry=[row['id'],'another-workflow'])
        run=self.store.enqueue(row['id'],{},'allowed','manual','manual',ancestry=['upstream'])
        self.assertEqual(run['ancestry'],['upstream'])
        self.assertEqual(len(self.store.runs(row['id'])),1)

    def test_event_chain_depth_is_bounded_but_payload_cannot_spoof_it(self):
        from quest_automations.core.definition import DefinitionError
        row=self.store.save(self.definition());self.store.publish(row['id'],1)
        with self.assertRaises(DefinitionError):
            self.store.enqueue(row['id'],{},'deep','manual','manual',ancestry=[str(i) for i in range(16)])
        run=self.store.enqueue(row['id'],{'ancestry':[row['id']]},'external','manual','manual')
        self.assertEqual(run['ancestry'],[])


class DocumentEventChainTests(unittest.TestCase):
    def test_document_event_carries_internal_chain_separately_from_payload(self):
        from quest_automations import jobs
        doc=Mock(doctype='Task')
        doc.as_dict.return_value={'doctype':'Task','name':'TASK-1','modified':'now'}
        doc.meta.fields=[];doc.get_doc_before_save.return_value=None
        definition={'triggers':[{'id':'updated','kind':'document_event','doctype':'Task','event':'on_update'}]}
        with patch.object(jobs,'names',return_value=['workflow']),patch.object(jobs,'load',return_value={'published':definition}),patch.object(frappe,'flags',types.SimpleNamespace(automation_ancestry=['upstream']),create=True),patch.object(frappe,'enqueue',create=True) as enqueue:
            jobs.document_event(doc,'on_update')
            self.assertEqual(enqueue.call_args.kwargs['ancestry'],['upstream'])
            self.assertNotIn('ancestry',enqueue.call_args.kwargs['payload'])

    def test_receiver_retains_chain_and_restores_user(self):
        from quest_automations import jobs
        trigger={'id':'updated','kind':'document_event','doctype':'Task','event':'on_update'}
        store=Mock();store.workflow.return_value={'published':{'triggers':[trigger]},'run_as':'publisher@example.com'}
        payload={'doctype':'Task','name':'TASK-1','modified':'now','event':'on_update'}
        with patch.object(jobs,'names',return_value=['workflow']),patch.object(jobs,'Store',return_value=store),patch.object(jobs,'wake'),patch.object(jobs,'_visible_event',side_effect=lambda value:value),patch.object(frappe,'get_doc',return_value=Mock(),create=True),patch.object(frappe,'set_user',create=True) as set_user:
            jobs.receive_document(payload,ancestry=['upstream'])
            self.assertEqual(store.enqueue.call_args.kwargs['ancestry'],['upstream'])
            self.assertEqual(set_user.call_args.args,('manager@example.com',))


class EventPayloadPrivacyTests(unittest.TestCase):
    def test_event_and_previous_snapshots_are_filtered_for_run_user(self):
        from quest_automations import jobs
        docs=[]
        def document(values):
            doc=Mock();doc.meta.fields=[types.SimpleNamespace(fieldtype='Password',fieldname='secret')]
            def filtered():
                doc.as_dict.return_value={k:v for k,v in values.items() if k!='restricted'}
            doc.apply_fieldlevel_read_permissions.side_effect=filtered
            docs.append(doc);return doc
        payload={'doctype':'Task','name':'T-1','modified':'now','restricted':'hidden','secret':'never',
                 'event':'on_update','previous':{'doctype':'Task','name':'T-1','restricted':'old hidden','subject':'Before'}}
        with patch.object(frappe,'get_doc',side_effect=document,create=True):
            result=jobs._visible_event(payload)
        self.assertNotIn('restricted',result);self.assertNotIn('secret',result)
        self.assertNotIn('restricted',result['previous'])
        self.assertEqual(result['previous']['subject'],'Before')
        self.assertEqual(result['event'],'on_update')
        self.assertTrue(all(doc.apply_fieldlevel_read_permissions.called for doc in docs))


class NativeBoundaryTests(unittest.TestCase):
    def test_framework_flags_and_metadata_never_reach_document_factory(self):
        from quest_automations.core.definition import DefinitionError
        for key in ('flags','ignore_permissions','doctype','owner','docstatus'):
            with patch.object(frappe,'get_doc',create=True) as get_doc:
                with self.assertRaises(DefinitionError):
                    native.erp_request('Task',fields={key: {'ignore_permissions':True}})
                get_doc.assert_not_called()

    def test_native_read_and_update_apply_field_permissions_before_serializing(self):
        doc=Mock();doc.as_dict.return_value={'name':'TASK-1'}
        with patch.object(frappe,'get_doc',return_value=doc,create=True):
            native.erp_request('Task','TASK-1')
            doc.apply_fieldlevel_read_permissions.assert_called_once_with()
            doc.reset_mock()
            native.erp_request('Task','TASK-1',{'subject':'Allowed'})
            doc.apply_fieldlevel_read_permissions.assert_called_once_with()
