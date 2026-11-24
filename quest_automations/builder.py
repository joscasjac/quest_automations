"""Build an automation from plain language: describe it, answer a question or two, read the plan
in sentences, try it on a real record, turn it on.

The model never writes workflow JSON. It writes a small *plan* (see PLAN_GUIDE), and compile_plan()
turns the plan into an ordinary schemaVersion 2 workflow. So the usual validation, permissions, run
history and the visual editor all still apply, and the model can only use steps that exist.

- AI steps in a plan become Quest AI Capability records (one per step, created and published here)
  run by the normal Run AI Capability action.
- AI-written text never goes straight to a customer: an email or SMS that uses an AI result is
  turned into a review task with the draft in it, and the plan says so.
- The test run reads the latest real record, runs the AI steps for real (they only produce text)
  and only *describes* every other step. Nothing is created, changed or sent.

Model calls go through FAC Model Bridge (the AI Command Center's default model), so usage limits and
the usage log apply. The plan is kept on the workflow draft (`builder`) so it can be changed later
with a sentence."""
import functools
import json
import re

import frappe
from frappe import _

from .core import ai_contract as contract
from .core.definition import DefinitionError
from .store import Store

CAPABILITY = 'Quest AI Capability'
CRM = ('CRM Lead', 'CRM Deal')
OWNER_FIELDS = ('lead_owner', 'deal_owner', 'assigned_to', 'owner')
EMAIL_FIELDS = ('email', 'email_id', 'customer_email', 'contact_email')
STANDARD_FIELDS = ('name', 'owner', 'creation', 'modified')
OPERATORS = {'equals': 'is', 'not_equals': 'is_not', 'contains': 'contains', 'not_contains': 'does_not_contain',
             'empty': 'is_empty', 'not_empty': 'is_not_empty'}
UNITS = {'minutes': 1, 'hours': 60, 'days': 1440, 'weeks': 10080}
PLACEHOLDER = re.compile(r'{{\s*([A-Za-z_][A-Za-z0-9_-]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*}}')
STEP_ID = re.compile(r'^[a-z][a-z0-9_]{0,30}$')
BOOKING_EVENTS = ('Booked', 'Confirmed', 'Rescheduled', 'Cancelled', 'Expired', 'Completed', 'No-show', 'Needs attention', 'Reminder sent')


class PlanError(DefinitionError):
	"""The plan can't become a workflow; the message goes back to the model to fix it."""


def need(value, message):
	if not value:
		raise PlanError(message)


# ------------------------------------------------------------------ what the model is told

PLAN_GUIDE = '''You turn a business owner's description of an automation into a PLAN (JSON only, no prose).
Write every name, label, question and message in the same language as the description.

If something essential is missing or ambiguous (who gets notified, which record type, what should
happen), answer {"status":"questions","questions":[{"question":"...","choices":["...","..."]}]} with at
most 3 short questions, each with 2-4 likely answers. Don't ask about things with an obvious default.

Otherwise answer:
{"status":"ready","name":"Short name","trigger":{...},"steps":[...]}

TRIGGER, one of:
- {"type":"record_created","doctype":"CRM Lead"}: a record of that type is created.
- {"type":"record_updated","doctype":"CRM Deal","fields":["status"]}: it is changed (fields: optional, only when these change).
- {"type":"status_changed","doctype":"CRM Lead","status":"Qualified"}: its status becomes this value.
- {"type":"booking","booking_event":"Completed"}: something happens to a booking. Events: BOOKING_EVENTS.
- {"type":"schedule","every":{"amount":1,"unit":"days"}}: on a timer (units: minutes, hours, days, weeks; at least 5 minutes). No record.
- {"type":"manual"}: someone runs it by hand. No record.
Any trigger may add "only_if":[{"field":"source","is":"equals","value":"Website"}] using that record's fields.
Operators ("is"): equals, not_equals, contains, not_contains, empty, not_empty.

PLACEHOLDERS in any text: {{record.<field>}} for the record that started it (only fields listed below),
{{<ai step id>.<result name>}} for an earlier AI step's result, {{<link step id>.url}} for a booking link.

STEPS (in order), each one of:
- {"type":"ai","id":"summary","does":"Summarize the notes","instructions":"Clear instructions for the AI.",
   "give":{"notes":"{{record.notes}}"},
   "get":[{"name":"decisions","type":"list","about":"Decisions made"},{"name":"urgency","type":"choice","choices":["high","normal"],"about":"..."}]}
   Reads text and returns named results; it cannot do anything else. Result types: text, list, number, yes_no, choice.
   "give" and "get" names: lowercase letters, digits and _. AI steps can't go inside an "if".
- {"type":"task","title":"Call {{record.first_name}}","description":"...","assign_to":"record_owner","priority":"Medium"}
- {"type":"note","title":"Meeting summary","text":"{{summary.decisions}}"}: a note on the record.
- {"type":"notify","to":"record_owner","message":"..."}: an in-app notification (also emailed) to a team member.
- {"type":"email","to":"record","subject":"...","body":"..."}: email the customer on the record ("record") or a team member's email.
- {"type":"sms","text":"..."}: SMS to the lead or deal (CRM Lead / CRM Deal only).
- {"type":"update","field":"status","value":"Contacted"}: change a field on the record.
- {"type":"wait","amount":2,"unit":"days"}
- {"type":"if","field":"{{summary.urgency}}","is":"equals","value":"high","then":[steps],"else":[steps]}: no "if" inside an "if".
- {"type":"booking_link","id":"link","service":""}: the page where the customer books (service name optional, see below).

"assign_to"/"to" for people: "record_owner" (the record's owner or assigned salesperson) or a team member's email from the list below.
Steps with "record" need a trigger with a record. Keep it as short as the description allows; don't add steps nobody asked for.
Never send AI-written text to a customer directly: put it in a task or note for a person to review instead.
'''


