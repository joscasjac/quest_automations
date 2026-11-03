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

    def captured_event(self, doctype, name, event):
        deliveries = [call.kwargs for call in self.queued.call_args_list
            if call.args and call.args[0] == 'quest_automations.jobs.receive_document'
            and call.kwargs['payload'].get('doctype') == doctype
            and call.kwargs['payload'].get('name') == name
            and call.kwargs['payload'].get('event') == event]
        self.assertEqual(len(deliveries), 1, deliveries)
        return deliveries[0]

    def preset(self, value):
        from copy import deepcopy
        from quest_automations.core.pulse_events import PULSE_EVENT_PRESETS
        trigger = deepcopy(next(row['trigger'] for row in PULSE_EVENT_PRESETS if row['value'] == value))
        return dict(trigger, id=value)

    def replay_event(self, delivery):
        jobs.receive_document(delivery['payload'], delivery['ancestry'])
        jobs.drain()

    def test_submitted_sales_order_preset_creates_template_delivery_once_on_hook_replay(self):
        from pulse.erpnext_bridge import ensure_default_company
        from pulse.tests.test_business import TestBusiness
        from pulse.api.handoffs import existing
        self.project.company = ensure_default_company()
        self.project.pulse_is_template = 1
        self.project.save()
        subjects = ['Order kickoff', 'Customer acceptance']
        for subject in subjects:
            frappe.get_doc({'doctype': 'Task', 'project': self.project.name, 'subject': subject}).insert()
        fixture = TestBusiness(); fixture.project = self.project
        customer, _, order = fixture._commercial_records()
        original_owner = order.owner
        workflow = self.workflow([self.action('create_delivery_handoff', {
            'source_doctype': 'Sales Order', 'source_name': '{{trigger.name}}',
            'project_name': 'Worker delivery ' + frappe.generate_hash(length=8), 'template': self.project.name})],
            self.preset('pulse_event_order'))
        before_projects = frappe.db.count('Project')
        self.queued.reset_mock()
        order.submit()
        delivery = self.captured_event('Sales Order', order.name, 'on_submit')
        self.assertEqual(delivery['payload']['docstatus'], 1)
        self.assertEqual(delivery['payload']['owner'], original_owner)
        self.replay_event(delivery)
        runs = self.store.runs(workflow)
        self.assertEqual(len(runs), 1)
        result = self.store.run(runs[0]['id'])
        self.assertEqual(result['status'], 'succeeded', result)
        target = result['outputs']['step_0']['project']
        self.assertTrue(result['outputs']['step_0']['created'])
        self.assertNotEqual(target, self.project.name)
        project = frappe.get_doc('Project', target)
        self.assertEqual((project.customer, project.sales_order), (customer, order.name))
        self.assertEqual(project.owner, original_owner)
        self.assertEqual(sorted(frappe.get_all('Task', filters={'project': target}, pluck='subject')), sorted(subjects))
        self.assertEqual(existing('Sales Order', order.name)['project'], target)
        self.replay_event(delivery)
        self.assertEqual(len(self.store.runs(workflow)), 1)
        self.assertEqual(frappe.db.count('Project'), before_projects + 1)
        self.assertEqual(frappe.db.count('Task', {'project': target}), 2)
        self.assertEqual(frappe.db.count('Pulse Business Handoff', {'source_doctype': 'Sales Order', 'source_name': order.name}), 1)
        order.reload()
        self.assertEqual(order.owner, original_owner)
        self.assertEqual(order.docstatus, 1)

    def test_native_due_notification_preset_runs_once_on_hook_replay(self):
        task = frappe.get_doc({'doctype': 'Task', 'project': self.project.name, 'subject': 'Reminder worker target'}).insert()
        workflow = self.workflow([{'kind': 'noop', 'label': 'Reminder received'}], self.preset('pulse_event_reminder'))
        self.queued.reset_mock()
        notification = frappe.get_doc({'doctype': 'Pulse Notification', 'recipient': 'Administrator',
            'notification_type': 'Due Reminder', 'reference_doctype': 'Task',
            'reference_name': task.name, 'message': 'Synthetic worker reminder; no email sent'}).insert(ignore_permissions=True)
        delivery = self.captured_event('Pulse Notification', notification.name, 'after_insert')
        self.replay_event(delivery)
        self.replay_event(delivery)
        runs = self.store.runs(workflow)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]['status'], 'succeeded')
        self.assertFalse(frappe.db.get_value('Pulse Notification', notification.name, 'email_queued'))
