"""The AI sidebar: operations on the workflow on screen, with the model mocked."""
import json
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from quest_automations import copilot


def ai_step(results=('decisions',)):
	return {'kind': 'run_ai_capability', 'label': 'AI: Summarize the notes',
		'configJson': json.dumps({'capability': 'auto-test' + str(len(results)), 'input': {'notes': '{{trigger.first_name}} '}})}


def task_step(text):
	return {'kind': 'erpnext', 'operation': 'create_document', 'label': 'Create a task',
		'configJson': json.dumps({'doctype': 'ToDo', 'fields': {'description': text, 'allocated_to': 'Administrator'}})}


def workflow(steps, triggers=None):
	return {'name': 'Lead follow-up', 'description': '', 'steps': steps,
		'triggers': triggers if triggers is not None else [{'id': 'trigger_main', 'kind': 'document_event', 'doctype': 'CRM Lead', 'event': 'after_insert'}]}


class TestCopilot(IntegrationTestCase):
	def setUp(self):
		frappe.set_user('Administrator')
		self.results = patch.object(copilot, '_ai_results', lambda step: {'decisions'})
		self.results.start()
		self.addCleanup(self.results.stop)

	def tearDown(self):
		frappe.db.rollback()

	def turn(self, plans, wf, **kwargs):
		answers = iter(plans)
		with patch.object(copilot, '_ask', side_effect=lambda system, user, on_text=None: next(answers)):
			return copilot.run_turn(kwargs.pop('prompt', 'change it'), wf, **kwargs)

	def test_inserting_before_a_step_keeps_its_reference_to_an_ai_result(self):
		wf = workflow([ai_step(), task_step('{{steps.step_0.data.decisions}}')])
		plan = {'reply': 'Done.', 'operations': [{'op': 'add_steps', 'after': 'start', 'label': 'Wait a day first',
			'steps': [{'type': 'wait', 'amount': 1, 'unit': 'days'}]}]}
		result = self.turn([plan], wf)
		steps = result['proposal']['steps']
		self.assertEqual([s['kind'] for s in steps], ['wait', 'run_ai_capability', 'erpnext'])
		self.assertIn('steps.step_1.data.decisions', steps[2]['configJson'])
		self.assertEqual(result['changes'], ['Wait a day first'])

	def test_new_steps_can_use_an_existing_ai_result_by_its_handle(self):
		wf = workflow([ai_step()])
		plan = {'reply': 'Ok', 'operations': [{'op': 'add_steps', 'after': 's1', 'label': 'Note',
			'steps': [{'type': 'notify', 'to': 'record_owner', 'message': 'Decisions: {{s1.decisions}}'}]}]}
		result = self.turn([plan], wf)
		self.assertIn('steps.step_0.data.decisions', json.dumps(result['proposal']['steps'][1]))

	def test_removing_a_step_others_read_is_refused(self):
		wf = workflow([ai_step(), task_step('{{steps.step_0.data.decisions}}')])
		plan = {'reply': 'Removed', 'operations': [{'op': 'remove_step', 'step': 's1', 'label': 'Remove the summary'}]}
		result = self.turn([plan, plan], wf)
		self.assertIsNone(result['proposal'])
		self.assertTrue(any('uses that step' in n for n in result['notes']))

	def test_a_failed_first_answer_is_retried_with_the_error(self):
		wf = workflow([task_step('Call')])
		bad = {'reply': 'x', 'operations': [{'op': 'remove_step', 'step': 's9', 'label': 'x'}]}
		good = {'reply': 'Renamed', 'operations': [{'op': 'rename', 'name': 'Welcome leads', 'label': 'Rename'}]}
		prompts = []
		answers = iter([bad, good])

		def ask(system, user, on_text=None):
			prompts.append(user)
			return next(answers)

		with patch.object(copilot, '_ask', side_effect=ask):
			result = copilot.run_turn('rename', wf)
		self.assertEqual(result['proposal']['name'], 'Welcome leads')
		self.assertIn('could not be used', prompts[1])

	def test_moving_a_step_renumbers_references(self):
		wf = workflow([task_step('A'), ai_step(), task_step('{{steps.step_1.data.decisions}}')])
		plan = {'reply': 'Moved', 'operations': [{'op': 'move_step', 'step': 's1', 'after': 'end', 'label': 'Move A last'}]}
		steps = self.turn([plan], wf)['proposal']['steps']
		self.assertEqual(json.loads(steps[2]['configJson'])['fields']['description'], 'A')
		self.assertIn('steps.step_0.data.decisions', steps[1]['configJson'])

	def test_moving_a_reader_above_its_ai_step_is_refused(self):
		wf = workflow([ai_step(), task_step('{{steps.step_0.data.decisions}}')])
		plan = {'reply': 'Moved', 'operations': [{'op': 'move_step', 'step': 's2', 'after': 'start', 'label': 'x'}]}
		result = self.turn([plan, plan], wf)
		self.assertIsNone(result['proposal'])

	def test_edit_step_changes_a_wait(self):
		wf = workflow([{'kind': 'wait', 'label': 'Wait', 'durationMinutes': 60}, task_step('A')])
		plan = {'reply': 'Ok', 'operations': [{'op': 'edit_step', 'step': 's1', 'set': {'amount': 2, 'unit': 'days'}, 'label': 'Wait two days'}]}
		self.assertEqual(self.turn([plan], wf)['proposal']['steps'][0]['durationMinutes'], 2880)

	def test_builds_from_an_empty_workflow(self):
		wf = workflow([], triggers=[])
		plan = {'reply': 'Here it is', 'operations': [
			{'op': 'set_trigger', 'trigger': {'type': 'record_created', 'doctype': 'CRM Lead'}, 'label': 'Start on new leads'},
			{'op': 'add_steps', 'label': 'Call task', 'steps': [{'type': 'task', 'title': 'Call {{record.first_name}}', 'assign_to': 'record_owner'}]}]}
		result = self.turn([plan], wf)
		self.assertEqual(result['proposal']['triggers'][0]['doctype'], 'CRM Lead')
		self.assertEqual(len(result['proposal']['steps']), 1)
		self.assertIn('{{trigger.first_name}}', result['proposal']['steps'][0]['configJson'])

	def test_ai_written_email_to_a_customer_becomes_a_review_task(self):
		wf = workflow([ai_step()])
		plan = {'reply': 'Ok', 'operations': [{'op': 'add_steps', 'label': 'Email', 'steps': [
			{'type': 'email', 'to': 'record', 'subject': 'Your summary', 'body': '{{s1.decisions}}'}]}]}
		result = self.turn([plan], wf)
		self.assertNotIn('send_email', json.dumps(result['proposal']['steps']))
		self.assertTrue(result['notes'])

	def test_a_question_comes_back_as_clarify(self):
		plan = {'clarify': 'Who should get the task?', 'options': ['The owner', 'Me']}
		result = self.turn([plan], workflow([task_step('A')]))
		self.assertEqual(result['options'], ['The owner', 'Me'])
		self.assertNotIn('proposal', result)

	def test_explain_changes_nothing(self):
		plan = {'reply': 'It creates a task.', 'operations': [{'op': 'explain'}], 'suggestions': ['Add a wait']}
		result = self.turn([plan], workflow([task_step('A')]))
		self.assertIsNone(result['proposal'])
		self.assertEqual(result['suggestions'], ['Add a wait'])

	def test_partial_reply_reads_a_streaming_answer(self):
		self.assertEqual(copilot._partial_reply('{"reply": "Hola, agregu'), 'Hola, agregu')
		self.assertEqual(copilot._partial_reply('{"operations": []'), '')

	def test_only_available_models_can_be_picked(self):
		with patch.object(copilot, '_choices', return_value=[{'name': 'mine', 'reasoning_efforts': ['low']}]):
			with self.assertRaises(frappe.PermissionError):
				copilot.set_model('someone-else')
			state = copilot.set_model('mine', 'low')
		self.assertEqual(state['selected'], 'mine')
		self.assertEqual(state['effort'], 'low')

	def test_poll_hides_other_peoples_jobs(self):
		frappe.cache.set_value(copilot._job_key('abc'), {'user': 'someone@example.com', 'state': 'done', 'result': {}})
		self.assertEqual(copilot.poll('abc')['state'], 'failed')

	def test_replacing_an_ai_step_keeps_readers_when_results_stay(self):
		wf = workflow([ai_step(), task_step('{{steps.step_0.data.decisions}}')])
		keep = {'reply': 'Ok', 'operations': [{'op': 'replace_step', 'step': 's1', 'label': 'Shorter summary', 'with': [
			{'type': 'ai', 'id': 'short', 'does': 'Summarize briefly', 'instructions': 'Two lines.', 'give': {'notes': '{{record.first_name}}'},
			 'get': [{'name': 'decisions', 'type': 'list', 'about': 'Decisions'}]}]}]}
		result = self.turn([keep], wf)
		self.assertIsNotNone(result['proposal'])
		self.assertIn('steps.step_0.data.decisions', result['proposal']['steps'][1]['configJson'])
		self.assertTrue(result['token'])
		drop = {'reply': 'Ok', 'operations': [{'op': 'replace_step', 'step': 's1', 'label': 'x', 'with': [{'type': 'wait', 'amount': 1, 'unit': 'hours'}]}]}
		self.assertIsNone(self.turn([drop, drop], wf)['proposal'])

	def test_start_answers_inline_without_a_worker_and_poll_returns_it(self):
		plan = {'reply': 'Renamed', 'operations': [{'op': 'rename', 'name': 'New name', 'label': 'Rename'}]}
		with patch.object(copilot, '_ask', return_value=plan):
			job = copilot.start('rename it', json.dumps(workflow([task_step('A')])))['job']
		state = copilot.poll(job)
		self.assertEqual(state['state'], 'done')
		self.assertEqual(state['result']['proposal']['name'], 'New name')