def _fields(doctype):
	meta = frappe.get_meta(doctype)
	skip = {'Section Break', 'Column Break', 'Tab Break', 'HTML', 'Button', 'Table', 'Table MultiSelect', 'Image', 'Attach Image', 'Fold', 'Heading'}
	out = {}
	for f in meta.fields:
		if f.fieldtype in skip or f.hidden:
			continue
		out[f.fieldname] = f.label or f.fieldname
		if f.fieldtype == 'Select' and f.options:
			out[f.fieldname] += ' (' + ', '.join(o for o in f.options.split('\n') if o)[:200] + ')'
	return out


def _record_types():
	"""Record types the plan may start from: CRM first, then the ones the site uses most."""
	wanted = ['CRM Lead', 'CRM Deal', 'Booking', 'Customer', 'Contact', 'Quotation', 'Sales Order', 'Sales Invoice', 'Payment Entry', 'Task', 'Issue']
	return [d for d in wanted if frappe.db.exists('DocType', d)]


def _knowledge(description, current=None):
	"""What the model may use: record types with their fields, team members, booking services."""
	types = _record_types()
	mentioned = [d for d in types if d.lower() in (description or '').lower()]
	if current and current.get('trigger', {}).get('doctype') in types:
		mentioned.append(current['trigger']['doctype'])
	detailed = list(dict.fromkeys(mentioned + [d for d in ('CRM Lead', 'CRM Deal', 'Booking') if d in types]))[:5]
	users = frappe.get_all('User', filters={'enabled': 1, 'user_type': 'System User', 'name': ('not in', ('Administrator', 'Guest'))},
		fields=['name', 'full_name'], limit_page_length=60, order_by='full_name asc')
	knowledge = {
		'record_types': types,
		'fields': {d: _fields(d) for d in detailed},
		'team_members': [{'email': u.name, 'name': u.full_name} for u in users],
		'me': frappe.session.user,
	}
	if frappe.db.exists('DocType', 'Booking Service'):
		knowledge['booking_services'] = frappe.get_all('Booking Service', pluck='name', limit_page_length=50)
	return knowledge


# ------------------------------------------------------------------ model calls


def _connection():
	try:
		from fac_model_bridge.connections import SHARED, default_connection
	except ImportError:
		raise DefinitionError(_t('no_bridge')) from None
	name = None
	settings = 'Quest ChatGPT Connection'
	if frappe.db.exists('DocType', settings) and frappe.get_meta(settings).has_field('model_connection'):
		name = frappe.db.get_single_value(settings, 'model_connection')
	name = name or default_connection()
	if not name or not frappe.db.exists('Model Connection', name):
		raise DefinitionError(_t('no_model'))
	conn = frappe.get_doc('Model Connection', name)
	if not conn.enabled:
		raise DefinitionError(_t('no_model'))
	if not conn.model:
		raise DefinitionError(_t('no_model_picked', conn.provider))
	if conn.get('sharing') != SHARED and conn.owner != frappe.session.user:
		raise DefinitionError(_t('private_model', name))
	return conn


def _ask(system, user, source):
	"""One JSON object from the default model. Keeps the caller's session when switching user."""
	from fac_model_bridge.connections import credentials
	from fac_model_bridge.providers import ProviderError, request_completion
	from fac_model_bridge.usage import source as usage_source

	conn = _connection()
	session, form_dict = frappe._dict(frappe.local.session), frappe.local.form_dict
	try:
		frappe.set_user(conn.owner)
		with usage_source('Quest Automations: ' + source):
			token, account_id = credentials(conn.name)
			reply = request_completion(conn.provider, conn.model, token,
				[{'role': 'system', 'content': system}, {'role': 'user', 'content': user}], [],
				subscription=conn.authentication == 'Subscription', account_id=account_id)
	except ProviderError as error:
		raise DefinitionError(str(error)[:400] or _t('model_failed')) from None
	finally:
		frappe.set_user(session.user)
		frappe.local.session = session
		frappe.local.form_dict = form_dict
	text = (reply.text or '').strip()
	start, end = text.find('{'), text.rfind('}')
	try:
		value = json.loads(text[start:end + 1])
	except ValueError:
		raise DefinitionError(_t('model_failed')) from None
	need(isinstance(value, dict), _t('model_failed'))
	return value


# ------------------------------------------------------------------ plan → workflow


def _record_doctype(trigger):
	if trigger.get('type') == 'booking':
		return 'Booking'
	return trigger.get('doctype') if trigger.get('type') in ('record_created', 'record_updated', 'status_changed') else None


def _first_field(doctype, names):
	meta = frappe.get_meta(doctype)
	return next((n for n in names if n in STANDARD_FIELDS or meta.has_field(n)), None)


