"""Real Frappe worker/record acceptance; run only in a disposable site with Pulse."""
import json
import frappe
from frappe.tests import IntegrationTestCase
from unittest.mock import patch
from quest_automations import jobs
from quest_automations.store import Store


class TestPulseWorker(IntegrationTestCase):
    def setUp(self):
        frappe.set_user('Administrator')
        self.commit = patch.object(frappe.db, 'commit'); self.commit.start(); self.addCleanup(self.commit.stop)
        self.enqueue = patch.object(frappe, 'enqueue'); self.queued = self.enqueue.start(); self.addCleanup(self.enqueue.stop)
        self.store = Store()
        self.project = frappe.get_doc({'doctype':'Project','project_name':'Worker acceptance '+frappe.generate_hash(length=8)}).insert()

    def tearDown(self):
        frappe.set_user('Administrator');frappe.db.rollback()

    def workflow(self, steps, trigger=None):
        definition={'schemaVersion':2,'name':'Pulse worker acceptance',
                    'triggers':[trigger or {'id':'manual','kind':'manual'}],'steps':steps}
        row=self.store.save(definition);self.store.publish(row['id'],row['revision']);return row['id']

    def action(self, operation, values):
        return {'kind':'erpnext','label':operation,'operation':'pulse_'+operation,'configJson':json.dumps(values)}

    def test_worker_creates_native_work_once_and_resumes_after_completed_checkpoint(self):
        workflow=self.workflow([self.action('create_task',{'project':self.project.name,'subject':'Native worker task'}),
                                self.action('update_task',{'task':'{{steps.step_0.name}}','fields':{'priority':'High'}})])
        first=self.store.enqueue(workflow,{},'one-event','manual','manual')
        self.assertEqual(first['id'],self.store.enqueue(workflow,{},'one-event','manual','manual')['id'])
        jobs.drain()
        result=self.store.run(first['id']);self.assertEqual(result['status'],'succeeded',result)
        name=result['outputs']['step_0']['name']
        self.assertEqual(frappe.get_doc('Task',name).priority,'High')
        self.assertEqual(frappe.db.count('Task',{'project':self.project.name}),1)
        # Requeueing the same delivery must return the completed history.
        self.assertEqual(self.store.enqueue(workflow,{},'one-event','manual','manual')['status'],'succeeded')
        jobs.drain();self.assertEqual(frappe.db.count('Task',{'project':self.project.name}),1)

    def test_document_events_deduplicate_and_self_trigger_chain_is_rejected(self):
        workflow=self.workflow([self.action('update_task',{'task':'{{trigger.name}}','fields':{'priority':'High'}})],
                               {'id':'updated','kind':'document_event','doctype':'Task','event':'on_update'})
        task=frappe.get_doc({'doctype':'Task','project':self.project.name,'subject':'Event loop target'}).insert()
        payload=task.as_dict();payload['event']='on_update'
        jobs.receive_document(payload);jobs.receive_document(payload)
        self.assertEqual(len(self.store.runs(workflow)),1)
        jobs.drain()
        self.assertEqual(frappe.get_doc('Task',task.name).priority,'High')
        generated=[c.kwargs for c in self.queued.call_args_list if c.args and c.args[0]=='quest_automations.jobs.receive_document' and c.kwargs.get('ancestry')]
        self.assertTrue(generated)
        for event in generated:jobs.receive_document(event['payload'],event['ancestry'])
        self.assertEqual(len(self.store.runs(workflow)),1)
        self.assertIsNone(getattr(frappe.flags,'automation_ancestry',None))

    def test_failed_action_is_visible_without_executing_later_steps(self):
        workflow=self.workflow([self.action('get_task',{'task':'missing-task-worker-test'}),
                                self.action('create_task',{'project':self.project.name,'subject':'Must not execute'})])
        run=self.store.enqueue(workflow,{},'failed-event','manual','manual');jobs.drain()
        result=self.store.run(run['id'])
        self.assertIn(result['status'],('failed','needs_attention'))
        self.assertEqual(result['logs'][-1]['status'],'failed')
        self.assertEqual(frappe.db.count('Task',{'project':self.project.name}),0)

    def test_document_changed_fields_ignore_initial_and_ordinary_updates(self):
        workflow=self.workflow([{'kind':'noop','label':'Review event'}],
            {'id':'status','kind':'document_event','doctype':'Task','event':'on_update','changedFields':['status']})
        task=frappe.get_doc({'doctype':'Task','project':self.project.name,'subject':'Changed-field worker'}).insert()
        payload=task.as_dict();payload['event']='on_update'
        jobs.receive_document(payload)
        self.assertEqual(len(self.store.runs(workflow)),0)
        before=task.as_dict();task.subject='Ordinary title edit';task.save()
        payload=task.as_dict();payload.update(event='on_update',previous=before)
        jobs.receive_document(payload)
        self.assertEqual(len(self.store.runs(workflow)),0)
        before=task.as_dict();task.workflow_state='Done';task.save()
        payload=task.as_dict();payload.update(event='on_update',previous=before)
        jobs.receive_document(payload)
        self.assertEqual(len(self.store.runs(workflow)),1)
        jobs.drain()
        self.assertEqual(self.store.runs(workflow)[0]['status'],'succeeded')