class Compiler:
	def __init__(self, plan):
		need(isinstance(plan, dict) and plan.get('status', 'ready') == 'ready', _('Expected a ready plan.'))
		self.plan = plan
		self.trigger = plan.get('trigger') or {}
		self.doctype = _record_doctype(self.trigger)
		self.ai = {}  # step id → (top-level index, result names)
		self.links = {}  # step id → top-level index
		self.capabilities = []
		self.notes = []  # what was changed for safety, shown with the plan
		self.has_ai = any(isinstance(s, dict) and s.get('type') == 'ai' for s in plan.get('steps') or [])

	# --- values

	def ref(self, root, name):
		"""Workflow path for {{root.name}}."""
		if root == 'record':
			need(self.doctype, _t('no_record', '{{record.' + name + '}}'))
			need(name in STANDARD_FIELDS or frappe.get_meta(self.doctype).has_field(name), _t('unknown_field', name, self.doctype))
			return 'trigger.' + name
		if root in self.ai:
			index, results = self.ai[root]
			need(name in results, _t('unknown_result', name, root))
			return 'steps.step_%d.data.%s' % (index, name)
		if root in self.links:
			need(name == 'url', _('A booking link step only has "url".'))
			return 'steps.step_%d.url' % self.links[root]
		raise PlanError(_t('unknown_placeholder', '{{' + root + '.' + name + '}}'))

	def text(self, value):
		value = '' if value is None else str(value)
		return PLACEHOLDER.sub(lambda m: '{{' + self.ref(m[1], m[2]) + '}}', value)

	def uses_ai(self, *values):
		return any(m[1] in self.ai for v in values for m in PLACEHOLDER.finditer(str(v or '')))

	def person(self, value):
		if value in (None, '', 'record_owner'):
			need(self.doctype, _t('no_record', 'record_owner'))
			return '{{trigger.' + _first_field(self.doctype, OWNER_FIELDS) + '}}'
		need(frappe.db.exists('User', value), _t('unknown_person', value))
		return value

	def condition(self, item):
		need(item.get('is') in OPERATORS, _t('bad_operator', item.get('is')))
		field = str(item.get('field') or '').strip()
		found = PLACEHOLDER.fullmatch(field)
		path = self.ref(found[1], found[2]) if found else self.ref('record', field)
		value = item.get('value')
		value = {True: 'true', False: 'false'}.get(value, '' if value is None else str(value))
		if value.casefold() in ('sí', 'si', 'yes'):
			value = 'true'
		if value.casefold() == 'no':
			value = 'false'
		return {'field': path if not path.startswith('trigger.') else path[len('trigger.'):], 'operator': OPERATORS[item['is']], 'value': value}

	# --- trigger

	def compile_trigger(self):
		t, kind = self.trigger, self.trigger.get('type')
		result = None
		if kind in ('record_created', 'record_updated', 'status_changed'):
			need(self.doctype and frappe.db.exists('DocType', self.doctype), _t('unknown_doctype', self.doctype))
			result = {'kind': 'document_event', 'doctype': self.doctype, 'event': 'after_insert' if kind == 'record_created' else 'on_update'}
			if kind == 'record_updated' and t.get('fields'):
				for f in t['fields']:
					self.ref('record', f)
				result['changedFields'] = list(t['fields'])[:20]
			if kind == 'status_changed':
				need(frappe.get_meta(self.doctype).has_field('status'), _t('unknown_field', 'status', self.doctype))
				result['changedFields'] = ['status']
				t = {**t, 'only_if': [{'field': 'status', 'is': 'equals', 'value': t.get('status')}] + list(t.get('only_if') or [])}
		elif kind == 'booking':
			need(frappe.db.exists('DocType', 'Booking'), _t('unknown_doctype', 'Booking'))
			need(t.get('booking_event') in BOOKING_EVENTS, _t('bad_booking_event', t.get('booking_event')))
			result = {'kind': 'document_event', 'doctype': 'Booking', 'event': 'on_update', 'changedFields': ['last_event_on']}
			t = {**t, 'only_if': [{'field': 'last_event', 'is': 'equals', 'value': t['booking_event']}] + list(t.get('only_if') or [])}
		elif kind == 'schedule':
			every = t.get('every') or {}
			need(every.get('unit') in UNITS and isinstance(every.get('amount'), (int, float)), _('Schedule needs every.amount and every.unit.'))
			result = {'kind': 'schedule', 'intervalMinutes': max(5, int(every['amount'] * UNITS[every['unit']]))}
		elif kind == 'manual':
			result = {'kind': 'manual'}
		else:
			raise PlanError(_t('bad_trigger', kind))
		conditions = [self.condition(c) for c in (t.get('only_if') or [])]
		if conditions:
			need(self.doctype, 'only_if needs a trigger with a record.')
			result['condition'] = {**conditions[0], 'match': 'all', 'conditions': conditions[1:]} if len(conditions) > 1 else conditions[0]
		return {'id': 'trigger_main', **result}

	# --- steps

	def step(self, s, index, nested=False):
		kind = s.get('type')
		need(isinstance(s, dict) and kind, _t('bad_step', kind))
		# The step's sentence is its label, so the visual editor and run history read like the plan.
		label = sentences({'steps': [s]}, doctype=self.doctype)[1]['text'][:140] if kind != 'task_review' else ''
		if kind == 'ai':
			need(not nested, _t('ai_in_if'))
			sid = s.get('id')
			need(isinstance(sid, str) and STEP_ID.fullmatch(sid) and sid not in self.ai and sid not in self.links and sid != 'record', _t('bad_id', sid))
			give, get = s.get('give') or {}, s.get('get') or []
			need(isinstance(give, dict) and 1 <= len(give) <= 20, _t('ai_give'))
			need(isinstance(get, list) and 1 <= len(get) <= 20, _t('ai_get'))
			inputs, outputs = {}, {}
			for name, value in give.items():
				need(contract.FIELD.fullmatch(name), _t('bad_id', name))
				text = self.text(value)
				# A value that is only a placeholder would pass a None or a number through; AI inputs are text.
				inputs[name] = text + ' ' if re.fullmatch(r'{{[^}]+}}', text) else text
			for item in get:
				name, kind_ = item.get('name'), item.get('type', 'text')
				need(isinstance(name, str) and contract.FIELD.fullmatch(name), _t('bad_id', name))
				about = str(item.get('about') or name)[:500]
				if kind_ == 'list':
					outputs[name] = {'type': 'string', 'description': about + '. One item per line, each starting with "- ".'}
				elif kind_ == 'number':
					outputs[name] = {'type': 'number', 'description': about}
				elif kind_ == 'yes_no':
					outputs[name] = {'type': 'boolean', 'description': about}
				elif kind_ == 'choice':
					choices = [str(c) for c in item.get('choices') or []][:30]
					need(choices, _t('ai_choices', name))
					outputs[name] = {'type': 'string', 'enum': choices, 'description': about}
				else:
					outputs[name] = {'type': 'string', 'description': about}
			definition = {'title': label, 'instructions': str(s.get('instructions') or label)[:12000],
				'input_schema': contract.object_schema({k: {'type': 'string'} for k in inputs}),
				'output_schema': contract.object_schema(outputs)}
			definition = contract.definition(definition)
			key = 'auto-' + contract.fingerprint(definition)[:20]
			self.capabilities.append({'key': key, **definition})
			self.ai[sid] = (index, set(outputs))
			return {'kind': 'run_ai_capability', 'label': label, 'configJson': json.dumps({'capability': key, 'input': inputs})}
		if kind == 'booking_link':
			need(not nested, _('Booking links can\'t go inside an "if".'))
			need('reservas_booking_link' in _extension_actions(), _t('unknown_doctype', 'Booking'))
			sid = s.get('id')
			need(isinstance(sid, str) and STEP_ID.fullmatch(sid) and sid not in self.ai and sid not in self.links, _t('bad_id', sid))
			self.links[sid] = index
			return {'kind': 'erpnext', 'operation': 'reservas_booking_link', 'label': label, 'configJson': json.dumps({'service': s.get('service') or ''})}
		if kind == 'task_review' or kind in ('email', 'sms') and self.uses_ai(s.get('subject'), s.get('body'), s.get('text')):
			# AI text goes to a person first (AGENTS.md: no AI content in unattended customer mail).
			s['review'] = True  # the plan's sentences say so
			self.notes.append(_t('review_instead'))
			draft = '\n\n'.join(str(v) for v in (s.get('subject'), s.get('body'), s.get('text')) if v)
			return self.step({'type': 'task', 'title': _t('review_title', s.get('subject') or s.get('text') or ''), 'description': draft, 'assign_to': 'record_owner' if self.doctype else frappe.session.user}, index, nested)
		if kind == 'task':
			title, description = self.text(s.get('title') or label), self.text(s.get('description'))
			who = self.person(s.get('assign_to')) if (s.get('assign_to') or self.doctype) else frappe.session.user
			priority = s.get('priority') if s.get('priority') in ('Low', 'Medium', 'High') else 'Medium'
			if self.doctype in CRM:
				fields = {'title': title, 'description': description, 'assigned_to': who, 'priority': priority, 'status': 'Todo',
					'reference_doctype': self.doctype, 'reference_docname': '{{trigger.name}}'}
				return self._create('CRM Task', fields, label)
			fields = {'description': title + ('\n\n' + description if description else ''), 'allocated_to': who, 'priority': priority}
			if self.doctype:
				fields.update(reference_type=self.doctype, reference_name='{{trigger.name}}')
			return self._create('ToDo', fields, label)
		if kind == 'note':
			need(self.doctype, _t('no_record', 'note'))
			title, text = self.text(s.get('title') or label), self.text(s.get('text'))
			if self.doctype in CRM and frappe.db.exists('DocType', 'FCRM Note'):
				return self._create('FCRM Note', {'title': title, 'content': text, 'reference_doctype': self.doctype, 'reference_docname': '{{trigger.name}}'}, label)
			return {'kind': 'send_notification', 'label': label, 'channel': 'activity', 'message': '<b>' + title + '</b><br>' + text}
		if kind == 'notify':
			fields = {'for_user': self.person(s.get('to')) if (s.get('to') or self.doctype) else frappe.session.user, 'type': 'Alert',
				'subject': self.text(s.get('message') or label)[:1000], 'email_content': self.text(s.get('message'))}
			if self.doctype:
				fields.update(document_type=self.doctype, document_name='{{trigger.name}}')
			return self._create('Notification Log', fields, label)
		if kind == 'email':
			subject, body = self.text(s.get('subject')), self.text(s.get('body')).replace('\n', '<br>')
			need(subject and body, _('An email needs a subject and a body.'))
			to = s.get('to') or 'record'
			if to == 'record':
				need(self.doctype, _t('no_record', 'email'))
				if self.doctype in CRM and 'crm_send_email' in _extension_actions():
					return {'kind': 'erpnext', 'operation': 'crm_send_email', 'label': label,
						'configJson': json.dumps({'subject': subject, 'preheader': '', 'body': body, 'send_as': 'personal'})}
				field = _first_field(self.doctype, EMAIL_FIELDS)
				need(field, _t('no_email_field', self.doctype))
				to = '{{trigger.' + field + '}}'
				if self.has_ai:
					# The workflow validator lets AI workflows email only internally: a person sends it.
					s['review'] = True
					return self.step({**s, 'type': 'task_review'}, index, nested)
			elif self.has_ai:
				# Workflows with AI may only email team members, through a notification.
				return self.step({'type': 'notify', 'to': to, 'message': str(s.get('subject') or '') + '\n' + str(s.get('body') or '')}, index, nested)
			return {'kind': 'send_email', 'label': label, 'to': to, 'subject': subject, 'body': body}
		if kind == 'sms':
			need(self.doctype in CRM and 'crm_send_sms' in _extension_actions(), _t('sms_crm'))
			return {'kind': 'erpnext', 'operation': 'crm_send_sms', 'label': label, 'configJson': json.dumps({'body': self.text(s.get('text'))})}
		if kind == 'update':
			need(self.doctype, _t('no_record', 'update'))
			field = str(s.get('field') or '')
			need(frappe.get_meta(self.doctype).has_field(field) and field not in ('docstatus', 'workflow_state'), _t('unknown_field', field, self.doctype))
			return self._create(self.doctype, {field: self.text(s.get('value'))}, label, update=True)
		if kind == 'wait':
			need(s.get('unit') in UNITS and isinstance(s.get('amount'), (int, float)) and s['amount'] > 0, _('A wait needs amount and unit.'))
			return {'kind': 'wait', 'label': label, 'durationMinutes': min(525600, s['amount'] * UNITS[s['unit']])}
		if kind == 'if':
			need(not nested, _t('if_in_if'))
			then = [self.step(c, index, True) for c in s.get('then') or []]
			otherwise = [self.step(c, index, True) for c in s.get('else') or []]
			need(then or otherwise, _('An "if" needs steps in then or else.'))
			yes, no = _t('yes'), _t('otherwise')
			return {'kind': 'if_else', 'label': label if label != 'if' else _t('check'), 'elseLabel': no,
				'branches': [{'name': yes, **self.condition(s), 'steps': then}], 'elseSteps': otherwise}
		raise PlanError(_t('bad_step', kind))

	def _create(self, doctype, fields, label, update=False):
		need(frappe.db.exists('DocType', doctype), _t('unknown_doctype', doctype))
		config = {'doctype': doctype, 'fields': fields}
		if update:
			config['name'] = '{{trigger.name}}'
		return {'kind': 'erpnext', 'operation': 'update_document' if update else 'create_document', 'label': label, 'configJson': json.dumps(config)}

	def compile(self):
		name = str(self.plan.get('name') or '').strip()[:200]
		need(name, _('The plan needs a name.'))
		trigger = self.compile_trigger()
		steps = self.plan.get('steps') or []
		need(isinstance(steps, list) and 1 <= len(steps) <= 40, _('Give the plan 1-40 steps.'))
		compiled = [self.step(s, i) for i, s in enumerate(steps)]
		definition = {'schemaVersion': 2, 'name': name, 'triggers': [trigger], 'steps': compiled}
		from .core.graph import validate_graph

		validate_graph(definition)
		return definition


def _extension_actions():
	from .core import extensions

	return extensions.actions()


def compile_plan(plan):
	compiler = Compiler(plan)
	definition = compiler.compile()
	return definition, compiler.capabilities, list(dict.fromkeys(compiler.notes))


# ------------------------------------------------------------------ the plan in sentences


def sentences(plan, fill=None, doctype=None):
	"""What the plan does, one sentence per step. `fill` renders placeholders (the test run)."""
	t = plan.get('trigger') or {}
	doctype = doctype or _record_doctype(t)
	f = fill or (lambda value: _show(value, doctype))
	kind = t.get('type')
	what = _doctype_label(t.get('doctype') or 'Booking')
	if kind == 'record_created':
		when = _t('when_created', what)
	elif kind == 'record_updated':
		when = _t('when_updated', what) + (_t('when_fields', ', '.join(t['fields'])) if t.get('fields') else '')
	elif kind == 'status_changed':
		when = _t('when_status', what, t.get('status'))
	elif kind == 'booking':
		when = _t('when_booking', _t('booking_' + str(t.get('booking_event'))))
	elif kind == 'schedule':
		every = t.get('every') or {}
		when = _t('when_every', every.get('amount'), _unit(every.get('amount'), every.get('unit')))
	else:
		when = _t('when_manual')
	for c in t.get('only_if') or []:
		when += _t('only_if', _condition_text(c, f, doctype))
	out = [{'kind': 'trigger', 'text': when}]

	def one(s):
		k = s.get('type')
		if k == 'ai':
			results = ', '.join(g.get('name', '') for g in s.get('get') or [])
			return {'kind': 'ai', 'text': _t('do_ai', s.get('does') or s.get('instructions', '')[:120], results)}
		if k == 'task':
			return {'kind': 'task', 'text': _t('do_task', f(s.get('title')), _who(s.get('assign_to')))}
		if k == 'note':
			return {'kind': 'note', 'text': _t('do_note', f(s.get('title')))}
		if k == 'notify':
			return {'kind': 'notify', 'text': _t('do_notify', _who(s.get('to')), f(s.get('message')))}
		if k in ('email', 'sms') and s.get('review'):
			return {'kind': 'task', 'text': _t('do_review', _t('record_owner'), f(s.get('subject') or s.get('text')))}
		if k == 'email':
			return {'kind': 'email', 'text': _t('do_email', _who(s.get('to'), customer=True), f(s.get('subject')))}
		if k == 'sms':
			return {'kind': 'sms', 'text': _t('do_sms', f(s.get('text')))}
		if k == 'update':
			return {'kind': 'update', 'text': _t('do_update', _label(doctype, s.get('field')), f(s.get('value')))}
		if k == 'wait':
			return {'kind': 'wait', 'text': _t('do_wait', s.get('amount'), _unit(s.get('amount'), s.get('unit')))}
		if k == 'booking_link':
			return {'kind': 'link', 'text': _t('do_link', s.get('service') or _t('any_service'))}
		if k == 'if':
			return {'kind': 'if', 'text': _t('do_if', _condition_text(s, f, doctype)),
				'then': [one(c) for c in s.get('then') or []], 'else': [one(c) for c in s.get('else') or []]}
		return {'kind': 'other', 'text': str(s.get('does') or k)}

	out += [one(s) for s in plan.get('steps') or []]
	if _lang() == 'es':
		# Spanish contractions after filling in "el ..." phrases (a el → al, de el → del)
		def tidy(item):
			item['text'] = item['text'].replace(' a el ', ' al ').replace(' de el ', ' del ')  # i18n-ignore
			for key in ('then', 'else'):
				for child in item.get(key) or []:
					tidy(child)
		for item in out:
			tidy(item)
	return out


def _unit(amount, unit):
	return _t(('unit1_' if amount == 1 else 'unit_') + str(unit))


def _label(doctype, field):
	"""A record field as people see it on the form ("First Name", translated), not its code name."""
	if not doctype or not field:
		return str(field or '')
	try:
		meta = frappe.get_meta(doctype)
	except Exception:
		return str(field)
	label = meta.get_label(field) if meta.has_field(field) else None
	return frappe._(label) if label and label != 'No Label' else str(field)


def _show(value, doctype=None):
	"""Placeholders as readable chips: {{record.first_name}} → «First Name»."""
	return PLACEHOLDER.sub(lambda m: '⟦' + (_label(doctype, m[2]) if m[1] == 'record' else m[1] + ' → ' + m[2]) + '⟧', str(value or ''))


def _condition_text(c, f, doctype=None):
	field = str(c.get('field') or '')
	field = f(field) if '{{' in field else '⟦' + _label(doctype, field) + '⟧'
	return _t('op_' + str(c.get('is')), field, f(c.get('value')))


def _who(value, customer=False):
	if value in (None, '', 'record_owner'):
		return _t('record_owner')
	if value == 'record':
		return _t('the_customer')
	return frappe.db.get_value('User', value, 'full_name') or value


def _doctype_label(doctype):
	return _t('dt_' + doctype) if ('dt_' + doctype) in _words() else doctype


# ------------------------------------------------------------------ endpoints


def _guard():
	from .api import require_access

	require_access()


def _friendly(fn):
	"""Show the builder's own messages to the person instead of a server error."""
	@functools.wraps(fn)
	def wrapper(*args, **kwargs):
		try:
			return fn(*args, **kwargs)
		except DefinitionError as error:
			frappe.db.rollback()
			frappe.throw(str(error), title=_t('cant_do'))
	return wrapper


def _loads(value):
	return json.loads(value) if isinstance(value, str) else value


@frappe.whitelist(methods=['GET'])
@_friendly
def context():
	_guard()
	try:
		conn = _connection()
		model = '%s %s' % (conn.provider, conn.model)
	except DefinitionError as error:
		model, problem = None, str(error)
	else:
		problem = None
	types = _record_types()
	return {'lang': _lang(), 'model': model, 'problem': problem, 'recipes': [r for r in _recipes() if r['needs'] in types or not r['needs']]}


@frappe.whitelist(methods=['POST'])
@_friendly
def draft(description, answers=None, current=None, change=None):
	"""A plan from a description (and answers to earlier questions), or questions to ask first.
	With `current` and `change`, the current plan changed by one sentence."""
	_guard()
	description = str(description or '').strip()
	need(3 <= len(description) <= 4000, _t('describe_more'))
	answers, current = _loads(answers) or [], _loads(current)
	knowledge = _knowledge(description + ' ' + str(change or ''), current)
	guide = PLAN_GUIDE.replace('BOOKING_EVENTS', ', '.join(BOOKING_EVENTS))
	message = {'description': description, 'what_you_can_use': knowledge}
	if answers:
		message['answers_to_your_questions'] = answers
		message['note'] = 'You have the answers you need: return a ready plan now.'
	if current:
		message.update(current_plan=current, change_requested=str(change or ''), note='Return the whole plan with this change. Keep everything else.')
	user = json.dumps(message, ensure_ascii=False, default=str)
	error = None
	for _attempt in range(3):
		plan = _ask(guide, user + ('\n\nYour last plan could not be used: ' + error + ' Fix it.' if error else ''), 'Automation builder')
		if plan.get('status') == 'questions' and not answers and not current:
			questions = [q for q in plan.get('questions') or [] if isinstance(q, dict) and q.get('question')][:3]
			if questions:
				return {'questions': [{'question': str(q['question']), 'choices': [str(c) for c in q.get('choices') or []][:4]} for q in questions]}
		plan['status'] = 'ready'
		try:
			_definition, capabilities, notes = compile_plan(plan)
		except DefinitionError as problem:
			error = str(problem)
			continue
		if capabilities and not ai_ready():
			notes.append(_t('ai_needs_update'))
		return {'plan': plan, 'sentences': sentences(plan), 'notes': notes, 'ai_steps': len(capabilities)}
	raise DefinitionError(_t('could_not_build', error))


@frappe.whitelist(methods=['POST'])
@_friendly
def test(plan):
	"""Run the plan on the latest real record: AI steps for real, every other step only described."""
	_guard()
	plan = _loads(plan)
	definition, capabilities, notes = compile_plan(plan)
	doctype = _record_doctype(plan.get('trigger') or {})
	record, label = {}, None
	if doctype:
		filters = {}
		if plan['trigger'].get('type') == 'booking':
			filters = {'last_event': plan['trigger'].get('booking_event')}
		names = frappe.get_list(doctype, filters=filters, pluck='name', order_by='modified desc', limit_page_length=1) or \
			frappe.get_list(doctype, pluck='name', order_by='modified desc', limit_page_length=1)
		need(names, _t('no_sample', doctype))
		doc = frappe.get_doc(doctype, names[0])
		doc.check_permission('read')
		record = json.loads(frappe.as_json(doc.as_dict()))
		label = doc.get_title() or doc.name
	results = {}
	specs = iter(capabilities)

	def fill(value):
		def one(m):
			root, name = m[1], m[2]
			if root == 'record':
				found = record.get(name)
			elif root in results:
				found = results[root].get(name)
			else:
				found = '…'
			return '⟦' + (_label(doctype, name) if root == 'record' else name) + '⟧' if found in (None, '') else str(found)
		return PLACEHOLDER.sub(one, str(value or ''))

	from .ai_capabilities import GUARD

	steps_out = []
	for s in plan.get('steps') or []:
		if s.get('type') == 'ai':
			spec = next(specs)
			given = {k: fill(v) for k, v in (s.get('give') or {}).items()}
			system = GUARD + '\nCapability instructions:\n' + spec['instructions'] + '\n\nReturn one JSON object matching this JSON schema:\n' + json.dumps(spec['output_schema'], ensure_ascii=False)
			output = _ask(system, json.dumps(given, ensure_ascii=False), 'Automation builder test')
			output = {k: v for k, v in output.items() if k in spec['output_schema']['properties']}
			contract.validate_value(output, spec['output_schema'], 'output')
			results[s['id']] = output
			steps_out.append({'kind': 'ai', 'text': sentences({'steps': [s]}, doctype=doctype)[1]['text'], 'result': output})
		elif s.get('type') == 'if':
			took = _matches(s, fill)
			branch = s.get('then') if took else s.get('else')
			entry = sentences({'steps': [s]}, fill, doctype)[1]
			steps_out.append({'kind': 'if', 'text': entry['text'], 'took': 'then' if took else 'else',
				'steps': sentences({'steps': branch or []}, fill, doctype)[1:]})
		elif s.get('type') == 'booking_link':
			route = frappe.db.get_value('Booking Service', s.get('service'), 'route') if s.get('service') else None
			results[s['id']] = {'url': frappe.utils.get_url('/reservar') + ('/' + route if route else '')}
			steps_out.append(sentences({'steps': [s]}, fill, doctype)[1])
		else:
			steps_out.append(sentences({'steps': [s]}, fill, doctype)[1])
	trigger = sentences({'trigger': plan.get('trigger'), 'steps': []}, fill)[0]
	owner_field = _first_field(doctype, OWNER_FIELDS) if doctype else None
	owner = record.get(owner_field) if owner_field else None
	if owner:
		name = frappe.db.get_value('User', owner, 'full_name') or owner
		def named(item):
			# the Spanish sentence contracted "a el responsable del registro" to "al ..." (see sentences)
			item['text'] = item['text'].replace(' al responsable del registro', ' a ' + name).replace(_t('record_owner'), name)  # i18n-ignore
			for child in item.get('steps') or []:
				named(child)
		for item in steps_out:
			named(item)
	return {'record': label, 'doctype': doctype, 'trigger': trigger, 'steps': steps_out, 'notes': notes}


def _matches(s, fill):
	field = str(s.get('field') or '')
	left = fill(field) if '{{' in field else fill('{{record.' + field + '}}')
	left = '' if left.startswith('⟦') else left
	right, op = str(s.get('value') or ''), s.get('is')
	if op == 'empty':
		return not left
	if op == 'not_empty':
		return bool(left)
	if op in ('equals', 'not_equals'):
		same = left.casefold() == right.casefold() or {'true': 'sí', 'false': 'no'}.get(left.casefold()) == right.casefold()
		return same if op == 'equals' else not same
	inside = right.casefold() in left.casefold()
	return inside if op == 'contains' else not inside


@frappe.whitelist(methods=['POST'])
@_friendly
def save(plan, description='', workflow_id=None, activate=0):
	"""Save the plan as a workflow (and its AI steps), and turn it on when `activate`."""
	_guard()
	plan = _loads(plan)
	definition, capabilities, _notes = compile_plan(plan)
	for spec in capabilities:
		_ensure_capability(spec)
	definition['builder'] = {'plan': plan, 'description': str(description or '')[:4000]}
	store = Store()
	if workflow_id:
		row = store.workflow(workflow_id)
		row = store.save(definition, workflow_id, row['revision'])
	else:
		row = store.save(definition)
	if frappe.utils.cint(activate):
		row = store.publish(row['id'], row['revision'])
		from .jobs import wake

		wake()
	return {'id': row['id'], 'status': row['status']}


@frappe.whitelist(methods=['GET'])
@_friendly
def load(workflow_id):
	_guard()
	row = Store().workflow(workflow_id)
	builder = row['draft'].get('builder')
	if not builder:
		return {'id': workflow_id, 'simple': False, 'name': row['draft'].get('name')}
	return {'id': workflow_id, 'simple': True, 'status': row['status'], 'plan': builder['plan'], 'description': builder.get('description', ''),
		'sentences': sentences(builder['plan'])}


def ai_ready():
	"""AI steps run through Model Connections (any System Manager). Older Quest Automations ran
	them through one owner's ChatGPT sign-in, which the builder can't set up."""
	try:
		from . import model_bridge  # noqa: F401
	except ImportError:
		return False
	return True


def _ensure_capability(spec):
	"""One published capability per AI step. The key is the definition's fingerprint, so the same
	step reuses its record and a changed step gets a new one (old runs keep their history)."""
	if frappe.db.exists(CAPABILITY, spec['key']):
		return
	need(ai_ready(), _t('ai_needs_update'))
	from .protected_changes import internal_change

	values = {k: spec[k] for k in contract.DEFINITION_FIELDS}
	doc = frappe.get_doc({'doctype': CAPABILITY, 'capability_key': spec['key'], 'title': spec['title'], 'enabled': 1,
		'description': _t('made_by_builder'), 'instructions': spec['instructions'],
		'input_schema': contract.encoded(spec['input_schema']), 'output_schema': contract.encoded(spec['output_schema'])})
	doc.insert()
	doc.published_revision = 1
	doc.published_definition = contract.encoded({'revision': 1, 'definition': values, 'hash': contract.fingerprint(values)})
	doc.last_published_at = frappe.utils.now_datetime()
	with internal_change():
		doc.save()


# ------------------------------------------------------------------ words


def _lang():
	return 'es' if str(frappe.local.lang or '').startswith('es') else 'en'


def _t(key, *args):
	text = _words().get(key) or key
	return text.format(*args) if args else text


def _words():
	"""The builder's messages and plan sentences, in the person's language."""
	return {
		"no_bridge": _("Install FAC Model Bridge and choose a model in the AI Command Center (/ai)."),
		"no_model": _("Choose a default model in the AI Command Center (/ai) first."),
		"no_model_picked": _("Your {0} account is the default, but no model is picked for it yet. Choose one in the AI Command Center → Models and spending."),
		"private_model": _("The model connection {0} is private. Share it with everyone in the AI Command Center (/ai)."),
		"model_failed": _("The AI did not answer properly. Try again."),
		"describe_more": _("Describe what should happen in a sentence or two."),
		"could_not_build": _("I couldn’t turn that into an automation ({0}). Try describing it differently."),
		"no_sample": _("There are no «{0}» records yet to try this on. Create one and try again."),
		"no_record": _("{0} needs a trigger that starts from a record."),
		"unknown_field": _("The field \"{0}\" does not exist on {1}."),
		"unknown_result": _("The AI step \"{1}\" has no result called \"{0}\"."),
		"unknown_placeholder": _("{0} is not a record field, AI result or link."),
		"unknown_person": _("{0} is not a team member on this site."),
		"unknown_doctype": _("{0} is not available on this site."),
		"bad_operator": _("Unknown comparison \"{0}\"."),
		"bad_trigger": _("Unknown trigger \"{0}\"."),
		"bad_booking_event": _("Unknown booking event \"{0}\"."),
		"bad_step": _("Unknown step \"{0}\"."),
		"bad_id": _("\"{0}\" must be a short lowercase name (letters, digits, _)."),
		"ai_in_if": _("AI steps can't go inside an \"if\"."),
		"if_in_if": _("An \"if\" can't go inside another \"if\"."),
		"ai_give": _("An AI step needs 1-20 inputs in \"give\"."),
		"ai_get": _("An AI step needs 1-20 results in \"get\"."),
		"ai_choices": _("The choice result \"{0}\" needs its choices."),
		"no_email_field": _("{0} has no email field to send to."),
		"sms_crm": _("SMS can only be sent to CRM leads or deals."),
		"review_instead": _("AI never emails customers on its own: AI-written messages become a task with the draft, for someone to review and send."),
		"review_title": _("Review and send: {0}"),
		"do_review": _("Create a task for {0} to review and send the draft «{1}»"),
		"cant_do": _("Can’t do that yet"),
		"made_by_builder": _("Created by the automation builder for one workflow step."),
		"ai_needs_update": _("AI steps need the latest Quest Automations (with Model Connections). You can try this plan, but update Automations before saving it."),
		"yes": _("Yes"),
		"otherwise": _("Otherwise"),
		"check": _("Check condition"),
		"when_created": _("When {0} is created"),
		"when_updated": _("When {0} is changed"),
		"when_fields": _(" (only {0})"),
		"when_status": _("When the status of {0} becomes «{1}»"),
		"when_booking": _("When a booking {0}"),
		"when_every": _("Every {0} {1}"),
		"when_manual": _("When someone runs it by hand"),
		"only_if": _(", only if {0}"),
		"do_ai": _("AI: {0} → gives {1}"),
		"do_task": _("Create the task «{0}» for {1}"),
		"do_note": _("Add the note «{0}» to the record"),
		"do_notify": _("Notify {0}: «{1}»"),
		"do_email": _("Email {0}: «{1}»"),
		"do_sms": _("Send an SMS: «{0}»"),
		"do_update": _("Set {0} to «{1}»"),
		"do_wait": _("Wait {0} {1}"),
		"do_link": _("Get the booking link ({0})"),
		"do_if": _("If {0}"),
		"any_service": _("any service"),
		"record_owner": _("the record’s owner"),
		"the_customer": _("the customer"),
		"op_equals": _("{0} is «{1}»"),
		"op_not_equals": _("{0} is not «{1}»"),
		"op_contains": _("{0} contains «{1}»"),
		"op_not_contains": _("{0} doesn’t contain «{1}»"),
		"op_empty": _("{0} is empty"),
		"op_not_empty": _("{0} is filled in"),
		"unit_minutes": _("minutes"),
		"unit_hours": _("hours"),
		"unit_days": _("days"),
		"unit_weeks": _("weeks"),
		"unit1_minutes": _("minute"),
		"unit1_hours": _("hour"),
		"unit1_days": _("day"),
		"unit1_weeks": _("week"),
		"booking_Booked": _("is made"),
		"booking_Confirmed": _("is confirmed"),
		"booking_Rescheduled": _("is moved"),
		"booking_Cancelled": _("is cancelled"),
		"booking_Expired": _("expires unpaid"),
		"booking_Completed": _("is completed"),
		"booking_No-show": _("is a no-show"),
		"booking_Needs attention": _("needs attention"),
		"booking_Reminder sent": _("gets its reminder"),
		"dt_CRM Lead": _("a lead"),
		"dt_CRM Deal": _("a deal"),
		"dt_Booking": _("a booking"),
		"dt_Customer": _("a customer"),
		"dt_Contact": _("a contact"),
		"dt_Quotation": _("a quotation"),
		"dt_Sales Order": _("a sales order"),
		"dt_Sales Invoice": _("an invoice"),
		"dt_Payment Entry": _("a payment"),
		"dt_Task": _("a task"),
		"dt_Issue": _("a support ticket"),
	}


# Ready-made descriptions; `needs` hides one when the site lacks that record type.
def _recipes():
	return [
		{'title': _("Welcome new leads"), 'needs': "CRM Lead", 'text': _("When a new lead comes in, assign a call task to the lead owner for today and email the lead a short welcome from the owner.")},
		{'title': _("Sort incoming leads"), 'needs': "CRM Lead", 'text': _("When a new lead comes in, have the AI read their message and decide if it is urgent. If it is urgent, notify the lead owner right away.")},
		{'title': _("After a meeting"), 'needs': "Booking", 'text': _("When a booking is completed, have the AI summarize the notes into decisions and to-dos, and add the summary as a note.")},
		{'title': _("Win back no-shows"), 'needs': "Booking", 'text': _("When someone doesn’t show up to their booking, wait one hour and send them the link to book again.")},
		{'title': _("Follow up on deals"), 'needs': "CRM Deal", 'text': _("When a deal moves to Proposal, wait 3 days and create a follow-up task for the deal owner.")},
	]
